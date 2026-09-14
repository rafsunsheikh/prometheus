import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  MessageCircleQuestion,
  Network,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileText,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { api, type Book } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import { exportDocx, exportMarkdown, exportPdf } from '../lib/export';
import { Ask } from '../components/Ask';
import { Mindmap } from '../components/Mindmap';
import {
  ErrorNote,
  ProgressBar,
  Spinner,
  StatusChip,
  formatCount,
  formatDate,
  readingTime,
} from '../components/Bits';

type Tab = 'summary' | 'text' | 'ask' | 'map';

export function Reader() {
  const { id = '' } = useParams();
  const [book, setBook] = useState<Book | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('summary');
  const [error, setError] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState(false);
  const [requeueing, setRequeueing] = useState(false);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async (): Promise<Book | null> => {
    try {
      const { book } = await api.getBook(id);
      setBook(book);
      setError(null);
      if (book.hasSummary) {
        const s = await api.getSummary(id).catch(() => null);
        if (s) setSummary(s.markdown);
      }
      return book;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this book');
      return null;
    }
  }, [id]);

  // Poll while a job is in flight so the summary appears the moment it lands.
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      const b = await refresh();
      if (stopped) return;
      const busy = b?.job?.status === 'queued' || b?.job?.status === 'running';
      if (busy) timer.current = window.setTimeout(tick, 3000);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  // The full book text is large; fetch it only when the reader asks for it.
  useEffect(() => {
    if (tab !== 'text' || content !== null || loadingText) return;
    setLoadingText(true);
    api
      .getContent(id)
      .then(({ markdown }) => setContent(markdown))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingText(false));
  }, [tab, content, loadingText, id]);

  const requeue = useCallback(async () => {
    setRequeueing(true);
    try {
      await api.resummarize(id);
      await refresh();
      // Restart polling for the freshly queued job.
      const poll = async () => {
        const b = await refresh();
        if (b?.job?.status === 'queued' || b?.job?.status === 'running') {
          timer.current = window.setTimeout(poll, 3000);
        }
      };
      timer.current = window.setTimeout(poll, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not queue a re-run');
    } finally {
      setRequeueing(false);
    }
  }, [id, refresh]);

  const active = book?.job?.status === 'queued' || book?.job?.status === 'running';
  const body = tab === 'summary' ? summary : tab === 'text' ? content : null;
  const html = useMemo(() => (body ? renderMarkdown(body) : ''), [body]);

  if (!book && !error) return <Spinner label="Opening…" />;

  return (
    <div className="space-y-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Library
      </Link>

      {error && <ErrorNote onRetry={() => void refresh()}>{error}</ErrorNote>}

      {book && (
        <>
          <header className="panel rise p-6 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-0 flex-1">
                <StatusChip job={book.job} hasSummary={book.hasSummary} />
                <h1 className="mt-3 font-serif text-[2rem] leading-tight font-semibold text-white">
                  {book.title}
                </h1>
                {book.author && <p className="mt-1.5 text-sm text-slate-400">{book.author}</p>}
                <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-slate-500">
                  <span className="font-mono uppercase">{book.sourceFormat}</span>
                  <span>·</span>
                  <span>{formatCount(book.wordCount)} words</span>
                  <span>·</span>
                  <span>{readingTime(book.wordCount)}</span>
                  <span>·</span>
                  <span>Added {formatDate(book.createdAt)}</span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2.5">
                {book.hasSummary && summary && (
                  <ExportMenu title={book.title} markdown={summary} />
                )}
                <button
                  onClick={() => void requeue()}
                  className="btn-ghost"
                  disabled={active || requeueing}
                  title={active ? 'A run is already in progress' : 'Summarize again'}
                >
                  <RefreshCw className={`h-4 w-4 ${requeueing ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">
                    {book.hasSummary ? 'Re-summarize' : 'Summarize'}
                  </span>
                </button>
              </div>
            </div>

            {active && book.job && (
              <div className="mt-6 space-y-2.5 border-t border-white/8 pt-5">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 font-medium text-ember-300">
                    <Sparkles className="h-3.5 w-3.5" />
                    {book.job.stage ?? 'Working'}
                  </span>
                  {book.job.total > 0 && (
                    <span className="font-mono text-slate-500">
                      {book.job.done}/{book.job.total}
                    </span>
                  )}
                </div>
                <ProgressBar done={book.job.done} total={book.job.total} />
                <p className="text-[11px] text-slate-600">
                  Socrates reads the whole book in sections, then synthesizes. Long books take a
                  while — you can close this page and come back.
                </p>
              </div>
            )}

            {book.job?.status === 'failed' && (
              <div className="mt-6 border-t border-white/8 pt-5">
                <ErrorNote onRetry={() => void requeue()}>{book.job.error}</ErrorNote>
              </div>
            )}
          </header>

          <div className="flex items-center gap-1 rounded-xl border border-white/8 bg-ink-850/60 p-1">
            <TabButton active={tab === 'summary'} onClick={() => setTab('summary')}>
              <Sparkles className="h-3.5 w-3.5" />
              Summary
            </TabButton>
            <TabButton active={tab === 'text'} onClick={() => setTab('text')}>
              <FileText className="h-3.5 w-3.5" />
              Full text
            </TabButton>
            <TabButton active={tab === 'map'} onClick={() => setTab('map')}>
              <Network className="h-3.5 w-3.5" />
              Map
            </TabButton>
            <TabButton active={tab === 'ask'} onClick={() => setTab('ask')}>
              <MessageCircleQuestion className="h-3.5 w-3.5" />
              Ask
            </TabButton>
          </div>

          {tab === 'ask' && (
            <div className="rise">
              <Ask bookId={book.id} hasSummary={book.hasSummary} />
            </div>
          )}

          {tab === 'map' && (
            <Mindmap bookId={book.id} title={book.title} hasSummary={book.hasSummary} />
          )}

          {tab !== 'ask' && tab !== 'map' && (
          <article className="panel rise px-6 py-8 sm:px-10 sm:py-10">
            {tab === 'summary' && !summary && (
              <div className="grid place-items-center py-16 text-center">
                <Sparkles className="mb-4 h-9 w-9 text-slate-700" />
                <p className="text-sm font-semibold text-slate-300">
                  {active ? 'Socrates is reading' : 'No summary yet'}
                </p>
                <p className="mt-1.5 max-w-sm text-[13px] text-slate-500">
                  {active
                    ? 'The summary will appear here as soon as the run finishes.'
                    : 'Start a run and the summary will appear here.'}
                </p>
              </div>
            )}
            {tab === 'text' && loadingText && <Spinner label="Loading the full text…" />}
            {body && (
              <div
                className={tab === 'text' ? 'doc font-mono text-[13px] leading-relaxed' : 'doc'}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            )}
          </article>
          )}
        </>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all sm:flex-none ${
        active ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  );
}

function ExportMenu({ title, markdown }: { title: string; markdown: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const copy = async () => {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
    setOpen(false);
  };

  const items = [
    { label: 'PDF', hint: 'via print dialog', run: () => exportPdf(title, markdown) },
    { label: 'Word (.docx)', hint: 'editable', run: () => void exportDocx(title, markdown) },
    { label: 'Markdown (.md)', hint: 'plain text', run: () => exportMarkdown(title, markdown) },
  ];

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} className="btn-primary">
        <Download className="h-4 w-4" />
        <span className="hidden sm:inline">Export</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-ink-800 shadow-2xl shadow-black/50">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                item.run();
                setOpen(false);
              }}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-slate-200 transition-colors hover:bg-white/8"
            >
              <span className="font-medium">{item.label}</span>
              <span className="text-[11px] text-slate-500">{item.hint}</span>
            </button>
          ))}
          <div className="border-t border-white/8">
            <button
              onClick={() => void copy()}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-300 transition-colors hover:bg-white/8"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-sage-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? 'Copied' : 'Copy markdown'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
