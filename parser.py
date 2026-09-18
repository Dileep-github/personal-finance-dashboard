"""
parser.py
Parses an Axis Bank (or similarly-tabled) statement PDF into a list of
transaction dicts: date, particulars, debit, credit, balance.

This targets statements that expose their transaction table via
pdfplumber's table extraction with columns:
    Tran Date | Chq No | Particulars | Debit | Credit | Balance | Init. Br

If your bank's PDF has a different layout, tweak COLUMN mapping below —
everything else in the app is bank-agnostic.
"""
import re
import pdfplumber


SKIP_PARTICULARS = {"OPENING BALANCE", "TRANSACTION TOTAL", "CLOSING BALANCE", "PARTICULARS"}

# Common bank name fragments -> a clean display name. Extend this freely;
# unmatched banks just fall back to a title-cased guess.
BANK_ALIASES = {
    "AXIS BANK": "Axis Bank", "ICICI BANK": "ICICI Bank", "HDFC BANK": "HDFC Bank",
    "KOTAK MAHINDRA BANK": "Kotak Mahindra Bank", "YES BANK": "Yes Bank",
    "YESBANK": "Yes Bank", "STATE BANK OF INDIA": "State Bank of India",
    "FEDERAL BANK": "Federal Bank", "UNION BANK OF INDIA": "Union Bank of India",
    "INDIA POST PAYMENTS": "India Post Payments Bank", "CANARA BANK": "Canara Bank",
    "BANK OF BARODA": "Bank of Baroda", "BANK OF INDIA": "Bank of India",
    "AIRTEL PAYMENTS BANK": "Airtel Payments Bank", "IDFC FIRST BANK": "IDFC First Bank",
    "NSDL PAYMENTS BANK": "NSDL Payments Bank", "SLICE SMALL FINANCE": "Slice Small Finance Bank",
    "UNITY SMALL FINANCE": "Unity Small Finance Bank", "INDUSIND BANK": "IndusInd Bank",
    "INDIAN OVERSEAS BANK": "Indian Overseas Bank", "UCO BANK": "UCO Bank",
    "BALANCEHERO": "BalanceHero (True Balance)", "SYNDICATE BANK": "Syndicate Bank",
    "TELANGANA STATE CO": "Telangana State Co-op Bank", "TELANGANA GRAMEENA": "Telangana Grameena Bank",
    "ANDHRA PRADESH GRAME": "Andhra Pradesh Grameena Bank", "CENTRAL BANK OF INDI": "Central Bank of India",
    "AMAZON RBL": "RBL Bank (Amazon Pay)",
}


def _to_num(x):
    if x is None:
        return 0.0
    x = str(x).strip().replace(",", "")
    if x == "":
        return 0.0
    try:
        return float(x)
    except ValueError:
        return 0.0


def parse_statement_pdf(path):
    """Returns a list of dicts: date (dd-mm-yyyy), particulars, debit, credit, balance."""
    rows = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                for r in table:
                    rows.append(r)

    txns = []
    last_date = None
    for r in rows:
        if not r or len(r) < 6:
            continue
        date, chq, particulars, debit, credit, balance = (r + [None] * 6)[:6]
        if particulars is None:
            continue
        p = particulars.strip()
        if p.upper() in SKIP_PARTICULARS:
            continue

        if date and date.strip():
            last_date = date.strip()
        date_val = last_date
        if not date_val:
            continue

        particulars_clean = re.sub(r"\s+", " ", p.replace("\n", " ")).strip()

        txns.append({
            "date": date_val,
            "particulars": particulars_clean,
            "debit": _to_num(debit),
            "credit": _to_num(credit),
            "balance": _to_num(balance),
        })

    return txns


def extract_bank_and_counterparty(particulars):
    """Best-effort extraction of the counterparty bank name and payee/merchant
    name from a UPI-style particulars string. Bank-agnostic fallback: last
    '/'-separated segment is treated as the bank; the segment right after the
    reference number as the counterparty."""
    if "Avg bal Chgs" in particulars or "Int.Pd" in particulars or particulars.startswith("MOB/TPFT/"):
        return "Own Account", ""

    segs = particulars.split("/")
    tail = segs[-1].strip() if segs else ""
    tail_upper = tail.upper()
    bank = None
    for key, name in sorted(BANK_ALIASES.items(), key=lambda x: -len(x[0])):
        if key in tail_upper or key in particulars.upper():
            bank = name
            break
    if bank is None:
        bank = tail.title() if tail else "Unknown"

    m = re.match(r"^UPI/P2[AM]/\d+/(.*?)/(Paymen|Pay to|Pay fo|Payvia|UPIInt|UPI|Verifi|Pay|You ar|20)\b", particulars)
    if m:
        counterparty = m.group(1).strip()
    elif particulars.startswith("MOB/TPFT/"):
        counterparty = particulars.replace("MOB/TPFT/", "").split("/")[0]
    else:
        counterparty = particulars[:40]

    return bank, counterparty


def month_key(date_str):
    """date_str is dd-mm-yyyy -> returns yyyy-mm"""
    parts = date_str.split("-")
    if len(parts) == 3:
        dd, mm, yyyy = parts
        return f"{yyyy}-{mm}"
    return "unknown"
