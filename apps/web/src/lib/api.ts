const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
const TOKEN_KEY = 'prometheus.session';

export interface User {
  /** The identity owning the library. */
  email: string;
  /** Which of your addresses you signed in with, when it is not `email`. */
  via: string | null;
  name: string | null;
  picture: string | null;
  /** Advisory only — the server re-checks on every admin request. */
  isAdmin?: boolean;
}

export interface AdminStats {
  totals: {
    books: number; summarized: number; words: number; chars: number; pages: number;
    inputTokens: number; outputTokens: number; tokens: number; costUsd: number;
    seconds: number; measured: number; unmeasured: number;
  };
  wordsPerPage: number;
  jobs: Record<string, number>;
  perUser: { email: string; books: number; words: number; summarized: number; tokens: number; cost_usd: number }[];
  recent: {
    title: string; email: string; words: number; created_at: number;
    tokens: number; cost_usd: number; chunks: number; duration_ms: number; model: string | null;
  }[];
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

/**
 * localStorage is not always available — Safari private windows and some
 * tracking-prevention settings make it throw on read or write. Losing the
 * "stay signed in" convenience is acceptable; failing the sign-in is not, so
 * fall back to memory and keep going.
 */
let memoryToken: string | null = null;

export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY) ?? memoryToken;
    } catch {
      return memoryToken;
    }
  },
  set: (t: string) => {
    memoryToken = t;
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      console.warn('[prometheus] Browser storage is unavailable; staying signed in for this tab only.');
    }
  },
  clear: () => {
    memoryToken = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nothing to clear */
    }
  },
};

/** No request may hang forever — a silent stall is the worst failure to debug. */
const REQUEST_TIMEOUT_MS = 25_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = tokenStore.get();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  let text: string;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: abort.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    text = await res.text();
  } catch (err) {
    // Turn a stall or a blocked request into something readable, rather than
    // a promise that never settles and a spinner that never stops.
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    const message = aborted
      ? `The API did not respond within ${REQUEST_TIMEOUT_MS / 1000}s (${BASE}).`
      : `Could not reach the API at ${BASE}. Check your connection, or whether a content blocker is blocking it.`;
    console.error('[prometheus]', path, err);
    throw new ApiError(message, 0);
  } finally {
    clearTimeout(timer);
  }

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

  adminStats: () => request<AdminStats>('/api/admin/stats'),

  deleteBook: (id: string) => request<{ deleted: string }>(`/api/books/${id}`, { method: 'DELETE' }),
};

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
export const API_BASE = BASE;
