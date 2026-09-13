import { useCallback, useRef, useState } from 'react';
import { FileText, UploadCloud, X } from 'lucide-react';
import { api } from '../lib/api';
import { extractBook, type Extracted } from '../lib/extract';
import { ErrorNote, ProgressBar, formatCount } from './Bits';

type Phase = 'idle' | 'extracting' | 'review' | 'uploading';

const ACCEPT = '.pdf,.epub,.docx,.txt,.md,.markdown';

export function Upload({ onDone }: { onDone: (bookId: string) => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState('');
  const [ratio, setRatio] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [book, setBook] = useState<Extracted | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [sourceName, setSourceName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setPhase('idle');
    setBook(null);
    setError(null);
    setRatio(0);
    setStage('');
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setPhase('extracting');
    setStage('Opening file');
    setRatio(0);
    try {
      const extracted = await extractBook(file, (s, r) => {
        setStage(s);
        setRatio(r);
      });
      setBook(extracted);
      setTitle(extracted.title);
      setAuthor(extracted.author ?? '');
      setSourceName(file.name);
      setPhase('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file');
      setPhase('idle');
    }
  }, []);

  const submit = useCallback(async () => {
    if (!book || !title.trim()) return;
    setPhase('uploading');
    setError(null);
    try {
      const { bookId } = await api.createBook({
        title: title.trim(),
        author: author.trim() || null,
        sourceName,
        sourceFormat: book.format,
        markdown: book.markdown,
      });
      reset();
      onDone(bookId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setPhase('review');
    }
  }, [book, title, author, sourceName, reset, onDone]);

  if (phase === 'review' || phase === 'uploading') {
    const busy = phase === 'uploading';
    return (
      <div className="panel rise p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-sage-500/12">
              <FileText className="h-5 w-5 text-sage-400" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white">Text extracted</div>
              <div className="text-xs text-slate-500">
                {formatCount(book!.markdown.split(/\s+/).length)} words ·{' '}
                {book!.format.toUpperCase()} · {sourceName}
              </div>
            </div>
          </div>
          <button onClick={reset} className="btn-quiet !p-2" disabled={busy} aria-label="Discard">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold tracking-wide text-slate-400 uppercase">
              Title
            </span>
            <input
              className="field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Book title"
              disabled={busy}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold tracking-wide text-slate-400 uppercase">
              Author <span className="font-normal text-slate-600">— optional</span>
            </span>
            <input
              className="field"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Author name"
              disabled={busy}
            />
          </label>
        </div>

        <details className="mt-4 group">
          <summary className="cursor-pointer list-none text-xs font-medium text-slate-500 hover:text-slate-300">
            Preview the first 600 characters →
          </summary>
          <pre className="mt-2.5 max-h-44 overflow-auto rounded-xl border border-white/8 bg-ink-950 p-3.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-slate-400">
            {book!.markdown.slice(0, 600)}…
          </pre>
        </details>

        {error && (
          <div className="mt-4">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button onClick={reset} className="btn-ghost" disabled={busy}>
            Cancel
          </button>
          <button onClick={submit} className="btn-primary" disabled={busy || !title.trim()}>
            {busy ? 'Sending…' : 'Summarize with Socrates'}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'extracting') {
    return (
      <div className="panel rise p-8">
        <div className="mb-4 flex items-center gap-3">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-ember-500 border-t-transparent" />
          <div>
            <div className="text-sm font-semibold text-white">Extracting text</div>
            <div className="text-xs text-slate-500">{stage}</div>
          </div>
        </div>
        <ProgressBar done={ratio * 100} total={100} />
        <p className="mt-4 text-xs leading-relaxed text-slate-600">
          This runs entirely in your browser — the file itself never leaves this device. Only the
          extracted text is sent on for summarizing.
        </p>
      </div>
    );
  }

  return (
    <div className="rise">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        className={`group cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-200 ${
          dragging
            ? 'border-ember-500 bg-ember-500/8 scale-[1.01]'
            : 'border-white/12 bg-ink-850/40 hover:border-ember-500/50 hover:bg-ink-850/70'
        }`}
      >
        <UploadCloud
          className={`mx-auto mb-4 h-11 w-11 transition-colors ${
            dragging ? 'text-ember-400' : 'text-slate-600 group-hover:text-ember-500'
          }`}
        />
        <p className="text-[15px] font-semibold text-slate-100">
          Drop a book here, or click to choose
        </p>
        <p className="mt-1.5 text-[13px] text-slate-500">
          PDF · EPUB · DOCX · TXT · Markdown — up to 120 MB
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </div>

      {error && (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </div>
  );
}
