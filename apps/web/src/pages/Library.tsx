import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Library as LibraryIcon, Plus, Trash2 } from 'lucide-react';
import { api, type Book } from '../lib/api';
import { Upload } from '../components/Upload';
import {
  ErrorNote,
  ProgressBar,
  Spinner,
  StatusChip,
  formatCount,
  formatDate,
  readingTime,
} from '../components/Bits';

const POLL_MS = 4000;

export function Library() {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const navigate = useNavigate();
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const { books } = await api.listBooks();
      setBooks(books);
      setError(null);
      return books;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your library');
      return null;
    }
  }, []);

  // Poll only while something is actually in flight, so an idle library is quiet.
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      const list = await load();
      if (stopped) return;
      const busy = list?.some((b) => b.job?.status === 'queued' || b.job?.status === 'running');
      timer.current = window.setTimeout(tick, busy ? POLL_MS : POLL_MS * 5);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  const remove = useCallback(
    async (book: Book) => {
      if (!confirm(`Delete “${book.title}” and its summary? This cannot be undone.`)) return;
      setDeleting(book.id);
      try {
        await api.deleteBook(book.id);
        setBooks((prev) => prev?.filter((b) => b.id !== book.id) ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Delete failed');
      } finally {
        setDeleting(null);
      }
    },
    [],
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1.5 flex items-center gap-2.5">
            <BookOpen className="h-5 w-5 text-sage-400" />
            <h1 className="font-serif text-3xl font-semibold tracking-tight text-white">Socrates</h1>
          </div>
          <p className="text-sm text-slate-400">
            Upload a book. Get it read, summarized and kept.
          </p>
        </div>
        <button onClick={() => setShowUpload((v) => !v)} className={showUpload ? 'btn-ghost' : 'btn-primary'}>
          <Plus className={`h-4 w-4 transition-transform ${showUpload ? 'rotate-45' : ''}`} />
          {showUpload ? 'Close' : 'Add a book'}
        </button>
      </div>

      {showUpload && (
        <Upload
          onDone={(bookId) => {
            setShowUpload(false);
            void load();
            navigate(`/book/${bookId}`);
          }}
        />
      )}

      {error && <ErrorNote onRetry={() => void load()}>{error}</ErrorNote>}

      {books === null && !error && <Spinner label="Opening your library…" />}

      {books?.length === 0 && !showUpload && (
        <div className="panel rise grid place-items-center px-6 py-20 text-center">
          <LibraryIcon className="mb-4 h-10 w-10 text-slate-700" />
          <p className="text-[15px] font-semibold text-slate-300">Your library is empty</p>
          <p className="mt-1.5 max-w-sm text-sm text-slate-500">
            Add a book and Socrates will read it end to end, then hand back a structured summary you
            can keep, re-read and export.
          </p>
          <button onClick={() => setShowUpload(true)} className="btn-primary mt-6">
            <Plus className="h-4 w-4" />
            Add your first book
          </button>
        </div>
      )}

      {books && books.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {books.map((book, i) => (
            <div
              key={book.id}
              className="panel rise group relative flex flex-col p-5 transition-all duration-200 hover:border-white/16 hover:bg-ink-800/70"
              style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <StatusChip job={book.job} hasSummary={book.hasSummary} />
                <button
                  onClick={() => void remove(book)}
                  disabled={deleting === book.id}
                  className="rounded-lg p-1.5 text-slate-600 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-500/12 hover:text-red-400 focus:opacity-100"
                  aria-label={`Delete ${book.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <Link to={`/book/${book.id}`} className="flex flex-1 flex-col">
                <h3 className="font-serif text-[1.15rem] leading-snug font-semibold text-white transition-colors group-hover:text-ember-200">
                  {book.title}
                </h3>
                {book.author && (
                  <p className="mt-1 text-[13px] text-slate-500">{book.author}</p>
                )}

                <div className="flex-1" />

                {book.job?.status === 'running' && (
                  <div className="mt-4 space-y-2">
                    <ProgressBar done={book.job.done} total={book.job.total} />
                    <p className="truncate text-[11px] text-ember-300/80">{book.job.stage}</p>
                  </div>
                )}

                {book.job?.status === 'failed' && !book.hasSummary && (
                  <p className="mt-4 line-clamp-2 text-[11px] leading-relaxed text-red-300/80">
                    {book.job.error}
                  </p>
                )}

                <div className="mt-4 flex items-center gap-2 border-t border-white/6 pt-3 text-[11px] text-slate-600">
                  <span className="font-mono uppercase">{book.sourceFormat}</span>
                  <span>·</span>
                  <span>{formatCount(book.wordCount)} words</span>
                  <span>·</span>
                  <span>{readingTime(book.wordCount)}</span>
                  <span className="flex-1" />
                  <span>{formatDate(book.createdAt)}</span>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
