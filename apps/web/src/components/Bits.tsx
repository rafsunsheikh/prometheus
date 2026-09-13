import { AlertTriangle, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import type { JobState } from '../lib/api';

export function StatusChip({ job, hasSummary }: { job: JobState | null; hasSummary: boolean }) {
  if (job?.status === 'running') {
    return (
      <span className="chip bg-ember-500/15 text-ember-300">
        <Loader2 className="h-3 w-3 animate-spin" />
        Summarizing
      </span>
    );
  }
  if (job?.status === 'queued') {
    return (
      <span className="chip bg-white/8 text-slate-400">
        <Clock className="h-3 w-3" />
        Queued
      </span>
    );
  }
  if (job?.status === 'failed' && !hasSummary) {
    return (
      <span className="chip bg-red-500/15 text-red-300">
        <AlertTriangle className="h-3 w-3" />
        Failed
      </span>
    );
  }
  if (hasSummary) {
    return (
      <span className="chip bg-sage-500/15 text-sage-300">
        <CheckCircle2 className="h-3 w-3" />
        Summarized
      </span>
    );
  }
  return <span className="chip bg-white/8 text-slate-400">Stored</span>;
}

export function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
      <div
        className="h-full rounded-full bg-gradient-to-r from-ember-600 to-ember-400 transition-[width] duration-700 ease-out"
        style={{ width: `${Math.max(pct, 3)}%` }}
      />
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

export function ErrorNote({ children, onRetry }: { children: React.ReactNode; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-500/25 bg-red-500/8 px-4 py-3 text-sm text-red-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
      <div className="flex-1">{children}</div>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 font-semibold text-red-200 underline underline-offset-2">
          Retry
        </button>
      )}
    </div>
  );
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Rough reading time at ~230 wpm, the usual figure for nonfiction prose. */
export function readingTime(words: number): string {
  const mins = Math.max(1, Math.round(words / 230));
  if (mins < 60) return `${mins} min read`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours}h ${rest}m read` : `${hours}h read`;
}
