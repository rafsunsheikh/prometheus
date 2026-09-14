import { Hono } from 'hono';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireRunner } from '../lib/middleware';
import { countWords, getText, newId, putText, readJson, summaryKey } from '../lib/storage';
import type { BookRow, Env, JobRow, MindmapRow, QuestionRow, RunUsage, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireRunner);

type RunnerCtx = Context<{ Bindings: Env; Variables: Variables }>;

/** A job claimed but silent this long is assumed dead and returned to the queue. */
const STALE_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 3;

/**
 * Claim the oldest queued job. The runner polls this; the Worker never reaches
 * out to the runner, so the machine running Claude needs no inbound port.
 */
async function claimSummarize(c: RunnerCtx) {
  const now = Date.now();

  // Recycle jobs whose runner died mid-flight.
  await c.env.DB.prepare(
    `UPDATE jobs SET status = 'queued', stage = 'Requeued after a stalled run'
      WHERE status = 'running' AND claimed_at < ?1 AND attempts < ?2`,
  )
    .bind(now - STALE_MS, MAX_ATTEMPTS)
    .run();
  await c.env.DB.prepare(
    `UPDATE jobs SET status = 'failed', error = 'Gave up after repeated stalled runs', finished_at = ?1
      WHERE status = 'running' AND claimed_at < ?2 AND attempts >= ?3`,
  )
    .bind(now, now - STALE_MS, MAX_ATTEMPTS)
    .run();

  const job = await c.env.DB.prepare(
    `SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`,
  ).first<JobRow>();
  if (!job) return c.json({ job: null });

  // Guard against two runners racing: only the one that flips the row wins.
  const claim = await c.env.DB.prepare(
    `UPDATE jobs SET status = 'running', claimed_at = ?1, attempts = attempts + 1,
                     stage = 'Starting', error = NULL
      WHERE id = ?2 AND status = 'queued'`,
  )
    .bind(now, job.id)
    .run();
  if (!claim.meta.changes) return c.json({ job: null });

  const book = await c.env.DB.prepare('SELECT * FROM books WHERE id = ?1')
    .bind(job.book_id)
    .first<BookRow>();
  if (!book) {
    await c.env.DB.prepare(
      `UPDATE jobs SET status='failed', error='Book row vanished', finished_at=?1 WHERE id=?2`,
    )
      .bind(now, job.id)
      .run();
    return c.json({ job: null });
  }

  const markdown = await getText(c.env, book.content_key);
  if (markdown === null) {
    await c.env.DB.prepare(
      `UPDATE jobs SET status='failed', error='Book text missing from storage', finished_at=?1 WHERE id=?2`,
    )
      .bind(now, job.id)
      .run();
    return c.json({ job: null });
  }

  return c.json({
    job: {
      id: job.id,
      bookId: book.id,
      title: book.title,
      author: book.author,
      wordCount: book.word_count,
      attempt: job.attempts + 1,
      markdown,
    },
  });
}

/**
 * Progress doubles as a heartbeat: it pushes `claimed_at` forward so a job that
 * legitimately runs longer than STALE_MS is not mistaken for a dead one. Without
 * this, a long book gets requeued mid-run and a second runner starts summarizing
 * the same book in parallel — both finish, both write, double the usage spent.
 */
/**
 * Claim one pending question.
 *
 * Questions are claimed BEFORE summarization jobs, so a reader waiting on an
 * answer is not stuck behind books that have not started yet. A book already
 * running still finishes first — the runner makes one Claude call at a time.
 */
async function claimQuestion(c: RunnerCtx) {
  const now = Date.now();

  // Recycle questions whose runner died mid-answer.
  await c.env.DB.prepare(
    `UPDATE questions SET status='queued' WHERE status='running' AND claimed_at < ?1 AND attempts < ?2`,
  ).bind(now - STALE_MS, MAX_ATTEMPTS).run();
  await c.env.DB.prepare(
    `UPDATE questions SET status='failed', error='Gave up after repeated stalled runs', answered_at=?1
      WHERE status='running' AND claimed_at < ?2 AND attempts >= ?3`,
  ).bind(now, now - STALE_MS, MAX_ATTEMPTS).run();

  const q = await c.env.DB.prepare(
    `SELECT * FROM questions WHERE status='queued' ORDER BY created_at ASC LIMIT 1`,
  ).first<QuestionRow>();
  if (!q) return c.json({ question: null });

  const claim = await c.env.DB.prepare(
    `UPDATE questions SET status='running', claimed_at=?1, attempts=attempts+1, error=NULL
      WHERE id=?2 AND status='queued'`,
  ).bind(now, q.id).run();
  if (!claim.meta.changes) return c.json({ question: null });

  const book = await c.env.DB.prepare('SELECT * FROM books WHERE id = ?1')
    .bind(q.book_id)
    .first<BookRow>();
  const markdown = book ? await getText(c.env, book.content_key) : null;
  if (!book || markdown === null) {
    await c.env.DB.prepare(
      `UPDATE questions SET status='failed', error='Book text is missing from storage', answered_at=?1 WHERE id=?2`,
    ).bind(now, q.id).run();
    return c.json({ question: null });
  }

  // The summary is short and already paid for. Sending it alongside the
  // retrieved passages gives the model the book's own vocabulary and shape,
  // which keyword retrieval alone misses when a question is worded differently.
  const summary = await getText(c.env, summaryKey(book.id)).catch(() => null);

  // Recent turns only: enough for "what about that?" to resolve, not so much
  // that the conversation crowds out the passages.
  const { results: history } = await c.env.DB.prepare(
    `SELECT question, answer FROM questions
      WHERE book_id=?1 AND status='done' AND id != ?2
      ORDER BY created_at DESC LIMIT 2`,
  ).bind(book.id, q.id).all<{ question: string; answer: string }>();

  return c.json({
    question: {
      id: q.id,
      bookId: book.id,
      title: book.title,
      author: book.author,
      question: q.question,
      attempt: q.attempts + 1,
      markdown,
      summary,
      history: history.reverse(),
    },
  });
}

app.post('/ask/:id/complete', async (c) => {
  const id = c.req.param('id');
  const body = await readJson<{
    answer: string; sections: string[]; model: string; usage: RunUsage;
  }>(c.req);
  const answer = (body.answer ?? '').trim();
  if (!answer) throw new HTTPException(400, { message: 'Answer is empty' });

  const u: Partial<RunUsage> = body.usage ?? {};
  const res = await c.env.DB.prepare(
    `UPDATE questions SET status='done', answer=?1, sections=?2, model=?3,
                          input_tokens=?4, output_tokens=?5, cost_usd=?6,
                          answered_at=?7, error=NULL
      WHERE id=?8`,
  )
    .bind(
      answer,
      JSON.stringify(Array.isArray(body.sections) ? body.sections.slice(0, 20) : []),
      body.model ?? null,
      Math.max(0, Math.round(u.inputTokens ?? 0)),
      Math.max(0, Math.round(u.outputTokens ?? 0)),
      Math.max(0, u.costUsd ?? 0),
      Date.now(),
      id,
    )
    .run();
  if (!res.meta.changes) throw new HTTPException(404, { message: 'No such question' });
  return c.json({ ok: true });
});

app.post('/ask/:id/fail', async (c) => {
  const id = c.req.param('id');
  const body = await readJson<{ error: string; retry: boolean }>(c.req);
  const q = await c.env.DB.prepare('SELECT * FROM questions WHERE id = ?1')
    .bind(id)
    .first<QuestionRow>();
  if (!q) throw new HTTPException(404, { message: 'No such question' });

  const retryable = body.retry !== false && q.attempts < MAX_ATTEMPTS;
  const message = (body.error ?? 'Could not answer').slice(0, 2000);
  await c.env.DB.prepare(
    retryable
      ? `UPDATE questions SET status='queued', error=?1 WHERE id=?2`
      : `UPDATE questions SET status='failed', error=?1, answered_at=${Date.now()} WHERE id=?2`,
  ).bind(message, id).run();
  return c.json({ ok: true, requeued: retryable });
});

async function claimMindmap(c: RunnerCtx) {
  const now = Date.now();

  await c.env.DB.prepare(
    `UPDATE mindmaps SET status='queued' WHERE status='running' AND claimed_at < ?1 AND attempts < ?2`,
  ).bind(now - STALE_MS, MAX_ATTEMPTS).run();

  const m = await c.env.DB.prepare(
    `SELECT * FROM mindmaps WHERE status='queued' ORDER BY created_at ASC LIMIT 1`,
  ).first<MindmapRow>();
  if (!m) return null;

  const claim = await c.env.DB.prepare(
    `UPDATE mindmaps SET status='running', claimed_at=?1, attempts=attempts+1, error=NULL
      WHERE book_id=?2 AND status='queued'`,
  ).bind(now, m.book_id).run();
  if (!claim.meta.changes) return null;

  const book = await c.env.DB.prepare('SELECT * FROM books WHERE id = ?1')
    .bind(m.book_id)
    .first<BookRow>();
  // A map is built from the summary: it already distils the whole book into
  // themes, where the opening pages of the raw text would only describe a
  // title page. Without one there is nothing worth mapping.
  const summary = book ? await getText(c.env, summaryKey(book.id)) : null;
  if (!book || !summary) {
    await c.env.DB.prepare(
      `UPDATE mindmaps SET status='failed', error='This book has no summary to map yet', built_at=?1
        WHERE book_id=?2`,
    ).bind(now, m.book_id).run();
    return null;
  }

  return {
    bookId: book.id,
    title: book.title,
    author: book.author,
    attempt: m.attempts + 1,
    summary,
  };
}

/**
 * Hand the runner whatever work is next.
 *
 * One endpoint rather than one per kind: the runner polls every few seconds,
 * and a separate poll per kind would spend most of the Workers request
 * allowance on asking whether there is anything to do.
 *
 * Order is deliberate. Questions and maps are single, short calls, so they go
 * ahead of summarization jobs that have not started — a reader waiting on an
 * answer should not queue behind books nobody has begun. A book already
 * running still finishes first; the runner makes one call at a time.
 */
app.post('/next', async (c) => {
  const question = await claimQuestion(c);
  if (question) return c.json({ kind: 'question', question });

  const mindmap = await claimMindmap(c);
  if (mindmap) return c.json({ kind: 'mindmap', mindmap });

  const job = await claimSummarize(c);
  if (job) return c.json({ kind: 'summarize', job });

  return c.json({ kind: null });
});

app.post('/mindmap/:bookId/complete', async (c) => {
  const bookId = c.req.param('bookId');
  const body = await readJson<{ tree: unknown; nodes: number; model: string; usage: RunUsage }>(c.req);
  if (!body.tree || typeof body.tree !== 'object') {
    throw new HTTPException(400, { message: 'Tree is missing' });
  }
  const u: Partial<RunUsage> = body.usage ?? {};
  const res = await c.env.DB.prepare(
    `UPDATE mindmaps SET status='done', tree=?1, nodes=?2, model=?3,
                         input_tokens=?4, output_tokens=?5, cost_usd=?6,
                         built_at=?7, error=NULL
      WHERE book_id=?8`,
  )
    .bind(
      JSON.stringify(body.tree),
      Math.max(0, Math.round(body.nodes ?? 0)),
      body.model ?? null,
      Math.max(0, Math.round(u.inputTokens ?? 0)),
      Math.max(0, Math.round(u.outputTokens ?? 0)),
      Math.max(0, u.costUsd ?? 0),
      Date.now(),
      bookId,
    )
    .run();
  if (!res.meta.changes) throw new HTTPException(404, { message: 'No such map' });
  return c.json({ ok: true });
});

app.post('/mindmap/:bookId/fail', async (c) => {
  const bookId = c.req.param('bookId');
  const body = await readJson<{ error: string; retry: boolean }>(c.req);
  const m = await c.env.DB.prepare('SELECT * FROM mindmaps WHERE book_id = ?1')
    .bind(bookId)
    .first<MindmapRow>();
  if (!m) throw new HTTPException(404, { message: 'No such map' });

  const retryable = body.retry !== false && m.attempts < MAX_ATTEMPTS;
  const message = (body.error ?? 'Could not build the map').slice(0, 2000);
  await c.env.DB.prepare(
    retryable
      ? `UPDATE mindmaps SET status='queued', error=?1 WHERE book_id=?2`
      : `UPDATE mindmaps SET status='failed', error=?1, built_at=${Date.now()} WHERE book_id=?2`,
  ).bind(message, bookId).run();
  return c.json({ ok: true, requeued: retryable });
});

app.post('/jobs/:id/progress', async (c) => {
  const body = await readJson<{ stage: string; done: number; total: number }>(c.req);
  const res = await c.env.DB.prepare(
    `UPDATE jobs SET stage = COALESCE(?1, stage),
                     progress_done = COALESCE(?2, progress_done),
                     progress_total = COALESCE(?3, progress_total),
                     claimed_at = ?5
      WHERE id = ?4 AND status = 'running'`,
  )
    .bind(body.stage ?? null, body.done ?? null, body.total ?? null, c.req.param('id'), Date.now())
    .run();
  if (!res.meta.changes) throw new HTTPException(409, { message: 'Job is not running' });
  return c.json({ ok: true });
});

app.post('/jobs/:id/complete', async (c) => {
  const jobId = c.req.param('id');
  const body = await readJson<{ markdown: string; model: string; usage: RunUsage }>(c.req);
  const markdown = (body.markdown ?? '').trim();
  if (!markdown) throw new HTTPException(400, { message: 'Summary markdown is empty' });

  const job = await c.env.DB.prepare('SELECT * FROM jobs WHERE id = ?1').bind(jobId).first<JobRow>();
  if (!job) throw new HTTPException(404, { message: 'No such job' });

  const u: Partial<RunUsage> = body.usage ?? {};
  const key = summaryKey(job.book_id);
  await putText(c.env, key, markdown);

  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO summaries (book_id, job_id, summary_key, model, word_count, created_at,
                              input_tokens, output_tokens, cost_usd, chunks, duration_ms)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
       ON CONFLICT(book_id) DO UPDATE SET
         job_id=?2, summary_key=?3, model=?4, word_count=?5, created_at=?6,
         input_tokens=?7, output_tokens=?8, cost_usd=?9, chunks=?10, duration_ms=?11`,
    ).bind(
      job.book_id, jobId, key, body.model ?? null, countWords(markdown), now,
      Math.max(0, Math.round(u.inputTokens ?? 0)),
      Math.max(0, Math.round(u.outputTokens ?? 0)),
      Math.max(0, u.costUsd ?? 0),
      Math.max(0, Math.round(u.chunks ?? 0)),
      Math.max(0, Math.round(u.durationMs ?? 0)),
    ),
    c.env.DB.prepare(
      `UPDATE jobs SET status='done', stage='Complete', error=NULL, finished_at=?1,
                       progress_done = progress_total
        WHERE id=?2`,
    ).bind(now, jobId),
  ]);

  return c.json({ ok: true, summaryKey: key });
});

app.post('/jobs/:id/fail', async (c) => {
  const body = await readJson<{ error: string; retry: boolean }>(c.req);
  const jobId = c.req.param('id');
  const job = await c.env.DB.prepare('SELECT * FROM jobs WHERE id = ?1').bind(jobId).first<JobRow>();
  if (!job) throw new HTTPException(404, { message: 'No such job' });

  const retryable = body.retry !== false && job.attempts < MAX_ATTEMPTS;
  const message = (body.error ?? 'Summarization failed').slice(0, 2000);

  await c.env.DB.prepare(
    retryable
      ? `UPDATE jobs SET status='queued', stage='Retrying after an error', error=?1 WHERE id=?2`
      : `UPDATE jobs SET status='failed', stage='Failed', error=?1, finished_at=${Date.now()} WHERE id=?2`,
  )
    .bind(message, jobId)
    .run();

  return c.json({ ok: true, requeued: retryable });
});

/** Lets the runner report itself alive; handy for a health widget later. */
app.get('/ping', async (c) => {
  const pending = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running')`,
  ).first<{ n: number }>();
  return c.json({ ok: true, pending: pending?.n ?? 0, id: newId('ping') });
});

export default app;
