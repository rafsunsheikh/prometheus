import { api } from './api.js';
import { assertClaudeInstalled, config } from './config.js';
import { summarizeBook } from './summarize.js';

const once = process.argv.includes('--once');
let stopping = false;

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (msg: string) => console.log(`[${stamp()}] ${msg}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function handleOneJob(): Promise<boolean> {
  const job = await api.claim();
  if (!job) return false;

  const words = job.wordCount.toLocaleString();
  log(`Claimed ${job.id} — "${job.title}" (${words} words, attempt ${job.attempt})`);
  const startedAt = Date.now();

  try {
    const result = await summarizeBook({
      title: job.title,
      author: job.author,
      markdown: job.markdown,
      onProgress: async (stage, done, total) => {
        log(`  ${stage}`);
        await api.progress(job.id, stage, done, total).catch((err) => {
          // Progress is cosmetic; never let it kill a running summarization.
          log(`  (progress update failed: ${(err as Error).message})`);
        });
      },
    });

    await api.complete(job.id, result.markdown, result.model, {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
      chunks: result.chunks,
      durationMs: result.durationMs,
    });
    const secs = ((Date.now() - startedAt) / 1000).toFixed(0);
    log(
      `Done ${job.id} in ${secs}s — ${result.chunks} section(s), ` +
        `${result.markdown.length.toLocaleString()} chars, ` +
        `${(result.inputTokens + result.outputTokens).toLocaleString()} tokens, ` +
        `~$${result.costUsd.toFixed(2)} of subscription usage`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`FAILED ${job.id}: ${message}`);
    await api.fail(job.id, message, true).catch(() => {});
  }
  return true;
}

async function main(): Promise<void> {
  assertClaudeInstalled();

  log(`Prometheus runner starting`);
  log(`  API    ${config.apiUrl}`);
  log(`  Claude ${config.claudeBin} (model: ${config.model})`);

  try {
    const health = await api.ping();
    log(`  Queue  ${health.pending} job(s) pending`);
  } catch (err) {
    console.error(`\nCannot reach the API: ${(err as Error).message}`);
    console.error('Check PROMETHEUS_API_URL and PROMETHEUS_RUNNER_TOKEN in apps/runner/.env');
    process.exit(1);
  }

  if (once) {
    const worked = await handleOneJob();
    log(worked ? 'Processed one job, exiting (--once)' : 'Queue empty, exiting (--once)');
    return;
  }

  log(`Polling every ${config.pollInterval / 1000}s. Ctrl-C to stop.`);
  let idleLogged = false;

  while (!stopping) {
    try {
      const worked = await handleOneJob();
      if (worked) {
        idleLogged = false;
        continue; // Drain the queue before sleeping again.
      }
      if (!idleLogged) {
        log('Queue empty, waiting for work');
        idleLogged = true;
      }
    } catch (err) {
      log(`Poll error: ${(err as Error).message}`);
    }
    await sleep(config.pollInterval);
  }
  log('Runner stopped');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    log('Shutting down after the current job…');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
