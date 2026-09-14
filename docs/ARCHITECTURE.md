# Architecture

## Why it is shaped this way

Three requirements pulled against each other:

1. **It lives on `rafsunsheikh.github.io`.** GitHub Pages serves static files
   and nothing else — no server code, no secrets, no database.
2. **Only allowlisted Gmail accounts get in.** An allowlist checked in the
   browser is decoration; anyone can open devtools and edit it away. The check
   has to happen somewhere the user does not control.
3. **Summarizing runs on a Claude Pro/Max subscription.** That subscription has
   no third-party HTTP API. The only way to spend it programmatically is the
   Claude Code CLI, running on a machine that is already signed in — and
   Cloudflare Workers cannot run a CLI.

So the work splits across three places, each doing what it is actually able to do.

```
  ┌─────────────────────────────────────┐
  │  Browser — GitHub Pages (static)    │
  │                                     │
  │  · Google Sign-In → ID token        │
  │  · PDF/EPUB/DOCX → markdown         │   The file itself never
  │  · Renders summaries, exports       │   leaves the device; only
  └──────────────┬──────────────────────┘   extracted text is sent.
                 │  HTTPS + session token
                 ▼
  ┌─────────────────────────────────────┐
  │  Cloudflare Worker — the API        │
  │                                     │
  │  · Verifies Google's signature      │   Holds NO Claude
  │  · Enforces the allowlist           │   credential at all.
  │  · D1: metadata + job queue         │
  │  · R2: book text + summaries        │
  └──────────────▲──────────────────────┘
                 │  outbound polling only
                 │  (no inbound port, no tunnel)
  ┌──────────────┴──────────────────────┐
  │  Runner — your Mac or home server   │
  │                                     │
  │  · Claims queued jobs               │
  │  · Chunks the book, maps, reduces   │
  │  · `claude -p` on your subscription │
  └─────────────────────────────────────┘
```

The runner **pulls**. Nothing ever connects *to* your machine, so it needs no
open port, no Cloudflare Tunnel, no dynamic DNS. Close the laptop and jobs just
sit in the queue until it comes back.

## Where trust actually sits

| Claim | Checked by | How |
| --- | --- | --- |
| "I am this Gmail account" | Worker | Google's JWT signature, verified against Google's JWKS |
| "That account may use Prometheus" | Worker | `ALLOWED_EMAILS`, re-checked on **every** request, not just at sign-in |
| "...and which library is theirs" | Worker | The address resolves to a canonical identity, so a person's several Google accounts open one library rather than several empty ones |
| "I am the runner" | Worker | Shared `RUNNER_TOKEN`, compared in constant time |
| "This book is mine" | Worker | Every book query is scoped by `owner_email` |

Revoking access is one `wrangler deploy` away: drop the address from
`ALLOWED_EMAILS` and existing sessions stop working on their next request,
rather than lingering until their token expires.

## The summarization pass

A long book does not fit in one turn, and stuffing it into one would produce a
shallow summary even if it did. So Socrates does map-reduce:

1. **Chunk** at the most natural boundary available — markdown headings first,
   then paragraph breaks, then a hard character cut as a last resort.
2. **Map** — one Claude call per section, producing a dense section summary with
   key points and any standout quotation.
3. **Reduce** — one final call that synthesizes the section summaries into the
   finished document: core argument, themes, chapter-by-chapter, takeaways.

Books under the chunk limit skip straight to a single whole-text pass, which
reads far more coherently than stitching two halves together.

Calls run **sequentially**, not in parallel. Parallel headless sessions contend
for the same subscription rate limits and fail loudly; sequential is slower but
finishes.

## Failure handling

- A job whose runner dies mid-flight is requeued after 30 minutes of **silence** —
  progress updates count as a heartbeat and push that deadline forward, so a book
  that genuinely takes longer than 30 minutes is not mistaken for a dead run and
  handed to a second runner while the first is still working on it.
- Three failed attempts and the job stops retrying and reports the error.
- Progress updates are best-effort — a failed progress POST never kills a
  summarization that is otherwise going fine.
- Two runners polling at once is safe: the claim is a conditional `UPDATE`, and
  only the runner that actually flips the row gets the job.

## Data

| What | Where | Notes |
| --- | --- | --- |
| Book metadata, jobs | D1 (SQLite) | Small rows, queried per user |
| Extracted book text | R2 | `books/<id>/content.md` |
| Summary | R2 | `books/<id>/summary.md` |
| The original file | Nowhere | Never uploaded; extraction is client-side |
| Session token | Browser `localStorage` | 7-day HS256 JWT |

Deleting a book deletes its R2 prefix, its summary row and its job history.
