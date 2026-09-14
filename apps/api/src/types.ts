export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  // vars
  ALLOWED_EMAILS: string;
  ALLOWED_ORIGINS: string;
  GOOGLE_CLIENT_ID: string;
  // secrets
  SESSION_SECRET: string;
  RUNNER_TOKEN: string;
  /** Who may see the admin view. Unset means nobody — it fails closed. */
  ADMIN_EMAILS: string;
}

export interface SessionUser {
  /** The identity that owns the library — the canonical address. */
  email: string;
  /** The address actually signed in with, when it differs from `email`. */
  via: string | null;
  name: string | null;
  picture: string | null;
}

export type Variables = {
  user: SessionUser;
};

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface BookRow {
  id: string;
  owner_email: string;
  title: string;
  author: string | null;
  source_name: string;
  source_format: string;
  content_key: string;
  char_count: number;
  word_count: number;
  created_at: number;
}

export interface JobRow {
  id: string;
  book_id: string;
  owner_email: string;
  status: JobStatus;
  stage: string | null;
  progress_done: number;
  progress_total: number;
  error: string | null;
  attempts: number;
  created_at: number;
  claimed_at: number | null;
  finished_at: number | null;
}

export interface SummaryRow {
  book_id: string;
  job_id: string;
  summary_key: string;
  model: string | null;
  word_count: number;
  created_at: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  chunks: number;
  duration_ms: number;
}

/** What a runner reports about the work it just did. */
export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  chunks: number;
  durationMs: number;
}
