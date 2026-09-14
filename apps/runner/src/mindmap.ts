import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { runClaude } from './claude.js';

export interface MindmapNode {
  label: string;
  children?: MindmapNode[];
}

const DEPTH = 3;        // levels below the root
const MIN_BRANCH = 4;
const MAX_BRANCH = 7;
const MAX_LABEL = 60;
const MAX_NODES = 80;   // a map past this stops being readable at any size

const prompt = (name: string) => readFileSync(join(config.promptsDir, `${name}.md`), 'utf8');
const fill = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');

/**
 * Pull a JSON object out of a model's reply.
 *
 * my-research-buddy constrained the local model with a JSON grammar. Claude Code
 * offers no such hook, so the reply is parsed defensively: a fence may wrap it,
 * a sentence may precede it. Scanning brace depth — while respecting strings and
 * escapes — finds the outer object without tripping over braces inside labels.
 */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const start = cleaned.indexOf('{');
  if (start === -1) throw new Error('No JSON object in the reply');

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      return JSON.parse(cleaned.slice(start, i + 1));
    }
  }
  throw new Error('JSON object in the reply is unterminated');
}

/**
 * Coerce whatever came back into a tree we are willing to draw: depth and
 * breadth clamped, labels trimmed, anything unlabelled dropped. A model that
 * overruns the brief should cost a tidier map, never a broken page.
 */
export function sanitize(raw: unknown, depth = DEPTH): { tree: MindmapNode; nodes: number } {
  let nodes = 0;

  const walk = (value: unknown, left: number): MindmapNode | null => {
    if (!value || typeof value !== 'object') return null;
    const v = value as { label?: unknown; children?: unknown };

    const label = typeof v.label === 'string' ? v.label.replace(/\s+/g, ' ').trim() : '';
    if (!label) return null;
    if (nodes >= MAX_NODES) return null;
    nodes++;

    const node: MindmapNode = { label: label.slice(0, MAX_LABEL) };
    if (left > 0 && Array.isArray(v.children)) {
      const kids = v.children
        .slice(0, MAX_BRANCH)
        .map((c) => walk(c, left - 1))
        .filter((c): c is MindmapNode => c !== null);
      if (kids.length) node.children = kids;
    }
    return node;
  };

  const tree = walk(raw, depth);
  if (!tree) throw new Error('The reply contained no usable map');
  if (!tree.children?.length) throw new Error('The map had a root but no branches');
  return { tree, nodes };
}

export interface MindmapResult {
  tree: MindmapNode;
  nodes: number;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export async function buildMindmap(input: {
  title: string;
  author: string | null;
  summary: string;
}): Promise<MindmapResult> {
  const result = await runClaude(
    fill(prompt('mindmap'), {
      TITLE: input.title,
      AUTHOR_LINE: input.author ? `Author: ${input.author}` : '',
      SUMMARY: input.summary,
      DEPTH: String(DEPTH),
      MIN_BRANCH: String(MIN_BRANCH),
      MAX_BRANCH: String(MAX_BRANCH),
      MAX_LABEL: String(MAX_LABEL),
    }),
    prompt('system'),
  );

  const { tree, nodes } = sanitize(extractJson(result.text));
  return {
    tree,
    nodes,
    model: result.model,
    costUsd: result.costUsd,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}
