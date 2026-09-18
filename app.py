"""
Statement Ledger — a local desktop app for analyzing bank statement PDFs.

- Import any statement PDF (Axis Bank layout by default; tweak parser.py
  for other banks).
- Every transaction is auto-categorized using: your editable rules
  (rules.json) -> a "memory" of counterparties you've already taught it ->
  a machine-learning text classifier that gets better every time you
  correct or confirm a category.
- Everything is stored locally in data/ledger.db. Nothing leaves your
  machine.

Run with:  python app.py
"""
import os
import sys
import queue
import threading
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

import matplotlib
matplotlib.use("TkAgg")
from matplotlib.figure import Figure
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import storage
from categorizer import Categorizer, UNCATEGORIZED
from parser import parse_statement_pdf, extract_bank_and_counterparty, month_key

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "ledger.db")
MODEL_PATH = os.path.join(DATA_DIR, "model.joblib")
RULES_PATH = os.path.join(BASE_DIR, "rules.json")

ALL_CATEGORIES = [
    "Groceries & Quick Commerce", "Food Delivery", "Fashion & Shopping",
    "Online Shopping (Amazon)", "Person-to-Person Transfer",
    "Merchant Payment (Other)", "Health & Personal Care",
    "Education / Tuition", "Baby & Kids", "Entertainment", "Investments",
    "Insurance", "Bank Charges", "Interest Credit", "Incoming Transfer / Refund",
    "Transfer In (Self)", UNCATEGORIZED,
]

MONEY = lambda n: f"₹{n:,.2f}"


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Statement Ledger")
        self.geometry("1150x720")

        os.makedirs(DATA_DIR, exist_ok=True)
        self.conn = storage.get_connection(DB_PATH)
        self.categorizer = Categorizer(RULES_PATH, MODEL_PATH)
        self._retrain_from_db(silent=True)

        self.selected_pdf = None

        # Background import work talks to the UI only through this queue.
        # Tkinter is not thread-safe — no widget may be touched from the
        # worker thread, not even via after(); a poller on the main thread
        # drains the queue instead. This is the only safe pattern.
        self._worker_queue = queue.Queue()
        self.after(100, self._poll_worker_queue)

        nb = ttk.Notebook(self)
        nb.pack(fill="both", expand=True)

        self.import_tab = ttk.Frame(nb)
        self.txn_tab = ttk.Frame(nb)
        self.dash_tab = ttk.Frame(nb)
        nb.add(self.import_tab, text="Import")
        nb.add(self.txn_tab, text="Transactions")
        nb.add(self.dash_tab, text="Dashboard")
        self.notebook = nb

        self._build_import_tab()
        self._build_txn_tab()
        self._build_dash_tab()

        self._refresh_filters()
        self._refresh_transactions()
        self._refresh_dashboard()

    # ---------------------------------------------------------- Import tab
    def _build_import_tab(self):
        f = self.import_tab
        pad = {"padx": 12, "pady": 8}

        top = ttk.Frame(f)
        top.pack(fill="x", **pad)
        ttk.Button(top, text="Browse PDF…", command=self._browse_pdf).pack(side="left")
        self.file_label = ttk.Label(top, text="No file selected", foreground="#555")
        self.file_label.pack(side="left", padx=10)

        self.import_btn = ttk.Button(f, text="Import Statement", command=self._import_pdf_threaded, state="disabled")
        self.import_btn.pack(**pad, anchor="w")

        self.import_status = tk.Text(f, height=14, wrap="word", state="disabled",
                                      background="#f5f5f0", relief="flat")
        self.import_status.pack(fill="both", expand=True, padx=12, pady=8)

        self._log_import("Pick a bank statement PDF and click Import.\n"
                          "Every transaction is categorized automatically using your rules, "
                          "your learned counterparty memory, and the ML model — "
                          "in that order. New/unclear ones land in the Transactions tab "
                          "for you to confirm or correct.")

    def _log_import(self, text):
        """Safe to call from any thread — just enqueues; the main-thread
        poller (_poll_worker_queue) does the actual widget update."""
        self._worker_queue.put(("log", text))

    def _poll_worker_queue(self):
        """Runs on the main thread only, on a repeating timer. This is the
        single place background-thread results are applied to widgets."""
        try:
            while True:
                kind, payload = self._worker_queue.get_nowait()
                if kind == "log":
                    self.import_status.configure(state="normal")
                    self.import_status.insert("end", payload + "\n\n")
                    self.import_status.see("end")
                    self.import_status.configure(state="disabled")
                elif kind == "import_done":
                    self.import_btn.configure(state="normal")
                    self._post_import_refresh()
                elif kind == "import_failed":
                    self.import_btn.configure(state="normal")
        except queue.Empty:
            pass
        self.after(100, self._poll_worker_queue)

    def _browse_pdf(self):
        path = filedialog.askopenfilename(filetypes=[("PDF files", "*.pdf")])
        if path:
            self.selected_pdf = path
            self.file_label.configure(text=os.path.basename(path))
            self.import_btn.configure(state="normal")

    def _import_pdf_threaded(self):
        self.import_btn.configure(state="disabled")
        threading.Thread(target=self._import_pdf, daemon=True).start()

    def _import_pdf(self):
        """Runs entirely on a background thread. Touches NO tkinter widgets
        directly (see _log_import) and opens its OWN sqlite connection —
        sqlite3 connections, like Tkinter widgets, must not be shared
        across threads."""
        path = self.selected_pdf
        try:
            self._log_import(f"Parsing {os.path.basename(path)} …")
            try:
                txns = parse_statement_pdf(path)
            except Exception as e:
                self._log_import(f"Failed to read PDF: {e}")
                self._worker_queue.put(("import_failed", None))
                return

            if not txns:
                self._log_import("No transaction rows found in that PDF. "
                                  "If this is not an Axis Bank statement, the table layout "
                                  "may differ — see the note at the top of parser.py.")
                self._worker_queue.put(("import_failed", None))
                return

            thread_conn = storage.get_connection(DB_PATH)
            try:
                sid = storage.start_statement(thread_conn, os.path.basename(path))
                counts = {"rule": 0, "memory": 0, "ml": 0, "none": 0}
                inserted = 0
                skipped_dupe = 0

                for t in txns:
                    bank, cp = extract_bank_and_counterparty(t["particulars"])
                    category, source, conf = self.categorizer.categorize(t["particulars"], cp)
                    row = {
                        "date": t["date"], "month": month_key(t["date"]),
                        "particulars": t["particulars"], "counterparty": cp, "bank": bank,
                        "debit": t["debit"], "credit": t["credit"], "balance": t["balance"],
                        "type": "debit" if t["debit"] > 0 else "credit",
                        "category": category, "source": source, "confidence": conf,
                    }
                    if storage.insert_transaction(thread_conn, sid, row):
                        inserted += 1
                        counts[source] += 1
                    else:
                        skipped_dupe += 1
                storage.commit(thread_conn)
            finally:
                thread_conn.close()

            needs_review = counts["memory"] + counts["ml"] + counts["none"]
            self._log_import(
                f"Imported {inserted} new transactions ({skipped_dupe} already in the ledger, skipped).\n"
                f"  • {counts['rule']} matched a rule (trusted, no review needed)\n"
                f"  • {counts['memory']} recalled from counterparties you've taught it\n"
                f"  • {counts['ml']} guessed by the ML model\n"
                f"  • {counts['none']} left as Uncategorized — new names it hasn't seen\n"
                f"{needs_review} transactions could use a quick look in the Transactions tab "
                f"(filter by 'Needs review'). Every correction you make trains the model "
                f"further for next time."
            )
            self._worker_queue.put(("import_done", None))
        except Exception as e:
            self._log_import(f"Unexpected error during import: {e}")
            self._worker_queue.put(("import_failed", None))

    def _post_import_refresh(self):
        self.import_btn.configure(state="normal")
        self._refresh_filters()
        self._refresh_transactions()
        self._refresh_dashboard()
        self.notebook.select(self.txn_tab)
        self.review_only_var.set(True)
        self._refresh_transactions()

    # ------------------------------------------------------ Transactions tab
    def _build_txn_tab(self):
        f = self.txn_tab
        filt = ttk.Frame(f)
        filt.pack(fill="x", padx=10, pady=8)

        ttk.Label(filt, text="Month").pack(side="left")
        self.month_var = tk.StringVar(value="All")
        self.month_combo = ttk.Combobox(filt, textvariable=self.month_var, width=10, state="readonly")
        self.month_combo.pack(side="left", padx=(4, 12))
        self.month_combo.bind("<<ComboboxSelected>>", lambda e: self._refresh_transactions())

        ttk.Label(filt, text="Bank").pack(side="left")
        self.bank_var = tk.StringVar(value="All")
        self.bank_combo = ttk.Combobox(filt, textvariable=self.bank_var, width=22, state="readonly")
        self.bank_combo.pack(side="left", padx=(4, 12))
        self.bank_combo.bind("<<ComboboxSelected>>", lambda e: self._refresh_transactions())

        ttk.Label(filt, text="Category").pack(side="left")
        self.category_var = tk.StringVar(value="All")
        self.category_combo = ttk.Combobox(filt, textvariable=self.category_var, width=24, state="readonly")
        self.category_combo.pack(side="left", padx=(4, 12))
        self.category_combo.bind("<<ComboboxSelected>>", lambda e: self._refresh_transactions())

        self.review_only_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(filt, text="Needs review only", variable=self.review_only_var,
                         command=self._refresh_transactions).pack(side="left", padx=12)

        ttk.Button(filt, text="Retrain Model Now", command=self._retrain_clicked).pack(side="right")

        cols = ("date", "particulars", "counterparty", "category", "bank", "debit", "credit", "confirmed")
        headers = {"date": "Date", "particulars": "Particulars", "counterparty": "Counterparty",
                   "category": "Category", "bank": "Bank", "debit": "Debit", "credit": "Credit",
                   "confirmed": "Reviewed"}
        widths = {"date": 80, "particulars": 260, "counterparty": 140, "category": 190,
                  "bank": 130, "debit": 80, "credit": 80, "confirmed": 70}

        tree_frame = ttk.Frame(f)
        tree_frame.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        self.tree = ttk.Treeview(tree_frame, columns=cols, show="headings", selectmode="browse")
        for c in cols:
            self.tree.heading(c, text=headers[c])
            self.tree.column(c, width=widths[c], anchor="w" if c in ("particulars", "counterparty", "category", "bank") else "e")
        vsb = ttk.Scrollbar(tree_frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=vsb.set)
        self.tree.pack(side="left", fill="both", expand=True)
        vsb.pack(side="right", fill="y")
        self.tree.bind("<Double-1>", self._edit_category_popup)

        hint = ttk.Label(f, text="Double-click a row to confirm or change its category.",
                          foreground="#555")
        hint.pack(anchor="w", padx=12, pady=(0, 8))

    def _refresh_filters(self):
        months = ["All"] + storage.get_distinct(self.conn, "month")
        banks = ["All"] + storage.get_distinct(self.conn, "bank")
        cats = ["All"] + storage.get_all_categories(self.conn)
        self.month_combo["values"] = months
        self.bank_combo["values"] = banks
        self.category_combo["values"] = cats
        if self.month_var.get() not in months:
            self.month_var.set("All")
        if self.bank_var.get() not in banks:
            self.bank_var.set("All")
        if self.category_var.get() not in cats:
            self.category_var.set("All")

    def _refresh_transactions(self):
        for row in self.tree.get_children():
            self.tree.delete(row)
        rows = storage.get_all_transactions(
            self.conn, month=self.month_var.get(), bank=self.bank_var.get(),
            category=self.category_var.get(),
        )
        if self.review_only_var.get():
            rows = [r for r in rows if not r["confirmed"]]
        self._current_rows = {}
        for r in rows:
            debit = MONEY(r["debit"]) if r["debit"] else ""
            credit = MONEY(r["credit"]) if r["credit"] else ""
            reviewed = "✓" if r["confirmed"] else "—"
            iid = str(r["id"])
            self.tree.insert("", "end", iid=iid, values=(
                r["date"], r["particulars"][:70], r["counterparty"], r["category"],
                r["bank"], debit, credit, reviewed,
            ))
            self._current_rows[iid] = r

    def _edit_category_popup(self, event):
        sel = self.tree.selection()
        if not sel:
            return
        iid = sel[0]
        row = self._current_rows[iid]

        popup = tk.Toplevel(self)
        popup.title("Set category")
        popup.geometry("420x160")
        ttk.Label(popup, text=row["particulars"], wraplength=380).pack(padx=12, pady=(12, 6))
        ttk.Label(popup, text=f"Counterparty: {row['counterparty']}", foreground="#555").pack(padx=12)

        var = tk.StringVar(value=row["category"])
        combo = ttk.Combobox(popup, textvariable=var, values=ALL_CATEGORIES, width=36)
        combo.pack(padx=12, pady=12)

        def save():
            new_cat = var.get().strip()
            if not new_cat:
                return
            storage.update_category(self.conn, row["id"], new_cat)
            popup.destroy()
            self._refresh_filters()
            self._refresh_transactions()
            self._refresh_dashboard()

        btns = ttk.Frame(popup)
        btns.pack(pady=4)
        ttk.Button(btns, text="Save (this trains the model)", command=save).pack(side="left", padx=6)
        ttk.Button(btns, text="Cancel", command=popup.destroy).pack(side="left")

    def _retrain_clicked(self):
        result = self._retrain_from_db(silent=False)
        messagebox.showinfo("Retrain Model", result)
        self._refresh_transactions()

    def _retrain_from_db(self, silent=True):
        examples = storage.get_training_examples(self.conn)
        n = len(examples)
        ok = self.categorizer.retrain(examples)
        if ok:
            msg = f"Model retrained on {n} confirmed transactions."
        else:
            msg = f"Not enough confirmed data yet to train ({n} examples, need at least 2 categories)."
        if not silent:
            return msg
        return msg

    # ---------------------------------------------------------- Dashboard tab
    def _build_dash_tab(self):
        f = self.dash_tab
        filt = ttk.Frame(f)
        filt.pack(fill="x", padx=10, pady=8)

        ttk.Label(filt, text="Month").pack(side="left")
        self.dash_month_var = tk.StringVar(value="All")
        self.dash_month_combo = ttk.Combobox(filt, textvariable=self.dash_month_var, width=10, state="readonly")
        self.dash_month_combo.pack(side="left", padx=(4, 12))
        self.dash_month_combo.bind("<<ComboboxSelected>>", lambda e: self._refresh_dashboard())

        ttk.Label(filt, text="Bank").pack(side="left")
        self.dash_bank_var = tk.StringVar(value="All")
        self.dash_bank_combo = ttk.Combobox(filt, textvariable=self.dash_bank_var, width=22, state="readonly")
        self.dash_bank_combo.pack(side="left", padx=(4, 12))
        self.dash_bank_combo.bind("<<ComboboxSelected>>", lambda e: self._refresh_dashboard())

        ttk.Button(filt, text="Refresh", command=self._refresh_dashboard).pack(side="left", padx=12)

        self.summary_label = ttk.Label(f, text="", font=("Segoe UI", 11, "bold"))
        self.summary_label.pack(anchor="w", padx=14, pady=(0, 6))

        self.fig = Figure(figsize=(10.5, 5.2), dpi=100)
        self.ax_cat = self.fig.add_subplot(1, 2, 1)
        self.ax_month = self.fig.add_subplot(1, 2, 2)
        self.canvas = FigureCanvasTkAgg(self.fig, master=f)
        self.canvas.get_tk_widget().pack(fill="both", expand=True, padx=10, pady=10)

    def _refresh_dashboard(self):
        months = ["All"] + storage.get_distinct(self.conn, "month")
        banks = ["All"] + storage.get_distinct(self.conn, "bank")
        self.dash_month_combo["values"] = months
        self.dash_bank_combo["values"] = banks

        rows = storage.get_all_transactions(
            self.conn, month=self.dash_month_var.get(), bank=self.dash_bank_var.get(),
        )
        debit_rows = [r for r in rows if r["type"] == "debit"]
        credit_rows = [r for r in rows if r["type"] == "credit"]
        total_debit = sum(r["debit"] for r in debit_rows)
        total_credit = sum(r["credit"] for r in credit_rows)
        self.summary_label.configure(
            text=f"Debit: {MONEY(total_debit)}    Credit: {MONEY(total_credit)}    "
                 f"Net: {MONEY(total_credit - total_debit)}    Transactions: {len(rows)}"
        )

        # category breakdown
        self.ax_cat.clear()
        by_cat = {}
        for r in debit_rows:
            by_cat[r["category"]] = by_cat.get(r["category"], 0) + r["debit"]
        items = sorted(by_cat.items(), key=lambda x: -x[1])[:10]
        if items:
            labels = [k for k, _ in items]
            values = [v for _, v in items]
            self.ax_cat.barh(labels[::-1], values[::-1], color="#1f5c4f")
            self.ax_cat.set_title("Spend by category")
            self.ax_cat.tick_params(labelsize=8)
        else:
            self.ax_cat.set_title("No debit data")

        # monthly trend
        self.ax_month.clear()
        all_months = sorted(set(r["month"] for r in storage.get_all_transactions(self.conn, bank=self.dash_bank_var.get())))
        month_debit = {m: 0 for m in all_months}
        month_credit = {m: 0 for m in all_months}
        for r in storage.get_all_transactions(self.conn, bank=self.dash_bank_var.get()):
            if r["type"] == "debit":
                month_debit[r["month"]] += r["debit"]
            else:
                month_credit[r["month"]] += r["credit"]
        if all_months:
            x = range(len(all_months))
            width = 0.38
            self.ax_month.bar([i - width / 2 for i in x], [month_debit[m] for m in all_months], width, label="Debit", color="#a3402f")
            self.ax_month.bar([i + width / 2 for i in x], [month_credit[m] for m in all_months], width, label="Credit", color="#1f5c4f")
            self.ax_month.set_xticks(list(x))
            self.ax_month.set_xticklabels(all_months, rotation=45, ha="right", fontsize=8)
            self.ax_month.set_title("Monthly trend")
            self.ax_month.legend(fontsize=8)
        else:
            self.ax_month.set_title("No data yet")

        self.fig.tight_layout()
        self.canvas.draw()


if __name__ == "__main__":
    app = App()
    app.mainloop()
