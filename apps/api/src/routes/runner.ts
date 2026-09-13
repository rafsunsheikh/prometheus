import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireRunner } from '../lib/middleware';
import { countWords, getText, newId, putText, readJson, summaryKey } from '../lib/storage';
import type { BookRow, Env, JobRow, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireRunner);

/** A job claimed but silent this long is assumed dead and returned to the queue. */
const STALE_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 3;

/**
 * Claim the oldest queued job. The runner polls this; the Worker never reaches
 * out to the runner, so the machine running Claude needs no inbound port.
 */
app.post('/claim', async (c) => {
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
});

app.post('/jobs/:id/progress', async (c) => {
  const body = await readJson<{ stage: string; done: number; total: number }>(c.req);
  const res = await c.env.DB.prepare(
    `UPDATE jobs SET stage = COALESCE(?1, stage),
                     progress_done = COALESCE(?2, progress_done),
                     progress_total = COALESCE(?3, progress_total)
      WHERE id = ?4 AND status = 'running'`,
  )
    .bind(body.stage ?? null, body.done ?? null, body.total ?? null, c.req.param('id'))
    .run();
  if (!res.meta.changes) throw new HTTPException(409, { message: 'Job is not running' });
  return c.json({ ok: true });
});

app.post('/jobs/:id/complete', async (c) => {
  const jobId = c.req.param('id');
  const body = await readJson<{ markdown: string; model: string }>(c.req);
  const markdown = (body.markdown ?? '').trim();
  if (!markdown) throw new HTTPException(400, { message: 'Summary markdown is empty' });

  const job = await c.env.DB.prepare('SELECT * FROM jobs WHERE id = ?1').bind(jobId).first<JobRow>();
  if (!job) throw new HTTPException(404, { message: 'No such job' });

  const key = summaryKey(job.book_id);
  await putText(c.env, key, markdown);

  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO summaries (book_id, job_id, summary_key, model, word_count, created_at)
       VALUES (?1,?2,?3,?4,?5,?6)
       ON CONFLICT(book_id) DO UPDATE SET
         job_id=?2, summary_key=?3, model=?4, word_count=?5, created_at=?6`,
    ).bind(job.book_id, jobId, key, body.model ?? null, countWords(markdown), now),
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
