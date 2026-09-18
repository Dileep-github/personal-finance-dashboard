"""
tests/e2e/seed.py
Seeds a small, deterministic fixture dataset (fixtures/transactions.json)
into an ISOLATED test data directory for the Playwright E2E suite — never
the real data/ledger.db, which holds actual personal bank transactions.
Reuses storage.py exactly as the real app does, so schema/behavior match.

Run with:  <venv>/python tests/e2e/seed.py <data_dir>
"""
import json
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO_ROOT)
import storage  # noqa: E402


def month_key(date_str):
    dd, mm, yyyy = date_str.split("-")
    return f"{yyyy}-{mm}"


def seed(data_dir):
    os.makedirs(data_dir, exist_ok=True)
    db_path = os.path.join(data_dir, "ledger.db")
    model_path = os.path.join(data_dir, "model.joblib")
    # Always start from a clean, known state — a stale DB/model from a
    # previous run would make assertions non-deterministic.
    for path in (db_path, model_path):
        if os.path.exists(path):
            os.remove(path)

    fixtures_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "transactions.json")
    with open(fixtures_path, "r", encoding="utf-8") as f:
        rows = json.load(f)

    conn = storage.get_connection(db_path)
    sid = storage.start_statement(conn, "e2e-fixture.pdf")
    for r in rows:
        txn = {
            "date": r["date"],
            "month": month_key(r["date"]),
            "particulars": r["particulars"],
            "counterparty": r["counterparty"],
            "bank": r["bank"],
            "debit": r["debit"],
            "credit": r["credit"],
            "balance": r["balance"],
            "type": "debit" if r["debit"] > 0 else "credit",
            "category": r["category"],
            "source": r["source"],
            "confidence": r.get("confidence", 1.0),
        }
        storage.insert_transaction(conn, sid, txn)
    storage.commit(conn)
    conn.close()
    print(f"Seeded {len(rows)} fixture transactions into {db_path}")


if __name__ == "__main__":
    default_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".data")
    seed(sys.argv[1] if len(sys.argv) > 1 else default_dir)
