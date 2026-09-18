"""
storage.py
Local SQLite persistence. One file (ledger.db) holds every statement
you've ever imported, so the app accumulates history across sessions
and the ML model gets more training data each time.
"""
import sqlite3
import os

SCHEMA = """
CREATE TABLE IF NOT EXISTS statements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT,
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    statement_id INTEGER,
    date TEXT,
    month TEXT,
    particulars TEXT,
    counterparty TEXT,
    bank TEXT,
    debit REAL,
    credit REAL,
    balance REAL,
    type TEXT,
    category TEXT,
    source TEXT,          -- 'rule' | 'ml' | 'none' | 'user'
    confidence REAL,
    confirmed INTEGER DEFAULT 0,
    UNIQUE(date, particulars, debit, credit, balance)
);
"""


def get_connection(db_path):
    parent = os.path.dirname(db_path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def start_statement(conn, filename):
    cur = conn.execute("INSERT INTO statements (filename) VALUES (?)", (filename,))
    conn.commit()
    return cur.lastrowid


def insert_transaction(conn, statement_id, txn):
    """txn: dict with date, month, particulars, counterparty, bank, debit,
    credit, balance, type, category, source, confidence.
    Rule-based categorizations are auto-confirmed (trusted); ML/none are
    left for the user to review. Returns True if inserted, False if it was
    a duplicate (already imported from an overlapping statement)."""
    confirmed = 1 if txn["source"] == "rule" else 0
    try:
        conn.execute("""
            INSERT INTO transactions
              (statement_id, date, month, particulars, counterparty, bank,
               debit, credit, balance, type, category, source, confidence, confirmed)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            statement_id, txn["date"], txn["month"], txn["particulars"],
            txn["counterparty"], txn["bank"], txn["debit"], txn["credit"],
            txn["balance"], txn["type"], txn["category"], txn["source"],
            txn["confidence"], confirmed,
        ))
        return True
    except sqlite3.IntegrityError:
        return False  # duplicate


def commit(conn):
    conn.commit()


def get_all_transactions(conn, month=None, bank=None, category=None, txn_type=None):
    q = "SELECT * FROM transactions WHERE 1=1"
    params = []
    if month and month != "All":
        q += " AND month = ?"
        params.append(month)
    if bank and bank != "All":
        q += " AND bank = ?"
        params.append(bank)
    if category and category != "All":
        q += " AND category = ?"
        params.append(category)
    if txn_type and txn_type != "All":
        q += " AND type = ?"
        params.append(txn_type)
    q += " ORDER BY date DESC, id DESC"
    return [dict(r) for r in conn.execute(q, params).fetchall()]


def get_distinct(conn, column):
    rows = conn.execute(f"SELECT DISTINCT {column} FROM transactions ORDER BY {column}").fetchall()
    return [r[0] for r in rows if r[0]]


def update_category(conn, txn_id, category):
    conn.execute(
        "UPDATE transactions SET category=?, source='user', confidence=1.0, confirmed=1 WHERE id=?",
        (category, txn_id),
    )
    conn.commit()


def get_training_examples(conn):
    """Every transaction whose category is trusted (rule-matched or
    user-confirmed/corrected) — this is what the categorizer retrains on."""
    rows = conn.execute(
        "SELECT particulars, counterparty, category FROM transactions WHERE confirmed=1"
    ).fetchall()
    return [(r["particulars"], r["counterparty"], r["category"]) for r in rows]


def get_all_categories(conn):
    rows = conn.execute(
        "SELECT DISTINCT category FROM transactions WHERE category != 'Uncategorized' ORDER BY category"
    ).fetchall()
    return [r[0] for r in rows]
