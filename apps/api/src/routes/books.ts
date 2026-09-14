import { Hono } from 'hono';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireUser } from '../lib/middleware';
import { contentKey, countWords, deletePrefix, getText, newId, putText, readJson, summaryKey } from '../lib/storage';
import type { BookRow, Env, JobRow, QuestionRow, SummaryRow, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireUser);

/** Hard ceiling on extracted text. R2 could hold more, but a book beyond this
 *  is almost always a bad extraction, and it would cost real time to summarize. */
const MAX_CHARS = 4_000_000;

interface BookListItem extends BookRow {
  job_status: string | null;
  job_stage: string | null;
  job_done: number | null;
  job_total: number | null;
  job_error: string | null;
  has_summary: number;
}

const LIST_SQL = `
  SELECT b.*,
         j.status AS job_status, j.stage AS job_stage,
         j.progress_done AS job_done, j.progress_total AS job_total,
         j.error AS job_error,
         CASE WHEN s.book_id IS NULL THEN 0 ELSE 1 END AS has_summary
    FROM books b
    LEFT JOIN summaries s ON s.book_id = b.id
    LEFT JOIN jobs j ON j.id = (
      SELECT id FROM jobs WHERE book_id = b.id ORDER BY created_at DESC LIMIT 1
    )
   WHERE b.owner_email = ?1`;

function shape(row: BookListItem) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    sourceName: row.source_name,
    sourceFormat: row.source_format,
    charCount: row.char_count,
    wordCount: row.word_count,
    createdAt: row.created_at,
    hasSummary: row.has_summary === 1,
    job: row.job_status
      ? {
          status: row.job_status,
          stage: row.job_stage,
          done: row.job_done ?? 0,
          total: row.job_total ?? 0,
          error: row.job_error,
        }
      : null,
  };
}

app.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`${LIST_SQL} ORDER BY b.created_at DESC`)
    .bind(c.get('user').email)
    .all<BookListItem>();
  return c.json({ books: results.map(shape) });
});

app.post('/', async (c) => {
  const user = c.get('user');
  const body = await readJson<{
    title: string;
    author: string | null;
    sourceName: string;
    sourceFormat: string;
    markdown: string;
  }>(c.req);

  const markdown = (body.markdown ?? '').trim();
  const title = (body.title ?? '').trim();
  if (!title) throw new HTTPException(400, { message: 'A title is required' });
  if (markdown.length < 200) {
    throw new HTTPException(400, {
      message: 'Extracted text is under 200 characters — the file may be scanned images rather than text.',
    });
  }
  if (markdown.length > MAX_CHARS) {
    throw new HTTPException(413, {
      message: `Extracted text is ${markdown.length.toLocaleString()} characters, over the ${MAX_CHARS.toLocaleString()} limit.`,
    });
  }

  const bookId = newId('bk');
  const key = contentKey(bookId);
  await putText(c.env, key, markdown);

  const now = Date.now();
  const jobId = newId('job');

  await c.env.DB.batch([
    // A session token can outlive its users row, so never assume sign-in left
    // one behind — the books FK depends on it existing.
    c.env.DB.prepare(
      `INSERT INTO users (email, name, picture, first_seen, last_seen)
       VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT(email) DO UPDATE SET last_seen = ?4`,
    ).bind(user.email, user.name, user.picture, now),
    c.env.DB.prepare(
      `INSERT INTO books (id, owner_email, title, author, source_name, source_format,
                          content_key, char_count, word_count, created_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
    ).bind(
      bookId,
      user.email,
      title,
      body.author?.trim() || null,
      body.sourceName ?? title,
      body.sourceFormat ?? 'txt',
      key,
      markdown.length,
      countWords(markdown),
      now,
    ),
    c.env.DB.prepare(
      `INSERT INTO jobs (id, book_id, owner_email, status, stage, created_at)
       VALUES (?1,?2,?3,'queued','Waiting for a runner',?4)`,
    ).bind(jobId, bookId, user.email, now),
  ]);

  return c.json({ bookId, jobId }, 201);
});

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

async function ownedBook(c: Ctx, id: string): Promise<BookRow> {
  const row = await c.env.DB.prepare('SELECT * FROM books WHERE id = ?1 AND owner_email = ?2')
    .bind(id, c.get('user').email)
    .first<BookRow>();
  if (!row) throw new HTTPException(404, { message: 'Book not found' });
  return row;
}

app.get('/:id', async (c) => {
  const row = await c.env.DB.prepare(`${LIST_SQL} AND b.id = ?2`)
    .bind(c.get('user').email, c.req.param('id'))
    .first<BookListItem>();
  if (!row) throw new HTTPException(404, { message: 'Book not found' });
  return c.json({ book: shape(row) });
});

app.get('/:id/content', async (c) => {
  const book = await ownedBook(c, c.req.param('id'));
  const text = await getText(c.env, book.content_key);
  if (text === null) throw new HTTPException(404, { message: 'Book text is missing from storage' });
  return c.json({ markdown: text });
});

app.get('/:id/summary', async (c) => {
  const book = await ownedBook(c, c.req.param('id'));
  const summary = await c.env.DB.prepare('SELECT * FROM summaries WHERE book_id = ?1')
    .bind(book.id)
    .first<SummaryRow>();
  if (!summary) throw new HTTPException(404, { message: 'No summary yet' });
  const text = await getText(c.env, summary.summary_key);
  if (text === null) throw new HTTPException(404, { message: 'Summary is missing from storage' });
  return c.json({
    markdown: text,
    model: summary.model,
    wordCount: summary.word_count,
    createdAt: summary.created_at,
  });
});

app.post('/:id/summarize', async (c) => {
  const book = await ownedBook(c, c.req.param('id'));
  const active = await c.env.DB.prepare(
    `SELECT id FROM jobs WHERE book_id = ?1 AND status IN ('queued','running') LIMIT 1`,
  )
    .bind(book.id)
    .first<{ id: string }>();
  if (active) return c.json({ jobId: active.id, alreadyRunning: true });

  const jobId = newId('job');
  await c.env.DB.prepare(
    `INSERT INTO jobs (id, book_id, owner_email, status, stage, created_at)
     VALUES (?1,?2,?3,'queued','Waiting for a runner',?4)`,
  )
    .bind(jobId, book.id, c.get('user').email, Date.now())
    .run();
  return c.json({ jobId, alreadyRunning: false }, 202);
});

/** Longest question we will carry. Anything beyond this is a document, not a
 *  question, and would crowd the retrieved passages out of the prompt. */
const MAX_QUESTION_CHARS = 2000;

app.post('/:id/ask', async (c) => {
  const book = await ownedBook(c, c.req.param('id'));
  const body = await readJson<{ question: string }>(c.req);
  const question = (body.question ?? '').trim();

  if (question.length < 3) throw new HTTPException(400, { message: 'Ask an actual question' });
  if (question.length > MAX_QUESTION_CHARS) {
    throw new HTTPException(413, { message: `Questions are capped at ${MAX_QUESTION_CHARS} characters.` });
  }

  const id = newId('q');
  await c.env.DB.prepare(
    `INSERT INTO questions (id, book_id, owner_email, question, status, created_at)
     VALUES (?1,?2,?3,?4,'queued',?5)`,
  )
    .bind(id, book.id, c.get('user').email, question, Date.now())
    .run();

  return c.json({ questionId: id }, 201);
});

app.get('/:id/questions', async (c) => {
  const book = await ownedBook(c, c.req.param('id'));
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM questions WHERE book_id = ?1 ORDER BY created_at ASC`,
  )
    .bind(book.id)
    .all<QuestionRow>();

  // How much work sits in front of a pending question, so the reader can be
  // told why they are waiting rather than watching an unexplained spinner.
  const pending = results.some((q) => q.status === 'queued' || q.status === 'running');
  let waitingFor: { title: string; stage: string | null; done: number; total: number } | null = null;
  if (pending) {
    waitingFor = await c.env.DB.prepare(
      `SELECT b.title, j.stage, j.progress_done AS done, j.progress_total AS total
         FROM jobs j JOIN books b ON b.id = j.book_id
        WHERE j.status = 'running' LIMIT 1`,
    ).first<{ title: string; stage: string | null; done: number; total: number }>();
  }

  return c.json({
    questions: results.map((q) => ({
      id: q.id,
      question: q.question,
      answer: q.answer,
      sections: q.sections ? (JSON.parse(q.sections) as string[]) : [],
      status: q.status,
      error: q.error,
      createdAt: q.created_at,
      answeredAt: q.answered_at,
    })),
    waitingFor,
  });
});

app.delete('/:id', async (c) => {
  const book = await ownedBook(c, c.req.param('id'));
  await deletePrefix(c.env, `books/${book.id}/`);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM questions WHERE book_id = ?1').bind(book.id),
    c.env.DB.prepare('DELETE FROM summaries WHERE book_id = ?1').bind(book.id),
    c.env.DB.prepare('DELETE FROM jobs WHERE book_id = ?1').bind(book.id),
    c.env.DB.prepare('DELETE FROM books WHERE id = ?1').bind(book.id),
  ]);
  return c.json({ deleted: book.id });
});

app.get('/:id/job', async (c) => {
  const book = await ownedBook(c, c.req.param('id'));
  const job = await c.env.DB.prepare(
    'SELECT * FROM jobs WHERE book_id = ?1 ORDER BY created_at DESC LIMIT 1',
  )
    .bind(book.id)
    .first<JobRow>();
  if (!job) return c.json({ job: null });
  return c.json({
    job: {
      id: job.id,
      status: job.status,
      stage: job.stage,
      done: job.progress_done,
      total: job.progress_total,
      error: job.error,
      createdAt: job.created_at,
      finishedAt: job.finished_at,
    },
  });
});

export { summaryKey };
export default app;
