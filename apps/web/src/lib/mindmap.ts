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
}

/* Layout is deliberately arithmetic rather than a library: the tree is bounded
   to three levels and seven branches, so a left-to-right layout needs nothing
   cleverer, and drawing it ourselves keeps the whole feature dependency-free
   and exportable as a single SVG file. */

const COL_W = [230, 210, 200, 190];
const COL_GAP = 46;
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
 * Place every node. Children stack vertically; a parent centres on the block
 * its children occupy, so the map reads as a tree rather than a list.
 */
export function layout(root: MindmapNode): Layout {
  const nodes: Placed[] = [];
  let cursorY = 0;

  const place = (node: MindmapNode, depth: number, parent: Placed | null): Placed => {
    const lines = wrap(node.label, perLine(depth));
    const h = lines.length * LINE_H + PAD_Y * 2;
    const w = colW(depth);
    const x = COL_W.slice(0, depth).reduce((n, v) => n + v + COL_GAP, 0);

    const placed: Placed = { label: node.label, depth, x, y: 0, w, h, lines, parent };
    nodes.push(placed);

    const kids = node.children ?? [];
    if (kids.length === 0) {
      placed.y = cursorY;
      cursorY += h + V_GAP;
      return placed;
    }

    const children = kids.map((k) => place(k, depth + 1, placed));
    const first = children[0]!;
    const last = children[children.length - 1]!;
    // Centre on the span of the children, then nudge back inside the canvas if
    // a tall subtree would push a short parent above the top edge.
    placed.y = Math.max(0, (first.y + last.y + last.h - h) / 2);
    return placed;
  };

  place(root, 0, null);

  const width = Math.max(...nodes.map((n) => n.x + n.w)) + 8;
  const height = Math.max(...nodes.map((n) => n.y + n.h)) + 8;
  return { nodes, width, height };
}

/** A curve from a parent's right edge to a child's left edge. */
export function edgePath(parent: Placed, child: Placed): string {
  const x1 = parent.x + parent.w;
  const y1 = parent.y + parent.h / 2;
  const x2 = child.x;
  const y2 = child.y + child.h / 2;
  const mid = x1 + (x2 - x1) / 2;
  return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
}

export function countNodes(node: MindmapNode): number {
  return 1 + (node.children ?? []).reduce((n, c) => n + countNodes(c), 0);
}
