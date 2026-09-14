import { config } from './config.js';

export interface ClaimedJob {
  id: string;
  bookId: string;
  title: string;
  author: string | null;
  wordCount: number;
  attempt: number;
  markdown: string;
}

const MAX_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * A home connection is not a data centre: DNS flaps, IPv6 routes break, the
 * link drops. A transient failure must not lose a book that took minutes of
 * subscription usage to summarize, so network errors and 5xx responses are
 * retried with backoff. A 4xx is a real answer and is never retried.
 */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${config.apiUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.runnerToken}`,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
      });
      const text = await res.text();

      if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
        lastError = new Error(`${path} → ${res.status}`);
        await sleep(attempt * 2000);
        continue;
      }
      if (!res.ok) {
        throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
      }
      return (text ? JSON.parse(text) : {}) as T;
    } catch (err) {
      // An HTTP error we raised ourselves is a real answer — do not retry it.
      if (err instanceof Error && / → \d{3}/.test(err.message)) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_ATTEMPTS) await sleep(attempt * 2000);
    }
  }

  throw new Error(
    `${init?.method ?? 'GET'} ${path} failed after ${MAX_ATTEMPTS} attempts: ${lastError?.message}`,
  );
}

export interface ClaimedQuestion {
  id: string;
  bookId: string;
  title: string;
  author: string | null;
  question: string;
  attempt: number;
  markdown: string;
  summary: string | null;
  history: { question: string; answer: string }[];
}

export const api = {
  claimQuestion: () =>
    call<{ question: ClaimedQuestion | null }>('/api/runner/ask/claim', { method: 'POST' })
      .then((r) => r.question),

  answerQuestion: (
    id: string,
    answer: string,
    sections: string[],
    model: string,
    usage: { inputTokens: number; outputTokens: number; costUsd: number },
  ) =>
    call(`/api/runner/ask/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ answer, sections, model, usage }),
    }),

  failQuestion: (id: string, error: string, retry: boolean) =>
    call<{ requeued: boolean }>(`/api/runner/ask/${id}/fail`, {
      method: 'POST',
      body: JSON.stringify({ error, retry }),
    }),

  claim: () =>
    call<{ job: ClaimedJob | null }>('/api/runner/claim', { method: 'POST' }).then((r) => r.job),

  progress: (jobId: string, stage: string, done: number, total: number) =>
    call(`/api/runner/jobs/${jobId}/progress`, {
      method: 'POST',
      body: JSON.stringify({ stage, done, total }),
    }),

  complete: (
    jobId: string,
    markdown: string,
    model: string,
    usage: { inputTokens: number; outputTokens: number; costUsd: number; chunks: number; durationMs: number },
  ) =>
    call(`/api/runner/jobs/${jobId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ markdown, model, usage }),
    }),

  fail: (jobId: string, error: string, retry: boolean) =>
    call<{ requeued: boolean }>(`/api/runner/jobs/${jobId}/fail`, {
      method: 'POST',
      body: JSON.stringify({ error, retry }),
    }),

  ping: () => call<{ ok: boolean; pending: number }>('/api/runner/ping'),
};
