# Statement Ledger — CLAUDE.md

## What this is

A local Windows desktop app (Tkinter GUI, no browser/server) that imports
bank statement PDFs, auto-categorizes every transaction, and improves its
categorization the more statements it sees. Everything is stored locally
in `data/` next to the app — nothing is uploaded anywhere. See
[README.md](README.md) for the full user-facing description.

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

- `app.py` — Tkinter GUI + app entry point (`python app.py`). Three tabs:
  Import, Transactions, Dashboard. Background PDF import runs on a worker
  thread and talks to the UI only via a `queue.Queue` polled on the main
  thread (`_poll_worker_queue`) — Tkinter widgets must never be touched
  from the worker thread.
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
- `storage.py` — SQLite persistence (`data/ledger.db`).
- `rules.json` — user-editable categorization rules. **Loaded once at
  startup only** (`RuleEngine.__init__` → `.reload()`), not re-read per
  import — despite what `rules.json`'s own comment and README.md claim;
  restart the app to pick up rule edits.
- `run_windows.bat` — Windows launcher: creates `venv/` and installs
  `requirements.txt` on first run, then just runs `python app.py`.

## Data flow

PDF → `parser.parse_statement_pdf()` → rows → `categorizer.Categorizer`
(rules → memory → ML) → `storage` (SQLite in `data/ledger.db`) → GUI
tabs read from `storage`. Corrections made in the Transactions tab feed
back into the memory layer and retrain the ML model
(`Categorizer.retrain`) — **only at app startup and via the explicit
"Retrain Model Now" button**, not automatically after each import
(despite what README.md claims).

## React + Electron UI (additive, same data)

`backend/`, `frontend/`, and `electron/` are an additional desktop UI for
this same app, built with React (Vite/TS) in an Electron shell, talking
to a FastAPI backend (`backend/main.py`) that wraps `parser.py` /
`categorizer.py` / `storage.py` unchanged. It reads/writes the exact same
`data/ledger.db`, `data/model.joblib`, and `rules.json` as `app.py` — the
two UIs are interchangeable front ends on shared state, not separate
apps. `app.py` / `run_windows.bat` are untouched and still work standalone.

- Run everything: `npm install` once (root, installs Electron/dev
  tooling), `npm install` in `frontend/`, then `.venv`'s Python needs
  `backend/requirements.txt` installed (`fastapi`, `uvicorn`,
  `python-multipart` — kept separate from the root `requirements.txt` so
  the Tkinter-only path never needs a web framework). Then `npm run dev`
  from the repo root starts the FastAPI backend (`:8756`), the Vite dev
  server (`:5173`), and the Electron window together.
- No installer/packaging yet (`electron-builder` bundling a Python
  runtime) — dev-only for now.
- Same rules-loaded-once-at-startup and no-auto-retrain-after-import
  behaviors above apply identically to the FastAPI backend — it
  intentionally mirrors `app.py`'s actual behavior, not the docs' claims.

## Dev workflow

- Tkinter UI: `run_windows.bat` (Windows) or manually `python -m venv
  venv`, activate it, `pip install -r requirements.txt`, `python app.py`.
- React/Electron UI: see above, `npm run dev` from repo root.
- No test suite currently exists in this repo.
- Packaging: PyInstaller one-file build for the Tkinter UI documented in
  README.md.
- `data/`, `venv/`, `.venv/`, and `node_modules/` are all local/generated
  (git-ignored) — never assume their contents are shared between the two
  worktrees or committed.
