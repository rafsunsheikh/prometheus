import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { runClaude } from './claude.js';

const prompt = (name: string) => readFileSync(join(config.promptsDir, `${name}.md`), 'utf8');

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

/**
 * Split a book into ordered chunks at the most natural boundary available:
 * markdown headings first, then paragraph breaks, then a hard character cut.
 * Chunks stay under `chunkChars` so each map call is a single comfortable turn.
 */
export function chunkBook(markdown: string, limit = config.chunkChars): string[] {
  const text = markdown.trim();
  if (text.length <= limit) return [text];

  // Split on headings but keep them attached to the content that follows.
  const blocks = text
    .split(/\n(?=#{1,3} )/g)
    .flatMap((block) => (block.length <= limit ? [block] : block.split(/\n{2,}/g)));

  const chunks: string[] = [];
  let current = '';

  for (const block of blocks) {
    if (block.length > limit) {
      // A single oversized block (no headings, no paragraph breaks) — cut it.
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < block.length; i += limit) chunks.push(block.slice(i, i + limit));
      continue;
    }
    if (current.length + block.length + 2 > limit) {
      chunks.push(current);
      current = block;
    } else {
      current = current ? `${current}\n\n${block}` : block;
    }
  }
  if (current.trim()) chunks.push(current);

  return chunks.filter((c) => c.trim().length > 0);
}

export interface SummarizeInput {
  title: string;
  author: string | null;
  markdown: string;
  onProgress: (stage: string, done: number, total: number) => Promise<void>;
}

export interface SummarizeOutput {
  markdown: string;
  model: string;
  costUsd: number;
  chunks: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export async function summarizeBook(input: SummarizeInput): Promise<SummarizeOutput> {
  const system = prompt('system');
  const chunks = chunkBook(input.markdown);
  const vars = {
    TITLE: input.title,
    AUTHOR_LINE: input.author ? `Author: ${input.author}` : '',
    AUTHOR_SUFFIX: input.author ? ` of ${input.title} by ${input.author}` : '',
  };

  const startedAt = Date.now();
  let totalCost = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let model = config.model;

  // Short enough to read whole: one pass keeps the summary far more coherent.
  if (chunks.length === 1) {
    await input.onProgress('Reading the whole text in one pass', 0, 1);
    const result = await runClaude(
      fill(prompt('single'), { ...vars, CONTENT: chunks[0]! }),
      system,
    );
    await input.onProgress('Complete', 1, 1);
    return {
      markdown: result.text,
      model: result.model,
      costUsd: result.costUsd,
      chunks: 1,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: Date.now() - startedAt,
    };
  }

  // Map: one summary per section. Sequential on purpose — parallel headless
  // sessions contend for the same subscription rate limits and fail noisily.
  const total = chunks.length + 1; // +1 for the synthesis pass
  const sectionSummaries: string[] = [];

  for (const [i, chunk] of chunks.entries()) {
    await input.onProgress(`Summarizing section ${i + 1} of ${chunks.length}`, i, total);
    const result = await runClaude(
      fill(prompt('map'), {
        ...vars,
        INDEX: String(i + 1),
        TOTAL: String(chunks.length),
        CONTENT: chunk,
      }),
      system,
    );
    sectionSummaries.push(result.text);
    totalCost += result.costUsd;
    inputTokens += result.inputTokens;
    outputTokens += result.outputTokens;
    model = result.model;
  }

  // Reduce: synthesize the section summaries into the finished document.
  await input.onProgress('Synthesizing the full summary', chunks.length, total);
  const joined = sectionSummaries.join('\n\n---\n\n');
  const finalResult = await runClaude(fill(prompt('reduce'), { ...vars, CONTENT: joined }), system);
  totalCost += finalResult.costUsd;
  inputTokens += finalResult.inputTokens;
  outputTokens += finalResult.outputTokens;

  await input.onProgress('Complete', total, total);

  return {
    markdown: finalResult.text,
    model: finalResult.model || model,
    costUsd: totalCost,
    chunks: chunks.length,
    inputTokens,
    outputTokens,
    durationMs: Date.now() - startedAt,
  };
}
