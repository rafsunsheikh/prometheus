import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Network, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { countNodes, edgePath, layout, type MindmapNode } from '../lib/mindmap';
import { ErrorNote, Spinner } from './Bits';
import { safeFilename } from '../lib/export';

const POLL_MS = 3000;

/** Depth decides weight: the root is the claim, branches are themes, leaves are
 *  detail. Colour carries that hierarchy so the eye can skim a level at a time. */
const TONE = [
  { fill: '#1d1408', stroke: 'rgba(247,185,85,0.55)', text: '#fcd9a4', weight: 600 },
  { fill: '#151922', stroke: 'rgba(255,255,255,0.14)', text: '#e8eaf0', weight: 600 },
  { fill: '#11151d', stroke: 'rgba(255,255,255,0.09)', text: '#aab2c0', weight: 500 },
  { fill: '#0e1219', stroke: 'rgba(255,255,255,0.07)', text: '#8d95a3', weight: 500 },
];

export function Mindmap({
  bookId,
  title,
  hasSummary,
}: {
  bookId: string;
  title: string;
  hasSummary: boolean;
}) {
  const [tree, setTree] = useState<MindmapNode | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const timer = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const load = useCallback(async () => {
    try {
      const { mindmap } = await api.getMindmap(bookId);
      setTree(mindmap?.tree ?? null);
      setStatus(mindmap?.status ?? null);
      setError(mindmap?.status === 'failed' ? mindmap.error : null);
      return mindmap?.status ?? null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the map');
      return null;
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      const s = await load();
      if (stopped) return;
      if (s === 'queued' || s === 'running') timer.current = window.setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  const build = useCallback(async () => {
    setBuilding(true);
    setError(null);
    try {
      await api.buildMindmap(bookId);
      await load();
      const tick = async () => {
        const s = await load();
        if (s === 'queued' || s === 'running') timer.current = window.setTimeout(tick, POLL_MS);
      };
      timer.current = window.setTimeout(tick, POLL_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the map');
    } finally {
      setBuilding(false);
    }
  }, [bookId, load]);

  const placed = useMemo(() => (tree ? layout(tree) : null), [tree]);

  const download = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    // The page paints the background; a standalone file must carry its own.
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', '100%');
    bg.setAttribute('height', '100%');
    bg.setAttribute('fill', '#0b0d12');
    clone.insertBefore(bg, clone.firstChild);
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFilename(title)}-map.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, [title]);

  if (loading) return <Spinner label="Opening the map…" />;

  const busy = status === 'queued' || status === 'running';

  if (!tree) {
    return (
      <div className="panel rise grid place-items-center px-6 py-16 text-center">
        <Network className="mb-4 h-9 w-9 text-slate-700" />
        <p className="text-sm font-semibold text-slate-300">
          {busy ? 'Drawing the map…' : 'No concept map yet'}
        </p>
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-slate-500">
          {busy
            ? 'Socrates is working out the shape of the argument.'
            : hasSummary
              ? "A map of the book's central idea and the themes branching from it, built from its summary."
              : 'Summarize this book first — the map is built from its summary.'}
        </p>
        {error && (
          <div className="mt-5 w-full max-w-md">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
        {!busy && hasSummary && (
          <button onClick={() => void build()} className="btn-primary mt-6" disabled={building}>
            {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Network className="h-4 w-4" />}
            Build the map
          </button>
        )}
        {busy && <Loader2 className="mt-6 h-5 w-5 animate-spin text-ember-400" />}
      </div>
    );
  }

  return (
    <div className="rise space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-slate-500">
          {countNodes(tree)} concepts · built from the summary
        </p>
        <div className="flex items-center gap-2">
          <button onClick={download} className="btn-ghost !py-2 !text-[13px]">
            <Download className="h-3.5 w-3.5" />
            SVG
          </button>
          <button onClick={() => void build()} className="btn-ghost !py-2 !text-[13px]" disabled={busy || building}>
            <RefreshCw className={`h-3.5 w-3.5 ${busy || building ? 'animate-spin' : ''}`} />
            Rebuild
          </button>
        </div>
      </div>

      {error && <ErrorNote onRetry={() => void build()}>{error}</ErrorNote>}

      <div className="panel overflow-auto p-5">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${placed!.width} ${placed!.height}`}
          width={placed!.width}
          height={placed!.height}
          className="max-w-none"
          role="img"
          aria-label={`Concept map of ${title}`}
        >
          <g fill="none" strokeLinecap="round">
            {placed!.nodes
              .filter((n) => n.parent)
              .map((n, i) => (
                <path
                  key={`e${i}`}
                  d={edgePath(n.parent!, n)}
                  stroke={n.depth === 1 ? 'rgba(247,185,85,0.34)' : 'rgba(255,255,255,0.13)'}
                  strokeWidth={n.depth === 1 ? 1.6 : 1.1}
                />
              ))}
          </g>
          {placed!.nodes.map((n, i) => {
            const tone = TONE[Math.min(n.depth, TONE.length - 1)]!;
            return (
              <g key={`n${i}`}>
                <rect
                  x={n.x}
                  y={n.y}
                  width={n.w}
                  height={n.h}
                  rx={10}
                  fill={tone.fill}
                  stroke={tone.stroke}
                  strokeWidth={1}
                />
                {n.lines.map((line, li) => (
                  <text
                    key={li}
                    x={n.x + 13}
                    y={n.y + 11 + 13 + li * 17}
                    fill={tone.text}
                    fontSize={n.depth === 0 ? 14 : 12.5}
                    fontWeight={tone.weight}
                    fontFamily="Inter, system-ui, sans-serif"
                  >
                    {line}
                  </text>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
