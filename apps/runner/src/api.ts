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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.runnerToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export const api = {
  claim: () =>
    call<{ job: ClaimedJob | null }>('/api/runner/claim', { method: 'POST' }).then((r) => r.job),

  progress: (jobId: string, stage: string, done: number, total: number) =>
    call(`/api/runner/jobs/${jobId}/progress`, {
      method: 'POST',
      body: JSON.stringify({ stage, done, total }),
    }),

  complete: (jobId: string, markdown: string, model: string) =>
    call(`/api/runner/jobs/${jobId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ markdown, model }),
    }),

  fail: (jobId: string, error: string, retry: boolean) =>
    call<{ requeued: boolean }>(`/api/runner/jobs/${jobId}/fail`, {
      method: 'POST',
      body: JSON.stringify({ error, retry }),
    }),

  ping: () => call<{ ok: boolean; pending: number }>('/api/runner/ping'),
};
