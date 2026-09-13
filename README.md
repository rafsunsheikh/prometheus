<div align="center">

# 🔥 Prometheus

**A private workshop for a few good tools.**

First tool in the fire: **Socrates** — upload a book, get a real summary, keep both.

</div>

---

## What Socrates does

You drop in a PDF, EPUB, DOCX, TXT or Markdown file. Your browser pulls the text
out locally — the file itself never leaves your device. The text goes to a small
API, a runner on your own machine reads it end to end with Claude, and a
structured summary comes back: core argument, key themes, chapter-by-chapter,
takeaways, and the passages worth quoting.

Both the summary and the full text stay in your library, so you can come back and
re-read either. Export the summary as **PDF**, **Word** or **Markdown**.

## How it is put together

GitHub Pages cannot run server code, and a Claude Pro/Max subscription has no
HTTP API — so the work splits three ways:

| Piece | Runs on | Job |
| --- | --- | --- |
| `apps/web` | GitHub Pages | React app. Google sign-in, text extraction, reading, export |
| `apps/api` | Cloudflare Worker | Verifies identity, enforces the allowlist, stores books (R2) and jobs (D1) |
| `apps/runner` | Your Mac or home server | Polls for jobs, drives `claude -p` on your subscription |

The runner **pulls** work. Nothing connects *to* your machine — no open port, no
tunnel. The Worker never holds a Claude credential.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the reasoning and the
trust boundaries.

## Setup

Four things to create: a Google OAuth client, a D1 database, an R2 bucket, and
two secrets. Roughly 20 minutes.

### 1. Install

```bash
git clone https://github.com/rafsunsheikh/prometheus.git
cd prometheus
npm install
```

### 2. Google OAuth client

At [console.cloud.google.com](https://console.cloud.google.com/apis/credentials):

1. Create a project, then **Create Credentials → OAuth client ID → Web application**.
2. Under **Authorized JavaScript origins**, add both:
   - `https://rafsunsheikh.github.io`
   - `http://localhost:5173` (for local development)
3. Leave redirect URIs empty — Google Identity Services does not use them here.
4. Copy the **Client ID**. It is a public value; it ships in the bundle by design.

On the **OAuth consent screen**, set the publishing status to **Testing** and add
the Gmail accounts you want as test users. That is Google's own gate; the
allowlist below is yours, and both apply.

### 3. Cloudflare

```bash
npx wrangler login

# Database
npx wrangler d1 create prometheus-db
#   → copy the printed database_id into apps/api/wrangler.toml

# Object storage
npx wrangler r2 bucket create prometheus-library
```

Then edit `apps/api/wrangler.toml`:

```toml
[vars]
ALLOWED_EMAILS  = "you.alt@example.com,friend@example.com"   # your allowlist
ALLOWED_ORIGINS = "https://rafsunsheikh.github.io,http://localhost:5173"
GOOGLE_CLIENT_ID = "<the client ID from step 2>"

[[d1_databases]]
database_id = "<the id wrangler printed>"
```

Set the two secrets and deploy:

```bash
cd apps/api
openssl rand -base64 48 | npx wrangler secret put SESSION_SECRET
openssl rand -hex 32   | npx wrangler secret put RUNNER_TOKEN   # save this, the runner needs it
npx wrangler d1 migrations apply prometheus-db --remote
npx wrangler deploy
```

Note the deployed URL — `https://prometheus-api.<subdomain>.workers.dev`.

### 4. The runner

The machine that runs this must already be signed into Claude Code. Run `claude`
once interactively and complete the login if you have not.

```bash
cp apps/runner/.env.example apps/runner/.env
```

```ini
PROMETHEUS_API_URL="https://prometheus-api.<subdomain>.workers.dev"
PROMETHEUS_RUNNER_TOKEN="<the RUNNER_TOKEN from step 3>"
CLAUDE_BIN="/Users/you/.local/bin/claude"
CLAUDE_MODEL="sonnet"
```

> `CLAUDE_BIN` must point at the **real binary**, not a shell function. Check with
> `type claude` — if it prints a function body, use the path inside it.

```bash
npm run dev:runner          # foreground
npm run once -w @prometheus/runner   # drain one job and exit
```

To keep it alive, see `apps/runner/com.prometheus.runner.plist.example` (macOS)
or `apps/runner/prometheus-runner.service.example` (Linux).

### 5. Deploy the web app

In the GitHub repo, under **Settings → Secrets and variables → Actions → Variables**,
add two repository *variables*:

| Name | Value |
| --- | --- |
| `VITE_API_URL` | `https://prometheus-api.<subdomain>.workers.dev` |
| `VITE_GOOGLE_CLIENT_ID` | the client ID from step 2 |

Then **Settings → Pages → Source: GitHub Actions**, and push to `main`. The site
lands at `https://rafsunsheikh.github.io/prometheus/`.

## Local development

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars     # fill in both secrets
cp apps/web/.env.example apps/web/.env.local         # point at http://127.0.0.1:8787

npm run db:migrate:local
npm run dev:api      # → http://127.0.0.1:8787
npm run dev:web      # → http://localhost:5173
npm run dev:runner
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev:web` | Vite dev server |
| `npm run dev:api` | Worker on `127.0.0.1:8787` |
| `npm run dev:runner` | Poll and summarize continuously |
| `npm run typecheck` | Typecheck every workspace |
| `npm run build` | Typecheck the API, build the web bundle |
| `npm run db:migrate:remote` | Apply migrations to the live D1 |

## Adding or removing people

Edit `ALLOWED_EMAILS` in `apps/api/wrangler.toml` and redeploy. The allowlist is
re-checked on every request, so removing someone cuts them off immediately rather
than when their token happens to expire.

## Notes and limits

- **Scanned PDFs do not work.** If the pages are images, there is no text to
  extract. Run OCR first.
- **PDF export goes through the browser's print dialog.** That gives real,
  selectable text and correct pagination, which a canvas-rasterizing library does
  not — the trade is one extra click on "Save".
- **The runner is a single worker.** Jobs run one at a time, in order. Parallel
  headless Claude sessions contend for the same subscription limits.
- **A 500-page book takes several minutes** and burns a real slice of your
  subscription allowance. The runner logs the cost of each run.
- **Your subscription is for your own use.** Keep the allowlist small and
  personal.

## Licence

MIT
