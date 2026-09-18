"""
backend/main.py
FastAPI wrapper around the existing Tkinter app's logic (parser.py,
categorizer.py, storage.py) so the React/Electron UI can talk to the same
rules, ML model, and SQLite ledger as app.py — nothing about categorization,
parsing, or storage is reimplemented here.

Run with:  uvicorn backend.main:app --host 127.0.0.1 --port 8756
"""
import os
import sys
import tempfile

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import storage
from categorizer import Categorizer, UNCATEGORIZED
from parser import parse_statement_pdf, extract_bank_and_counterparty, month_key

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "ledger.db")
MODEL_PATH = os.path.join(DATA_DIR, "model.joblib")
RULES_PATH = os.path.join(BASE_DIR, "rules.json")

# Kept in sync by hand with ALL_CATEGORIES in app.py — used only for the
# edit-category dropdown, not the filter dropdowns (see /api/filters).
ALL_CATEGORIES = [
    "Groceries & Quick Commerce", "Food Delivery", "Fashion & Shopping",
    "Online Shopping (Amazon)", "Person-to-Person Transfer",
    "Merchant Payment (Other)", "Health & Personal Care",
    "Education / Tuition", "Baby & Kids", "Entertainment", "Investments",
    "Insurance", "Bank Charges", "Interest Credit", "Incoming Transfer / Refund",
    "Transfer In (Self)", UNCATEGORIZED,
]

app = FastAPI(title="Statement Ledger API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

conn = None
categorizer = None


@app.on_event("startup")
async def on_startup():
    global conn, categorizer
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = storage.get_connection(DB_PATH)
    categorizer = Categorizer(RULES_PATH, MODEL_PATH)
    examples = storage.get_training_examples(conn)
    categorizer.retrain(examples)


class CategoryUpdate(BaseModel):
    category: str


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/categories")
async def get_categories():
    return {"categories": ALL_CATEGORIES}


@app.get("/api/filters")
async def get_filters():
    return {
        "months": storage.get_distinct(conn, "month"),
        "banks": storage.get_distinct(conn, "bank"),
        "categories": storage.get_all_categories(conn),
    }


@app.get("/api/transactions")
async def get_transactions(month: str = "All", bank: str = "All", category: str = "All",
                            type: str = "All", needs_review: bool = False):
    rows = storage.get_all_transactions(conn, month=month, bank=bank, category=category, txn_type=type)
    if needs_review:
        rows = [r for r in rows if not r["confirmed"]]
    return {"transactions": rows}


@app.post("/api/transactions/{txn_id}/category")
async def update_transaction_category(txn_id: int, body: CategoryUpdate):
    new_cat = body.category.strip()
    if not new_cat:
        raise HTTPException(status_code=400, detail="Category cannot be empty")
    cur = conn.execute("SELECT id FROM transactions WHERE id=?", (txn_id,))
    if cur.fetchone() is None:
        raise HTTPException(status_code=404, detail=f"Transaction {txn_id} not found")
    storage.update_category(conn, txn_id, new_cat)
    return {"ok": True}


@app.post("/api/retrain")
async def retrain():
    examples = storage.get_training_examples(conn)
    n = len(examples)
    ok = categorizer.retrain(examples)
    if ok:
        message = f"Model retrained on {n} confirmed transactions."
    else:
        message = f"Not enough confirmed data yet to train ({n} examples, need at least 2 categories)."
    return {"trained": ok, "example_count": n, "message": message}


@app.post("/api/import")
async def import_statement(file: UploadFile = File(...)):
    suffix = os.path.splitext(file.filename or "statement.pdf")[1] or ".pdf"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        tmp.write(await file.read())
        tmp.close()

        log = [f"Parsing {file.filename} …"]
        try:
            txns = parse_statement_pdf(tmp.name)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to read PDF: {e}")

        if not txns:
            raise HTTPException(
                status_code=422,
                detail="No transaction rows found in that PDF. If this is not an "
                       "Axis Bank statement, the table layout may differ — see the "
                       "note at the top of parser.py.",
            )

        # Own connection, same as _import_pdf in app.py — kept separate from
        # the shared global `conn` used by the read endpoints.
        import_conn = storage.get_connection(DB_PATH)
        try:
            sid = storage.start_statement(import_conn, file.filename or "statement.pdf")
            counts = {"rule": 0, "memory": 0, "ml": 0, "none": 0}
            inserted = 0
            skipped_dupe = 0

            for t in txns:
                bank, cp = extract_bank_and_counterparty(t["particulars"])
                category, source, conf = categorizer.categorize(t["particulars"], cp)
                row = {
                    "date": t["date"], "month": month_key(t["date"]),
                    "particulars": t["particulars"], "counterparty": cp, "bank": bank,
                    "debit": t["debit"], "credit": t["credit"], "balance": t["balance"],
                    "type": "debit" if t["debit"] > 0 else "credit",
                    "category": category, "source": source, "confidence": conf,
                }
                if storage.insert_transaction(import_conn, sid, row):
                    inserted += 1
                    counts[source] += 1
                else:
                    skipped_dupe += 1
            storage.commit(import_conn)
        finally:
            import_conn.close()

        needs_review = counts["memory"] + counts["ml"] + counts["none"]
        log.append(
            f"Imported {inserted} new transactions ({skipped_dupe} already in the ledger, skipped).\n"
            f"  • {counts['rule']} matched a rule (trusted, no review needed)\n"
            f"  • {counts['memory']} recalled from counterparties you've taught it\n"
            f"  • {counts['ml']} guessed by the ML model\n"
            f"  • {counts['none']} left as Uncategorized — new names it hasn't seen\n"
            f"{needs_review} transactions could use a quick look in the Transactions tab "
            f"(filter by 'Needs review'). Every correction you make trains the model further "
            f"for next time."
        )

        return {
            "filename": file.filename,
            "inserted": inserted,
            "skipped_duplicates": skipped_dupe,
            "counts": counts,
            "needs_review": needs_review,
            "log": log,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error during import: {e}")
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
