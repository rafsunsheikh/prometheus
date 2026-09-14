export interface MindmapNode {
  label: string;
  children?: MindmapNode[];
}

export interface Placed {
  label: string;
  depth: number;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  parent: Placed | null;
  /** Which way this node runs from the root: 1 right, -1 left. */
  dir: 1 | -1;
}

/* Layout is deliberately arithmetic rather than a library: the tree is bounded
   to three levels and seven branches, so a left-to-right layout needs nothing
   cleverer, and drawing it ourselves keeps the whole feature dependency-free
   and exportable as a single SVG file. */

const COL_W = [215, 198, 190, 184];
const COL_GAP = 38;
const LINE_H = 17;
const PAD_Y = 11;
const V_GAP = 12;
const CHARS_PER_LINE = [22, 24, 26, 26];

/** Greedy wrap. Labels are short by construction, so this needs no measuring. */
function wrap(label: string, perLine: number): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= perLine) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
    if (lines.length === 3) break;
  }
  if (line && lines.length < 3) lines.push(line);
  if (lines.length === 0) lines.push('·');
  return lines;
}

const colW = (d: number) => COL_W[Math.min(d, COL_W.length - 1)]!;
const perLine = (d: number) => CHARS_PER_LINE[Math.min(d, CHARS_PER_LINE.length - 1)]!;

export interface Layout {
  nodes: Placed[];
  width: number;
  height: number;
}

/**
 * Lay the map out with the root in the middle and its branches running both
 * ways, as a mind map actually looks.
 *
 * A single left-to-right tree was the obvious first attempt and read badly:
 * seven themes made it twice as tall as the screen, and centring the root on
 * that span pushed the book's central idea — the one node that should be seen
 * first — below the fold behind an empty column. Splitting the branches halves
 * the height and puts the root where the eye starts.
 */
export function layout(root: MindmapNode): Layout {
  const nodes: Placed[] = [];
  const kids = root.children ?? [];

  // Bias the extra branch to the right, where reading starts.
  const half = Math.ceil(kids.length / 2);
  const sides: [MindmapNode[], 1 | -1][] = [
    [kids.slice(0, half), 1],
    [kids.slice(half), -1],
  ];

  const rootW = colW(0);
  let cursorY = 0;
  const sideSpans: { top: number; bottom: number }[] = [];

  const place = (node: MindmapNode, depth: number, dir: 1 | -1, parent: Placed | null): Placed => {
    const lines = wrap(node.label, perLine(depth));
    const h = lines.length * LINE_H + PAD_Y * 2;
    const w = colW(depth);

    // Distance from the root's edge out to this column.
    const offset = COL_W.slice(1, depth).reduce((n, v) => n + v + COL_GAP, 0) + COL_GAP;
    const x = dir === 1 ? rootW + offset : -(offset + w);

    const placed: Placed = { label: node.label, depth, x, y: 0, w, h, lines, parent, dir };
    nodes.push(placed);

    const children = node.children ?? [];
    if (children.length === 0) {
      placed.y = cursorY;
      cursorY += h + V_GAP;
      return placed;
    }
    const laid = children.map((k) => place(k, depth + 1, dir, placed));
    const first = laid[0]!;
    const last = laid[laid.length - 1]!;
    placed.y = (first.y + last.y + last.h - h) / 2;
    return placed;
  };

  for (const [branch, dir] of sides) {
    if (branch.length === 0) continue;
    // Each half flows from the top independently: sharing one cursor stacked
    // the left branches below the right ones instead of mirroring them, which
    // left their whole column empty.
    cursorY = 0;
    for (const k of branch) place(k, 1, dir, null);
    sideSpans.push({ top: 0, bottom: cursorY });
  }

  // The root sits at the middle of everything, and each branch points back to it.
  const rootLines = wrap(root.label, perLine(0));
  const rootH = rootLines.length * LINE_H + PAD_Y * 2;
  const spanTop = Math.min(...sideSpans.map((s) => s.top), 0);
  const spanBottom = Math.max(...sideSpans.map((s) => s.bottom), rootH);
  const rootNode: Placed = {
    label: root.label,
    depth: 0,
    x: 0,
    y: (spanTop + spanBottom - rootH) / 2,
    w: rootW,
    h: rootH,
    lines: rootLines,
    parent: null,
    dir: 1,
  };
  nodes.unshift(rootNode);
  for (const n of nodes) if (n.depth === 1) n.parent = rootNode;

  // Shift everything positive: the left half was laid out at negative x.
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  for (const n of nodes) {
    n.x += -minX + 6;
    n.y += -minY + 6;
  }

  return {
    nodes,
    width: Math.max(...nodes.map((n) => n.x + n.w)) + 6,
    height: Math.max(...nodes.map((n) => n.y + n.h)) + 6,
  };
}

/** A curve from a parent to a child, leaving whichever edge faces the child. */
export function edgePath(parent: Placed, child: Placed): string {
  const out = child.dir === 1;
  const x1 = out ? parent.x + parent.w : parent.x;
  const x2 = out ? child.x : child.x + child.w;
  const y1 = parent.y + parent.h / 2;
  const y2 = child.y + child.h / 2;
  const mid = x1 + (x2 - x1) / 2;
  return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
}

export function countNodes(node: MindmapNode): number {
  return 1 + (node.children ?? []).reduce((n, c) => n + countNodes(c), 0);
}
