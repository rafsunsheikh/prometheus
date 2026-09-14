import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from './config.js';

export interface ClaudeResult {
  text: string;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Run one headless Claude turn against the local Pro/Max subscription.
 *
 * Three deliberate choices:
 *  - the ANTHROPIC_* env vars are stripped so Claude Code uses its stored OAuth
 *    credentials rather than any API key or proxy the shell happens to export;
 *  - cwd is a throwaway empty dir, so no CLAUDE.md or project context leaks in
 *    and inflates every single call;
 *  - --restricted removes Bash/Edit/etc. Summarizing needs no tools, and a
 *    summarizer that cannot touch the filesystem is one less thing to reason about.
 */
/** Tools a summarizer has no business touching, for Claude Code versions that
 *  predate the single `--restricted` switch. */
const TOOL_DENYLIST = [
  'Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep',
  'WebFetch', 'WebSearch', 'NotebookEdit', 'Task',
];

let restrictedSupport: Promise<boolean> | null = null;

/**
 * `--restricted` is not in every Claude Code build, and the runner may well sit
 * on a machine a few versions behind. Probe once and fall back to naming the
 * tools explicitly, so the same safety property holds either way.
 */
function supportsRestricted(): Promise<boolean> {
  restrictedSupport ??= new Promise<boolean>((resolve) => {
    const probe = spawn(config.claudeBin, ['--help'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let help = '';
    probe.stdout.on('data', (d) => (help += d));
    probe.on('error', () => resolve(false));
    probe.on('close', () => resolve(help.includes('--restricted')));
  });
  return restrictedSupport;
}

export async function runClaude(prompt: string, systemPrompt?: string): Promise<ClaudeResult> {
  const restricted = await supportsRestricted();
  return new Promise((resolve, reject) => {
    const scratch = mkdtempSync(join(tmpdir(), 'socrates-'));
    const args = [
      '-p',
      '--output-format',
      'json',
      '--model',
      config.model,
      '--strict-mcp-config',
    ];
    if (restricted) {
      args.push('--restricted');
    } else {
      args.push('--disallowedTools', TOOL_DENYLIST.join(' '));
    }
    if (systemPrompt) args.push('--append-system-prompt', systemPrompt);

    const env = { ...process.env };
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;

    const child = spawn(config.claudeBin, args, { cwd: scratch, env, stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));

    const cleanup = () => rmSync(scratch, { recursive: true, force: true });

    child.on('error', (err) => {
      cleanup();
      reject(new Error(`Could not start Claude Code (${config.claudeBin}): ${err.message}`));
    });

    child.on('close', (code) => {
      cleanup();
      if (code !== 0) {
        return reject(new Error(`Claude exited ${code}: ${stderr.trim() || stdout.trim() || 'no output'}`));
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        return reject(new Error(`Claude returned non-JSON output: ${stdout.slice(0, 400)}`));
      }
      if (parsed.is_error) {
        return reject(new Error(`Claude reported an error: ${String(parsed.result ?? parsed.subtype)}`));
      }
      const text = typeof parsed.result === 'string' ? parsed.result.trim() : '';
      if (!text) return reject(new Error('Claude returned an empty result'));

      const usage = (parsed.modelUsage ?? {}) as Record<string, Record<string, unknown>>;

      // Sum across every model the run touched: the main model plus whatever
      // Claude Code used for its own overhead, since all of it is real usage.
      let inputTokens = 0;
      let outputTokens = 0;
      for (const m of Object.values(usage)) {
        inputTokens += Number(m?.inputTokens ?? 0) + Number(m?.cacheReadInputTokens ?? 0) +
          Number(m?.cacheCreationInputTokens ?? 0);
        outputTokens += Number(m?.outputTokens ?? 0);
      }
      // Prefer the heaviest model used; the small one is background overhead.
      const model = Object.keys(usage).filter((m) => !m.includes('haiku')).at(-1)
        ?? Object.keys(usage).at(-1)
        ?? config.model;

      resolve({
        text,
        model,
        costUsd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : 0,
        inputTokens,
        outputTokens,
      });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
