import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { runClaude } from './claude.js';
import { rank } from './bm25.js';

/** Retrieval chunks are small on purpose: a passage should be the size of an
 *  argument, not a chapter, so several fit alongside the summary. */
const CHUNK_CHARS = 1500;
const TOP_K = 12;

export interface Passage {
  section: string;
  text: string;
}

/**
 * Split a book into heading-aware passages.
 *
 * A port of my-research-buddy's `_chunks_for_paper`, with one change: a chunk
 * carries the heading it sits under, so an answer can name where it came from.
 */
/**
 * Headings, in the forms books actually arrive in.
 *
 * Only EPUB and Markdown bring real `#` headings. A PDF or a plain-text book
 * carries its structure as prose conventions — "Chapter I. LAYING PLANS",
 * "IV. TACTICAL DISPOSITIONS", a bare capitalised title — and matching only
 * markdown would label an entire book "(opening)", which is a worse citation
 * than none at all.
 */
const MD_HEADING = /^#{1,6}\s+(.{2,80})$/;

/**
 * Heading shapes seen outside Markdown. Numbered body paragraphs are the trap:
 * in many books — Sun Tzu's verses, legal texts, anything with numbered
 * clauses — "26. Now the general who wins a battle…" opens a sentence, not a
 * section. Matching those shattered a 500-passage book into 437 "sections"
 * whose names were fragments of prose, which is a worse citation than none.
 * So a plain-text heading must also SIT ALONE: blank line before and after.
 */
const PLAIN_HEADINGS: RegExp[] = [
  /^((?:chapter|book|part|section|canto|act)\s+(?:[ivxlcdm]+|\d{1,3})\b[.:—-]?\s*.{0,60})$/i,
  /^((?:[IVXLCDM]{1,7})[.)]\s+.{3,60})$/,
  /^([A-Z][A-Z0-9 .,'’-]{5,55})$/,
];

function blank(line: string | undefined): boolean {
  return line === undefined || line.trim() === '';
}

function asHeading(lines: string[], i: number): string | null {
  const raw = lines[i] ?? '';
  const t = raw.trim();
  if (!t || t.length > 80) return null;

  const md = t.match(MD_HEADING);
  if (md) return (md[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

  // A run-on line that merely starts like a heading is prose; a real one is
  // set apart by whitespace on both sides.
  if (!blank(lines[i - 1]) || !blank(lines[i + 1])) return null;
  if (/[,;:]$/.test(t)) return null;

  for (const re of PLAIN_HEADINGS) {
    const m = t.match(re);
    if (m) return (m[1] ?? t).replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  return null;
}

/** Books with no detectable structure still deserve a locating citation, so
 *  passages fall back to which twelfth of the book they came from. */
const PARTS = 12;

export function passages(markdown: string, maxChars = CHUNK_CHARS): Passage[] {
  const out: (Passage & { titled: boolean })[] = [];
  let section = '';
  let buf: string[] = [];
  let size = 0;

  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) out.push({ section, text, titled: section !== '' });
    buf = [];
    size = 0;
  };

  const lines = (markdown || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const heading = asHeading(lines, i);
    if (heading) {
      flush();
      section = heading;
      continue;
    }
    // Hard-wrap a line longer than the chunk size, so one newline-free
    // paragraph cannot become a single oversized passage.
    for (let i = 0; i < Math.max(raw.length, 1); i += maxChars) {
      const line = raw.slice(i, i + maxChars);
      buf.push(line);
      size += line.length + 1;
      if (size >= maxChars) flush();
    }
  }
  flush();

  // Anything that never sat under a heading gets located by position instead.
  return out.map((p, i) => ({
    section: p.titled
      ? p.section
      : `part ${Math.min(PARTS, Math.floor((i / Math.max(out.length, 1)) * PARTS) + 1)} of ${PARTS}`,
    text: p.text,
  }));
}

export function retrieve(markdown: string, question: string, k = TOP_K): Passage[] {
  const all = passages(markdown);
  if (all.length <= k) return all;
  const ranked = rank(all, question, (p) => `${p.section} ${p.text}`);
  if (ranked.length === 0) return all.slice(0, k);

  // Restore reading order: the model reasons better about a book when the
  // passages arrive in the order the author wrote them, not by score.
  const chosen = new Set(ranked.slice(0, k).map((r) => r.item));
  return all.filter((p) => chosen.has(p));
}

const prompt = (name: string) => readFileSync(join(config.promptsDir, `${name}.md`), 'utf8');
const fill = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');

export interface AskInput {
  title: string;
  author: string | null;
  question: string;
  markdown: string;
  summary: string | null;
  history: { question: string; answer: string }[];
}

export interface AskOutput {
  answer: string;
  sections: string[];
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  passages: number;
}

/** Pull the trailing SECTIONS: line off the answer, so the citation is
 *  structured data rather than something the reader has to parse by eye. */
function splitSections(text: string): { answer: string; sections: string[] } {
  const m = text.match(/\n*SECTIONS:\s*(.+)\s*$/i);
  if (!m) return { answer: text.trim(), sections: [] };
  const listed = m[1]!.trim();
  const sections =
    listed.toLowerCase() === 'none'
      ? []
      : listed.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  return { answer: text.slice(0, m.index).trim(), sections };
}

export async function answerQuestion(input: AskInput): Promise<AskOutput> {
  const found = retrieve(input.markdown, input.question);

  const history = input.history.length
    ? '\nEarlier in this conversation:\n' +
      input.history.map((h) => `  Q: ${h.question}\n  A: ${h.answer.slice(0, 600)}`).join('\n') +
      '\n'
    : '';

  const result = await runClaude(
    fill(prompt('ask'), {
      TITLE: input.title,
      AUTHOR_LINE: input.author ? `Author: ${input.author}` : '',
      QUESTION: input.question,
      HISTORY: history,
      SUMMARY: input.summary ?? '(no summary has been made of this book yet)',
      PASSAGES: found.map((p) => `[${p.section}]\n${p.text}`).join('\n\n'),
    }),
    prompt('system'),
  );

  const { answer, sections } = splitSections(result.text);
  return {
    answer,
    sections,
    model: result.model,
    costUsd: result.costUsd,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    passages: found.length,
  };
}
