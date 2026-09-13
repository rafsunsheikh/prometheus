import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Minimal .env reader — the runner has no other reason to pull in a dependency. */
function loadDotEnv(): void {
  for (const candidate of [resolve(here, '../.env'), resolve(here, '../../.env')]) {
    if (!existsSync(candidate)) continue;
    for (const rawLine of readFileSync(candidate, 'utf8').split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
    break;
  }
}
loadDotEnv();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy apps/runner/.env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

const claudeBin = (process.env.CLAUDE_BIN ?? `${homedir()}/.local/bin/claude`).replace(
  /^~|^\$HOME/,
  homedir(),
);

export const config = {
  apiUrl: required('PROMETHEUS_API_URL').replace(/\/+$/, ''),
  runnerToken: required('PROMETHEUS_RUNNER_TOKEN'),
  claudeBin,
  model: process.env.CLAUDE_MODEL ?? 'sonnet',
  pollInterval: Number(process.env.POLL_INTERVAL ?? 10) * 1000,
  chunkChars: Number(process.env.CHUNK_CHARS ?? 120_000),
  promptsDir: resolve(here, '../prompts'),
};

export function assertClaudeInstalled(): void {
  if (!existsSync(config.claudeBin)) {
    console.error(
      `Claude Code binary not found at ${config.claudeBin}.\n` +
        `Set CLAUDE_BIN in apps/runner/.env to the real binary path ` +
        `(your shell 'claude' may be a function wrapper — check with 'type claude').`,
    );
    process.exit(1);
  }
}
