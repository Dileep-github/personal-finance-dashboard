# Statement Ledger

A local desktop app (Windows, no internet required after setup) that
imports bank statement PDFs, categorizes every transaction, and gets
better at categorizing on its own the more statements you feed it.

Everything — the database, the trained model, your corrections — lives in
the `data/` folder next to the app. Nothing is uploaded anywhere.

The UI is a React + Electron desktop app talking to a local FastAPI
backend (`backend/main.py`), which wraps the parsing/categorization/
storage logic unchanged.

## How categorization works (three layers, checked in order)

1. **Rules** (`rules.json`) — fast, exact, and always trusted. Keyword/regex
   matches you can edit by hand any time. e.g. "ZEPTO" -> Groceries.
2. **Memory** — once you confirm or correct a transaction's category, the
   app remembers that *counterparty* (merchant or person). Next time the
   same name shows up, it's tagged instantly — no guessing.
3. **Machine learning** — a text classifier (TF-IDF + logistic regression)
   trained on everything you've confirmed. It generalizes to *new* names
   it hasn't seen before, based on how similar their text looks to things
   you've already categorized. If it's not confident, the transaction is
   left as "Uncategorized" for you rather than guessing wrong.

Every correction you make in the Transactions view feeds back into layers
2 and 3, so accuracy compounds — the first statement you import will need
the most manual review; each one after that needs less.

## Setup (Windows)

Requires [Python 3.10+](https://www.python.org/downloads/) (checked "Add
python.exe to PATH" during install) and [Node.js](https://nodejs.org/).

```
py -3 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m pip install -r backend\requirements.txt

npm install
npm install --prefix frontend

npm run dev
```

If `py` isn't on your PATH (the Python launcher isn't installed), and you
have [uv](https://docs.astral.sh/uv/) instead, use it for the venv steps:

```
uv venv .venv
uv pip install -r requirements.txt
uv pip install -r backend\requirements.txt
```

`npm run dev` starts the FastAPI backend (`:8756`), the Vite dev server
(`:5173`), and the Electron window together. There's no installer build
yet — this is dev-only for now. See `CLAUDE.md` for architecture details.

## Using the app

- **Import** — Browse to a statement PDF, click Import. You'll get a
  breakdown of how many transactions were auto-tagged by rule vs. memory
  vs. ML vs. left uncategorized.
- **Transactions** — Filter by month / bank / category, or tick "Needs
  review only" to see just the ones the app wasn't sure about.
  Click a row to confirm or change its category — this is what trains
  the model.
- **Retrain Model Now** — use this if you've made several corrections and
  want the model updated immediately (e.g. before importing another
  statement).
- **Dashboard** — category breakdown and month-by-month debit/credit
  trend, filterable by month and bank.

## Using it with a different bank

The parser expects a PDF whose transaction table has columns
`Tran Date | Chq No | Particulars | Debit | Credit | Balance | ...`
(this is how Axis Bank, and many Indian banks, lay out statements).

If your bank's PDF differs, open `parser.py` — `parse_statement_pdf()` is
the only function that needs adjusting for a new layout. Everything else
(categorization, storage, backend, UI) is bank-agnostic and works
unchanged.

## Editing the rules

Open `rules.json` in any text editor. Each rule is:
```json
{"pattern": "SWIGGY", "category": "Food Delivery"}
```
`pattern` is a case-insensitive regex checked against the transaction
text; the first matching rule wins. Rules are loaded once at backend
startup — restart the backend to pick up rule edits.

## Troubleshooting

- **"No transaction rows found in that PDF"** — the PDF's table layout
  doesn't match what `parser.py` expects; see the section above.
- **Categories look wrong after import** — that's expected for names the
  app has never seen. Correct a few in the Transactions view and reimport
  (or click Retrain Model Now) — it won't miss that counterparty again.
- **Model won't train ("not enough confirmed data")** — you need at least
  two different categories represented among confirmed transactions;
  import a statement first, since rule-matches count as confirmed.

## Learnings-ECC

Mapping specific moments in this session to the actual ECC agents/skills
available in this environment (names as they'd be invoked here):

| Session moment | What I did manually | Could've used instead | Why it's better |
|---|---|---|---|
| Figuring out app.py vs backend/main.py relationship | Several rounds of Read/Grep across app.py, backend/main.py, CLAUDE.md | `Agent(subagent_type: "ecc:code-explorer")` | Purpose-built to trace execution paths and map dependencies; keeps exploration noise out of the main thread if run as a real subagent |
| Deleting app.py/run_windows.bat as dead code | Manual `rm` + grep for stray references | `/ecc:refactor-clean` (agent `ecc:refactor-cleaner`) | Runs actual dead-code analysis, not just grep — catches references a keyword search misses |
| Reviewing the Python-side diff (requirements.txt, backend/main.py) | No independent review | `Agent(subagent_type: "ecc:python-reviewer")` | Second opinion before commit, at near-zero cost |
| "update the CLAUDE.md" (vague ask) | Manual inference + hand-edit | `/ecc:update-docs` (agent `ecc:doc-updater`) | Built specifically to sync docs from source-of-truth files like storage.py — designed for exactly that ask |
| Setting up electron-builder packaging for v1 | Manual package.json edits + trial-and-error builds | `/ecc:orch-add-feature` | Plans → implements → reviews → gated-commits a new capability end to end instead of ad hoc iteration |
| winCodeSign download failure / app.asar file lock | Manually read stack traces, guessed `signAndEditExecutable: false`, retried by hand | `Agent(subagent_type: "ecc:build-error-resolver")` | Its whole job is "detect build system, fix incrementally, minimal diffs" — exactly this loop, in an isolated context |
| Deciding what belongs in `.gitignore` / whether to commit `release/` | Manual `git status` reasoning | `/ecc:git-workflow` | Encodes build-artifact/git hygiene conventions directly |
| Diagnosing + fixing the hardcoded-port bug | Manual `tasklist`/`netstat`/PowerShell forensics, hand-written fix, throwaway dummy-listener test | `/ecc:orch-fix-defect` | Enforces reproduce-as-failing-test → fix → review → gated commit — would've left a **permanent regression test**, not a one-off manual check |
| Verifying the fix didn't break anything | Never ran the existing suite | `Agent(subagent_type: "ecc:e2e-runner")` or plain `npm run test:e2e` | Exists precisely to catch regressions in the electron/frontend/backend wiring I touched |
| Reviewing electron/main.js, preload.js, client.ts before committing | Self-review only | `/code-review` or `Agent(subagent_type: "ecc:typescript-reviewer")` | Fresh-context review pass before a gated commit |
| "commit all the changes" | Manual `git add -A` + `git commit` | `/ecc:prp-commit` | "Quick commit with natural language file targeting" — same result, less manual staging |
| This retrospective itself | Manual read of `.claude/settings.local.json` + session recall | `/ecc:learn` or `/ecc:learn-eval` | Systematic session-pattern extraction into reusable memory/skills, with a quality self-eval built in |
| Where session cost/budget went | Never measured | `/ecc:cost-report` | Local report from ECC's cost-tracker metrics log |
| Overall repo/tooling health (the settings.local.json bloat) | Not audited | `/ecc:harness-audit` or `/ecc:repo-scan` | Deterministic scorecard that would've flagged exactly the permission-allowlist bloat I found by hand |

The two to prioritize going forward: **`/ecc:orch-fix-defect`** for any
future bug fix (it's the one that would've produced a lasting regression
test instead of a throwaway verification), and
**`Agent(subagent_type: "ecc:build-error-resolver")`** for build-tool
iteration loops like the electron-builder failures, since those are
exactly the kind of noisy, multi-retry work worth isolating from the
main conversation.
