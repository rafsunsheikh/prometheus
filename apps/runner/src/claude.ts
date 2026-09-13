import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from './config.js';

export interface ClaudeResult {
  text: string;
  model: string;
  costUsd: number;
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
export function runClaude(prompt: string, systemPrompt?: string): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    const scratch = mkdtempSync(join(tmpdir(), 'socrates-'));
    const args = [
      '-p',
      '--output-format',
      'json',
      '--model',
      config.model,
      '--restricted',
      '--strict-mcp-config',
    ];
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

      const usage = (parsed.modelUsage ?? {}) as Record<string, unknown>;
      // Prefer the heaviest model used; the small one is background overhead.
      const model = Object.keys(usage).filter((m) => !m.includes('haiku')).at(-1)
        ?? Object.keys(usage).at(-1)
        ?? config.model;

      resolve({
        text,
        model,
        costUsd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : 0,
      });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
