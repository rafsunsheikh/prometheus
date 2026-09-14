-- Grounded questions asked of a single book.
--
-- Answers live here rather than in R2: they are short, always read alongside
-- their question, and listing a conversation should be one query.

CREATE TABLE IF NOT EXISTS questions (
  id            TEXT PRIMARY KEY,
  book_id       TEXT NOT NULL,
  owner_email   TEXT NOT NULL,
  question      TEXT NOT NULL,
  answer        TEXT,                    -- markdown; NULL until answered
  sections      TEXT,                    -- JSON array of the book sections drawn on
  status        TEXT NOT NULL,           -- queued | running | done | failed
  error         TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL    NOT NULL DEFAULT 0,
  model         TEXT,
  created_at    INTEGER NOT NULL,
  claimed_at    INTEGER,
  answered_at   INTEGER,
  FOREIGN KEY (book_id) REFERENCES books(id)
);

CREATE INDEX IF NOT EXISTS idx_questions_book ON questions(book_id, created_at);
CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(status, created_at);
