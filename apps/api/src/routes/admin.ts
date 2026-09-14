import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireUser } from '../lib/middleware';
import { resolveIdentity } from '../lib/auth';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Words per printed page — the usual figure for trade nonfiction. Pages are
 *  an estimate: nothing in a PDF or EPUB survives extraction as a page count. */
const WORDS_PER_PAGE = 275;

/**
 * Admin is its own list, deliberately separate from ALLOWED_EMAILS: being
 * allowed to use Prometheus should never imply being allowed to see what
 * everyone else's usage costs. Unset means nobody — it fails closed.
 */
function isAdmin(env: Env, email: string): boolean {
  if (!env.ADMIN_EMAILS) return false;
  return env.ADMIN_EMAILS.split(',')
    .map((e) => resolveIdentity(env, e.trim()))
    .filter(Boolean)
    .includes(email);
}

app.use('*', requireUser, async (c, next) => {
  // Enforced here, on the server. Hiding the link in the UI is decoration:
  // anyone who knows the path could otherwise call this directly.
  if (!isAdmin(c.env, c.get('user').email)) {
    throw new HTTPException(403, { message: 'Not an administrator' });
  }
  await next();
});

interface Totals {
  books: number;
  summarized: number;
  words: number;
  chars: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  measured: number;
  seconds: number;
}

app.get('/stats', async (c) => {
  const totals = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM books)                           AS books,
       (SELECT COUNT(*) FROM summaries)                       AS summarized,
       (SELECT COALESCE(SUM(word_count),0) FROM books)        AS words,
       (SELECT COALESCE(SUM(char_count),0) FROM books)        AS chars,
       COALESCE(SUM(s.input_tokens),0)                        AS input_tokens,
       COALESCE(SUM(s.output_tokens),0)                       AS output_tokens,
       COALESCE(SUM(s.cost_usd),0)                            AS cost_usd,
       COALESCE(SUM(CASE WHEN s.input_tokens > 0 THEN 1 ELSE 0 END),0) AS measured,
       COALESCE(SUM(s.duration_ms),0) / 1000                  AS seconds
     FROM summaries s`,
  ).first<Totals>();

  // Questions cost real tokens too; a usage view that ignored them would
  // understate what the subscription is actually spending.
  const qs = await c.env.DB.prepare(
    `SELECT COUNT(*) AS asked,
            COALESCE(SUM(input_tokens),0)  AS input_tokens,
            COALESCE(SUM(output_tokens),0) AS output_tokens,
            COALESCE(SUM(cost_usd),0)      AS cost_usd
       FROM questions WHERE status = 'done'`,
  ).first<{ asked: number; input_tokens: number; output_tokens: number; cost_usd: number }>();

  const jobs = await c.env.DB.prepare(
    `SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`,
  ).all<{ status: string; n: number }>();

  const perUser = await c.env.DB.prepare(
    `SELECT b.owner_email AS email,
            COUNT(b.id)                                   AS books,
            COALESCE(SUM(b.word_count),0)                 AS words,
            COUNT(s.book_id)                              AS summarized,
            COALESCE(SUM(s.input_tokens + s.output_tokens),0) AS tokens,
            COALESCE(SUM(s.cost_usd),0)                   AS cost_usd
       FROM books b
       LEFT JOIN summaries s ON s.book_id = b.id
      GROUP BY b.owner_email
      ORDER BY books DESC`,
  ).all<{ email: string; books: number; words: number; summarized: number; tokens: number; cost_usd: number }>();

  const recent = await c.env.DB.prepare(
    `SELECT b.title, b.owner_email AS email, b.word_count AS words,
            s.created_at, s.input_tokens + s.output_tokens AS tokens,
            s.cost_usd, s.chunks, s.duration_ms, s.model
       FROM summaries s JOIN books b ON b.id = s.book_id
      ORDER BY s.created_at DESC LIMIT 15`,
  ).all();

  const t = totals ?? ({} as Totals);
  const q = qs ?? { asked: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
  const inputTokens = (t.input_tokens ?? 0) + q.input_tokens;
  const outputTokens = (t.output_tokens ?? 0) + q.output_tokens;
  const tokens = inputTokens + outputTokens;

  return c.json({
    totals: {
      books: t.books ?? 0,
      summarized: t.summarized ?? 0,
      words: t.words ?? 0,
      chars: t.chars ?? 0,
      pages: Math.round((t.words ?? 0) / WORDS_PER_PAGE),
      inputTokens,
      outputTokens,
      tokens,
      questionsAsked: q.asked,
      costUsd: (t.cost_usd ?? 0) + q.cost_usd,
      seconds: t.seconds ?? 0,
      // How many summaries carry real token data. Anything summarized before
      // usage was recorded reports zero, and saying so beats a total that
      // silently understates.
      measured: t.measured ?? 0,
      unmeasured: Math.max(0, (t.summarized ?? 0) - (t.measured ?? 0)),
    },
    wordsPerPage: WORDS_PER_PAGE,
    jobs: Object.fromEntries((jobs.results ?? []).map((r) => [r.status, r.n])),
    perUser: perUser.results ?? [],
    recent: recent.results ?? [],
  });
});

/** Lets the UI decide whether to show the admin link, without implying the
 *  answer is trusted — /stats re-checks on every call regardless. */
export function adminCheck(env: Env, email: string): boolean {
  return isAdmin(env, email);
}

export default app;
