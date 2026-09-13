const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
const TOKEN_KEY = 'prometheus.session';

export interface User {
  email: string;
  name: string | null;
  picture: string | null;
}

export interface JobState {
  status: 'queued' | 'running' | 'done' | 'failed';
  stage: string | null;
  done: number;
  total: number;
  error: string | null;
}

export interface Book {
  id: string;
  title: string;
  author: string | null;
  sourceName: string;
  sourceFormat: string;
  charCount: number;
  wordCount: number;
  createdAt: number;
  hasSummary: boolean;
  job: JobState | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body — fall through to the status-based message */
  }

  if (!res.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed (${res.status})`;
    if (res.status === 401) tokenStore.clear();
    throw new ApiError(message, res.status);
  }
  return payload as T;
}

export const api = {
  signInWithGoogle: (credential: string) =>
    request<{ token: string; user: User }>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential }),
    }),

  me: () => request<{ user: User }>('/api/auth/me'),

  listBooks: () => request<{ books: Book[] }>('/api/books'),

  getBook: (id: string) => request<{ book: Book }>(`/api/books/${id}`),

  createBook: (input: {
    title: string;
    author: string | null;
    sourceName: string;
    sourceFormat: string;
    markdown: string;
  }) =>
    request<{ bookId: string; jobId: string }>('/api/books', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getContent: (id: string) => request<{ markdown: string }>(`/api/books/${id}/content`),

  getSummary: (id: string) =>
    request<{ markdown: string; model: string | null; wordCount: number; createdAt: number }>(
      `/api/books/${id}/summary`,
    ),

  resummarize: (id: string) =>
    request<{ jobId: string; alreadyRunning: boolean }>(`/api/books/${id}/summarize`, {
      method: 'POST',
    }),

  deleteBook: (id: string) => request<{ deleted: string }>(`/api/books/${id}`, { method: 'DELETE' }),
};

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
export const API_BASE = BASE;
