import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, Clock, Coins, FileText, Hash, Users } from 'lucide-react';
import { api, type AdminStats } from '../lib/api';
import { ErrorNote, Spinner, formatCount, formatDate } from '../components/Bits';

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="panel p-5">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
        {icon}
        {label}
      </div>
      <div className="font-serif text-[2rem] leading-none font-semibold text-white">{value}</div>
      {sub && <div className="mt-2 text-[12px] leading-relaxed text-slate-500">{sub}</div>}
    </div>
  );
}

function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function Admin() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .adminStats()
      .then((s) => {
        setStats(s);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  };
  useEffect(load, []);

  if (error) {
    return (
      <div className="space-y-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-200">
          <ArrowLeft className="h-4 w-4" />
          Library
        </Link>
        <ErrorNote onRetry={load}>{error}</ErrorNote>
      </div>
    );
  }
  if (!stats) return <Spinner label="Gathering usage…" />;

  const t = stats.totals;

  return (
    <div className="space-y-8">
      <div>
        <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-200">
          <ArrowLeft className="h-4 w-4" />
          Library
        </Link>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-white">Admin</h1>
        <p className="mt-1.5 text-sm text-slate-400">
          Everything Socrates has read, across every account.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<BookOpen className="h-3.5 w-3.5" />}
          label="Books summarized"
          value={String(t.summarized)}
          sub={
            `${t.books !== t.summarized ? `${t.books} uploaded in total` : 'all uploads summarized'}` +
            (t.questionsAsked ? ` · ${t.questionsAsked} question${t.questionsAsked === 1 ? '' : 's'} answered` : '') +
            (t.mapsBuilt ? ` · ${t.mapsBuilt} map${t.mapsBuilt === 1 ? '' : 's'}` : '')
          }
        />
        <Stat
          icon={<FileText className="h-3.5 w-3.5" />}
          label="Pages read"
          value={formatCount(t.pages)}
          sub={`estimated at ${stats.wordsPerPage} words per page · ${t.words.toLocaleString()} words`}
        />
        <Stat
          icon={<Hash className="h-3.5 w-3.5" />}
          label="Tokens used"
          value={formatCount(t.tokens)}
          sub={
            t.unmeasured > 0
              ? `${formatCount(t.inputTokens)} in · ${formatCount(t.outputTokens)} out — excludes ${t.unmeasured} summary from before usage was recorded`
              : `${formatCount(t.inputTokens)} in · ${formatCount(t.outputTokens)} out`
          }
        />
        <Stat
          icon={<Coins className="h-3.5 w-3.5" />}
          label="Subscription usage"
          value={`$${t.costUsd.toFixed(2)}`}
          sub={`what this would have cost on the API · ${duration(t.seconds)} of reading`}
        />
      </div>

      {Object.keys(stats.jobs).length > 0 && (
        <div className="panel p-5">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
            <Clock className="h-3.5 w-3.5" />
            Jobs
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.jobs).map(([status, n]) => (
              <span
                key={status}
                className={`chip ${
                  status === 'done'
                    ? 'bg-sage-500/15 text-sage-300'
                    : status === 'failed'
                      ? 'bg-red-500/15 text-red-300'
                      : 'bg-ember-500/15 text-ember-300'
                }`}
              >
                {status} · {n}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
          <Users className="h-4 w-4 text-slate-500" />
          By account
        </h2>
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-[11px] tracking-wider text-slate-500 uppercase">
                <th className="px-5 py-3 text-left font-semibold">Account</th>
                <th className="px-5 py-3 text-right font-semibold">Books</th>
                <th className="px-5 py-3 text-right font-semibold">Summarized</th>
                <th className="px-5 py-3 text-right font-semibold">Pages</th>
                <th className="px-5 py-3 text-right font-semibold">Tokens</th>
                <th className="px-5 py-3 text-right font-semibold">Usage</th>
              </tr>
            </thead>
            <tbody>
              {stats.perUser.map((u) => (
                <tr key={u.email} className="border-b border-white/5 last:border-0">
                  <td className="px-5 py-3 text-slate-200">{u.email}</td>
                  <td className="px-5 py-3 text-right text-slate-400">{u.books}</td>
                  <td className="px-5 py-3 text-right text-slate-400">{u.summarized}</td>
                  <td className="px-5 py-3 text-right text-slate-400">
                    {formatCount(Math.round(u.words / stats.wordsPerPage))}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-400">{formatCount(u.tokens)}</td>
                  <td className="px-5 py-3 text-right text-slate-400">${u.cost_usd.toFixed(2)}</td>
                </tr>
              ))}
              {stats.perUser.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                    Nothing uploaded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-slate-600">
          Counts and usage only. Book titles below are shown because this runs on your subscription;
          nobody else's library contents are exposed here or anywhere else.
        </p>
      </div>

      {stats.recent.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Recent summaries</h2>
          <div className="panel divide-y divide-white/5">
            {stats.recent.map((r, i) => (
              <div key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3.5">
                <span className="font-serif text-[15px] text-white">{r.title}</span>
                <span className="text-[12px] text-slate-500">{r.email}</span>
                <span className="flex-1" />
                <span className="font-mono text-[11px] text-slate-500">
                  {Math.round(r.words / stats.wordsPerPage)}p · {formatCount(r.tokens)} tok ·{' '}
                  {r.chunks || 1} section{(r.chunks || 1) === 1 ? '' : 's'} ·{' '}
                  {duration(r.duration_ms / 1000)} · ${r.cost_usd.toFixed(2)}
                </span>
                <span className="text-[11px] text-slate-600">{formatDate(r.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
