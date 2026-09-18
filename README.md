# Statement Ledger

A local desktop app (Windows, no browser, no internet required after setup)
that imports bank statement PDFs, categorizes every transaction, and gets
better at categorizing on its own the more statements you feed it.

Everything — the database, the trained model, your corrections — lives in
the `data/` folder next to the app. Nothing is uploaded anywhere.

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

Every correction you make in the Transactions tab feeds back into layers
2 and 3, so accuracy compounds — the first statement you import will need
the most manual review; each one after that needs less.

## Setup (Windows)

1. Install [Python 3.10 or newer](https://www.python.org/downloads/) if you
   don't have it. **During install, check "Add python.exe to PATH."**
2. Unzip this folder anywhere (e.g. `Documents\StatementLedger`).
3. Double-click **`run_windows.bat`**.
   - First run: it creates a `venv` folder and installs the few Python
     packages it needs (pdfplumber, scikit-learn, joblib, matplotlib).
     This needs an internet connection once, for `pip install`.
   - Every run after that just launches the app directly, offline.

If double-clicking does nothing, right-click `run_windows.bat` → *Run as
administrator*, or open Command Prompt in this folder and run
`run_windows.bat` there to see any error message.

## React + Electron UI (in development)

There's also an in-progress React/Electron desktop UI (`frontend/`,
`electron/`, `backend/`) with the same functionality, talking to the same
`data/` folder as the Tkinter app above via a local FastAPI server. It
requires Node.js and a Python virtual environment with
`backend/requirements.txt` installed. To run it:

```
npm install
npm install --prefix frontend
.venv\Scripts\python -m pip install -r backend/requirements.txt   # or: uv pip install -r backend/requirements.txt
npm run dev
```

This starts the FastAPI backend, the Vite dev server, and the Electron
window together. There's no installer build yet — this is dev-only for
now. See `CLAUDE.md` for architecture details.

## Using the app

- **Import tab** — Browse to a statement PDF, click Import. You'll get a
  breakdown of how many transactions were auto-tagged by rule vs. memory
  vs. ML vs. left uncategorized.
- **Transactions tab** — Filter by month / bank / category, or tick "Needs
  review only" to see just the ones the app wasn't sure about.
  **Double-click any row** to confirm or change its category — this is
  what trains the model.
- **Retrain Model Now** — the model also retrains automatically after
  every import; use this button if you've made several corrections and
  want the model updated immediately (e.g. before importing another
  statement).
- **Dashboard tab** — category breakdown and month-by-month debit/credit
  trend, filterable by month and bank.

## Using it with a different bank

The parser expects a PDF whose transaction table has columns
`Tran Date | Chq No | Particulars | Debit | Credit | Balance | ...`
(this is how Axis Bank, and many Indian banks, lay out statements).

If your bank's PDF differs, open `parser.py` — `parse_statement_pdf()` is
the only function that needs adjusting for a new layout. Everything else
(categorization, storage, GUI) is bank-agnostic and works unchanged.

## Editing the rules

Open `rules.json` in any text editor. Each rule is:
```json
{"pattern": "SWIGGY", "category": "Food Delivery"}
```
`pattern` is a case-insensitive regex checked against the transaction
text; the first matching rule wins. Rules are reloaded every time you
import a statement — no restart needed.

## Packaging as a single .exe (optional)

If you'd rather hand someone a single file instead of a folder + Python:

```
venv\Scripts\activate
pip install pyinstaller
pyinstaller --onefile --windowed --add-data "rules.json;." app.py
```

The .exe will appear in `dist\`. Note it still writes its `data/` folder
next to wherever it's run from, so keep it in its own folder.

## Troubleshooting

- **"No transaction rows found in that PDF"** — the PDF's table layout
  doesn't match what `parser.py` expects; see the section above.
- **Categories look wrong after import** — that's expected for names the
  app has never seen. Correct a few in the Transactions tab and reimport
  (or click Retrain Model Now) — it won't miss that counterparty again.
- **Model won't train ("not enough confirmed data")** — you need at least
  two different categories represented among confirmed transactions;
  import a statement first, since rule-matches count as confirmed.
