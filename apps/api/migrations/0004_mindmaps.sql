-- A concept map of a book, built from its summary.
--
-- The tree is stored as JSON rather than as rendered mermaid or markmap text:
-- the structure is the artifact, and keeping it means the drawing can change
-- without paying to generate the map again.

CREATE TABLE IF NOT EXISTS mindmaps (
  book_id       TEXT PRIMARY KEY,
  owner_email   TEXT NOT NULL,
  tree          TEXT,                    -- JSON {label, children[]}; NULL until built
  status        TEXT NOT NULL,           -- queued | running | done | failed
  error         TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  nodes         INTEGER NOT NULL DEFAULT 0,
  model         TEXT,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL    NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  claimed_at    INTEGER,
  built_at      INTEGER,
  FOREIGN KEY (book_id) REFERENCES books(id)
);

CREATE INDEX IF NOT EXISTS idx_mindmaps_status ON mindmaps(status, created_at);
