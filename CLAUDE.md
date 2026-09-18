# Statement Ledger — CLAUDE.md

## What this is

A local Windows desktop app (React + Electron UI, FastAPI backend) that
imports bank statement PDFs, auto-categorizes every transaction, and
improves its categorization the more statements it sees. Everything is
stored locally in `data/` next to the app — nothing is uploaded anywhere.
See [README.md](README.md) for the full user-facing description.

## Worktrees

This repo is checked out as **two git worktrees on the same machine**:

| Path | Branch |
|---|---|
| `D:\statement_ledger_app\statement_ledger_app` | `main` |
| `D:\statement_ledger_app\statement_ledger_app-features` | `features` |

They share one `.git` (and one stash stack), but each has its own working
tree and its own `venv/` / `data/` folders once set up. When working in
one worktree, don't assume changes are visible in the other until they're
committed and merged — always confirm which directory (and branch) you're
actually in before editing. Do not `cd` between them; operate on the path
you're given.

## Architecture

- `backend/main.py` — FastAPI app (`uvicorn backend.main:app`) exposing
  the Import/Transactions/Dashboard functionality as a JSON API for the
  React/Electron UI. See the section below.
- `parser.py` — `parse_statement_pdf()` extracts transaction rows from a
  statement PDF (`pdfplumber`). Expects columns `Tran Date | Chq No |
  Particulars | Debit | Credit | Balance`. This is the only function that
  needs changing to support a new bank's PDF layout.
- `categorizer.py` — three-layer categorization, checked in order:
  1. **Rules** (`rules.json`) — regex/keyword patterns, always trusted.
  2. **Memory** — remembered category per counterparty from past
     confirmations.
  3. **ML** — TF-IDF + logistic regression classifier (scikit-learn),
     trained on confirmed transactions; falls back to `UNCATEGORIZED` if
     not confident.
- `storage.py` — SQLite persistence (`data/ledger.db`, two tables:
  `statements`, `transactions`). A transaction is deduped on
  `UNIQUE(date, particulars, debit, credit, balance)` — reimporting an
  overlapping statement silently skips rows already in the ledger.
  Rule-matched transactions are inserted already `confirmed=1`
  (trusted); ML/none are left `confirmed=0` for the user to review.
  `get_training_examples()` (confirmed rows only) is what
  `Categorizer.retrain()` trains on.
- `rules.json` — user-editable categorization rules. **Loaded once at
  backend startup only** (`RuleEngine.__init__` → `.reload()`), not
  re-read per import — despite what `rules.json`'s own comment claims;
  restart the backend to pick up rule edits.
- `frontend/`, `electron/` — the React (Vite/TS) UI running inside an
  Electron shell, talking to `backend/main.py` over HTTP.

## Data flow

PDF → `parser.parse_statement_pdf()` → rows → `categorizer.Categorizer`
(rules → memory → ML) → `storage` (SQLite in `data/ledger.db`) →
`backend/main.py` JSON API → React UI. Corrections made in the
Transactions view feed back into the memory layer and retrain the ML
model (`Categorizer.retrain`) — **only at backend startup and via the
explicit "Retrain Model Now" button**, not automatically after each
import.

## Running it

- `npm install` once (root, installs Electron/dev tooling), `npm install`
  in `frontend/`, then a Python virtualenv (`.venv`) needs both
  `requirements.txt` (`pdfplumber`, `scikit-learn`, `joblib` — parsing
  and categorization) and `backend/requirements.txt` (`fastapi`,
  `uvicorn`, `python-multipart` — kept separate so a pure parsing/
  categorization consumer never needs a web framework).
- `npm run dev` from the repo root starts the FastAPI backend (`:8756`),
  the Vite dev server (`:5173`), and the Electron window together.
- `npm run dist:win` builds a packaged Windows installer
  (`electron-builder`, config in `package.json`'s `build` field) that
  bundles the frontend, Electron shell, and the `.venv` Python backend as
  `extraResources`. Unlike dev, the packaged app does **not** use a fixed
  backend port: `electron/main.js` picks a free one at launch
  (`getFreePort()`) so a leftover dev session or a previous packaged
  instance still holding 8756 can't stop it from starting, and passes the
  chosen port to the (already-built, static) renderer via
  `electron/preload.js` → `window.statementLedger.apiBaseUrl`, which
  `frontend/src/api/client.ts` reads at runtime. The bundled `.venv` is
  **not relocatable** to another machine — it hard-codes this machine's
  Python install path — so this is a same-machine package, not yet a
  redistributable installer (would need a PyInstaller-frozen backend for
  that).

## Testing

- E2E tests live in `tests/e2e/` (Playwright, config in
  `playwright.config.ts`), run with `npm run test:e2e`.
- The test run seeds an isolated SQLite DB (`tests/e2e/seed.py` →
  `tests/e2e/.data`, via `STATEMENT_LEDGER_DATA_DIR`) and starts the
  backend/frontend on dedicated ports (8766/5183) that are deliberately
  different from the real dev ports (8756/5173) — a test run never
  touches the real `data/ledger.db` or collides with an active `npm run
  dev` session.
- Chromium-only by design (single-user Windows desktop app via Electron,
  not a cross-browser site).

## Dev workflow

- `npm run dev` from the repo root (see above).
- `npm run test:e2e` for the Playwright suite (see above).
- `data/`, `.venv/`, and `node_modules/` are all local/generated
  (git-ignored) — never assume their contents are shared between the two
  worktrees or committed.
