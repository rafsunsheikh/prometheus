import { useCallback, useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Loader2, MessageCircleQuestion, Quote } from 'lucide-react';
import { api, type Question, type WaitingFor } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import { ErrorNote } from './Bits';

const POLL_MS = 2500;

export function Ask({ bookId, hasSummary }: { bookId: string; hasSummary: boolean }) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [waiting, setWaiting] = useState<WaitingFor | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const { questions, waitingFor } = await api.listQuestions(bookId);
      setQuestions(questions);
      setWaiting(waitingFor);
      setError(null);
      return questions;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the conversation');
      return null;
    }
  }, [bookId]);

  // Poll only while an answer is outstanding, so an idle conversation is quiet.
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      const list = await load();
      if (stopped) return;
      const pending = list?.some((q) => q.status === 'queued' || q.status === 'running');
      if (pending) timer.current = window.setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [questions?.length]);

  const submit = useCallback(async () => {
    const question = draft.trim();
    if (!question || sending) return;
    setSending(true);
    setError(null);
    try {
      await api.ask(bookId, question);
      setDraft('');
      const list = await load();
      // Restart polling for the answer we just queued.
      if (list?.some((q) => q.status !== 'done' && q.status !== 'failed')) {
        const tick = async () => {
          const l = await load();
          if (l?.some((q) => q.status === 'queued' || q.status === 'running')) {
            timer.current = window.setTimeout(tick, POLL_MS);
          }
        };
        timer.current = window.setTimeout(tick, POLL_MS);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that question');
    } finally {
      setSending(false);
    }
  }, [bookId, draft, sending, load]);

  const pending = questions?.some((q) => q.status === 'queued' || q.status === 'running');

  return (
    <div className="space-y-5">
      {questions !== null && questions.length === 0 && (
        <div className="grid place-items-center py-12 text-center">
          <MessageCircleQuestion className="mb-4 h-9 w-9 text-slate-700" />
          <p className="text-sm font-semibold text-slate-300">Ask this book something</p>
          <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-slate-500">
            Socrates answers from this book's own text and says so when the book doesn't
            cover it — rather than filling the gap from elsewhere.
          </p>
        </div>
      )}

      {questions?.map((q) => (
        <div key={q.id} className="space-y-3">
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-ember-500/12 px-4 py-2.5 text-[14px] leading-relaxed text-ember-100">
              {q.question}
            </div>
          </div>

          {q.answer && (
            <div className="rounded-2xl rounded-bl-sm border border-white/8 bg-ink-900/50 px-5 py-4">
              <div className="doc !text-[14.5px]" dangerouslySetInnerHTML={{ __html: renderMarkdown(q.answer) }} />
              {q.sections.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-white/6 pt-3">
                  <Quote className="h-3 w-3 text-slate-600" />
                  {q.sections.map((s) => (
                    <span key={s} className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-slate-400">
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {(q.status === 'queued' || q.status === 'running') && (
            <div className="flex items-center gap-2.5 px-1 text-[13px] text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-ember-400" />
              {q.status === 'running' ? (
                'Reading the book…'
              ) : waiting ? (
                <span>
                  Waiting for <span className="text-slate-400">{waiting.title}</span>
                  {waiting.stage ? ` — ${waiting.stage.toLowerCase()}` : ''}. Questions run one at a
                  time, after the book in progress.
                </span>
              ) : (
                'Queued…'
              )}
            </div>
          )}

          {q.status === 'failed' && <ErrorNote>{q.error}</ErrorNote>}
        </div>
      ))}

      <div ref={endRef} />

      {error && <ErrorNote onRetry={() => void load()}>{error}</ErrorNote>}

      <div className="sticky bottom-4 pt-2">
        <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-ink-850/90 p-2 backdrop-blur-xl">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={1}
            placeholder={
              hasSummary ? 'Ask about this book…' : 'Ask about this book — no summary yet, so answers lean on the text alone'
            }
            className="max-h-40 min-h-[42px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none"
          />
          <button
            onClick={() => void submit()}
            disabled={!draft.trim() || sending}
            className="btn-primary !px-3 !py-2.5"
            aria-label="Ask"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CornerDownLeft className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-2 px-1 text-[11px] text-slate-600">
          {pending
            ? 'You can keep asking — questions are answered in order.'
            : 'Enter to send · Shift+Enter for a new line'}
        </p>
      </div>
    </div>
  );
}
