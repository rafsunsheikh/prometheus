-- Prometheus core schema.
-- Books hold the extracted markdown (in R2); D1 holds metadata and job state.

CREATE TABLE IF NOT EXISTS users (
  email       TEXT PRIMARY KEY,
  name        TEXT,
  picture     TEXT,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id           TEXT PRIMARY KEY,
  owner_email  TEXT NOT NULL,
  title        TEXT NOT NULL,
  author       TEXT,
  source_name  TEXT NOT NULL,
  source_format TEXT NOT NULL,          -- pdf | epub | docx | txt | md
  content_key  TEXT NOT NULL,           -- R2 key for extracted markdown
  char_count   INTEGER NOT NULL DEFAULT 0,
  word_count   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  FOREIGN KEY (owner_email) REFERENCES users(email)
);

CREATE INDEX IF NOT EXISTS idx_books_owner ON books(owner_email, created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id             TEXT PRIMARY KEY,
  book_id        TEXT NOT NULL,
  owner_email    TEXT NOT NULL,
  status         TEXT NOT NULL,         -- queued | running | done | failed
  stage          TEXT,                  -- human-readable current step
  progress_done  INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  claimed_at     INTEGER,
  finished_at    INTEGER,
  FOREIGN KEY (book_id) REFERENCES books(id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_book ON jobs(book_id, created_at DESC);

CREATE TABLE IF NOT EXISTS summaries (
  book_id      TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL,
  summary_key  TEXT NOT NULL,           -- R2 key for summary markdown
  model        TEXT,
  word_count   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id)
);
