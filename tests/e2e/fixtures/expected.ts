// Hand-computed from fixtures/transactions.json — keep in sync if that file
// changes. This is the deterministic source of truth for E2E assertions,
// independent of whatever real data happens to be in data/ledger.db.

export const EXPECTED = {
  totalTransactions: 10,
  totalDebit: 500 + 300 + 1200 + 800 + 600 + 2000 + 5000, // 10400
  totalCredit: 50000 + 150 + 400, // 50550
  openingBalance: 10000, // first row's balance (9500) - credit(0) + debit(500)
  closingBalance: 50150, // last chronological row's balance
  needsReviewCount: 2, // source: "none" (row 5) and "ml" (row 8)
  banks: ['Axis Bank', 'HDFC Bank', 'State Bank of India'],
  months: ['2025-01', '2025-02', '2025-03'],
  categories: {
    'Groceries & Quick Commerce': 500 + 600, // 1100
    'Food Delivery': 300,
    'Online Shopping (Amazon)': 1200,
    'Person-to-Person Transfer': 2000,
    'Investments': 5000,
    // "Uncategorized" (800) also appears as a donut slice but is excluded
    // from the filter-dropdown category list by storage.get_all_categories().
  },
  monthly: {
    '2025-01': { debit: 500 + 300, credit: 50000 }, // 800, 50000
    '2025-02': { debit: 1200 + 800, credit: 150 }, // 2000, 150
    '2025-03': { debit: 600 + 2000 + 5000, credit: 400 }, // 7600, 400
  },
};
