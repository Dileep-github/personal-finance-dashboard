// Python's f"₹{n:,.2f}" (backend/main.py) uses Western/3-digit grouping, NOT Indian
// lakh/crore grouping — 'en-US' matches it exactly, 'en-IN' would not.
export function formatMoney(n: number): string {
  return `₹${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const MONTH_LABELS: Record<string, string> = {};

// month is a "yyyy-mm" key (storage.py's month_key()) -> "Apr 2026".
export function formatMonth(month: string): string {
  if (MONTH_LABELS[month]) return MONTH_LABELS[month];
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  const label = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  MONTH_LABELS[month] = label;
  return label;
}
