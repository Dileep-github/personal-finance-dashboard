import { test, expect } from '@playwright/test';
import { StatementPage } from './pages/StatementPage';
import { EXPECTED } from './fixtures/expected';

test.describe('Statement view', () => {
  let statement: StatementPage;

  test.beforeEach(async ({ page }) => {
    statement = new StatementPage(page);
    await statement.goto();
    await statement.openStatementTab();
  });

  test('shows totals and entries matching the seeded fixture data', async () => {
    await expect(statement.ledgerRows).toHaveCount(EXPECTED.totalTransactions);
    expect(await statement.entriesCount()).toBe(EXPECTED.totalTransactions);

    expect(await statement.statValue('Opening balance')).toBe(`₹${EXPECTED.openingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    expect(await statement.statValue('Closing balance')).toBe(`₹${EXPECTED.closingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    expect(await statement.statValue('Total debit')).toBe(`₹${EXPECTED.totalDebit.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    expect(await statement.statValue('Total credit')).toBe(`₹${EXPECTED.totalCredit.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    expect(await statement.statValue('Transactions')).toBe(String(EXPECTED.totalTransactions));
  });

  test('filtering by month narrows the ledger and stat cards consistently', async () => {
    await statement.selectMonth('2025-02');
    const feb = EXPECTED.monthly['2025-02'];
    const febRowCount = 3; // rows 4, 5, 6 in the fixture

    await expect(statement.ledgerRows).toHaveCount(febRowCount);
    expect(await statement.entriesCount()).toBe(febRowCount);
    expect(await statement.statValue('Total debit')).toBe(`₹${feb.debit.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    expect(await statement.statValue('Total credit')).toBe(`₹${feb.credit.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  });

  test('clicking a bar in Monthly trend drills into that month', async () => {
    // Fixture months are chronological: Jan(0), Feb(1), Mar(2).
    await statement.clickDebitBar(1);
    await expect(statement.monthSelect).toHaveValue('2025-02');

    const feb = EXPECTED.monthly['2025-02'];
    expect(await statement.statValue('Total debit')).toBe(`₹${feb.debit.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

    // Clicking the same bar again clears the drill-down (toggle behavior).
    await statement.clickDebitBar(1);
    await expect(statement.monthSelect).toHaveValue('All');
  });

  test('clicking a category in the donut filters the ledger to that category', async () => {
    await statement.clickDonutCategory('Groceries & Quick Commerce');
    await expect(statement.donutLegendItem('Groceries & Quick Commerce')).toHaveClass(/selected/);

    // Fixture has exactly 2 "Groceries & Quick Commerce" debit rows (500 + 600).
    await expect(statement.ledgerRows).toHaveCount(2);
    expect(await statement.statValue('Total debit')).toBe(
      `₹${EXPECTED.categories['Groceries & Quick Commerce'].toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    );

    // Clicking it again clears the category filter.
    await statement.clickDonutCategory('Groceries & Quick Commerce');
    await expect(statement.ledgerRows).toHaveCount(EXPECTED.totalTransactions);
  });

  test('"needs review" toggle narrows the ledger WITHOUT zeroing the dashboard totals (regression test)', async () => {
    // This is the exact bug reported and fixed this session: stat cards
    // used to derive from the review-filtered rows, so toggling "needs
    // review only" on a dataset where everything shown happened to be
    // confirmed collapsed the whole dashboard to ₹0.00 with no way back.
    const fullDebit = await statement.statValue('Total debit');
    const fullTransactions = await statement.statValue('Transactions');
    expect(fullTransactions).toBe(String(EXPECTED.totalTransactions));

    await statement.reviewToggleButton().click();
    await expect(statement.ledgerRows).toHaveCount(EXPECTED.needsReviewCount);

    // Stat cards must be unaffected by the review-only toggle.
    expect(await statement.statValue('Total debit')).toBe(fullDebit);
    expect(await statement.statValue('Transactions')).toBe(fullTransactions);

    // The toggle-off control must always be reachable, even with 0 of the
    // filtered rows unconfirmed — this was the dead-end part of the bug.
    const toggle = statement.reviewToggleButton();
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(statement.ledgerRows).toHaveCount(EXPECTED.totalTransactions);
  });

  test('double-clicking a row opens the edit dialog; Cancel makes no change', async () => {
    const firstRow = statement.ledgerRows.first();
    const originalCategory = (await firstRow.locator('td').nth(2).innerText()).trim();

    await statement.openEditDialogForRow(0);
    await expect(statement.modal.locator('select')).toHaveValue(originalCategory);

    await statement.cancelEditDialog();
    await expect(firstRow.locator('td').nth(2)).toHaveText(originalCategory);
  });

  test('Reset filters clears month/bank/type/category back to the full view', async () => {
    await statement.selectMonth('2025-02');
    await statement.selectBank('Axis Bank');
    // "Online Shopping (Amazon)" (row 4, Feb/Axis Bank) is the only debit
    // category present under these two filters — "Groceries & Quick
    // Commerce" only occurs in Jan/Mar, so it wouldn't be in the donut here.
    await statement.clickDonutCategory('Online Shopping (Amazon)');

    await statement.resetFilters();

    await expect(statement.monthSelect).toHaveValue('All');
    await expect(statement.bankSelect).toHaveValue('All');
    await expect(statement.ledgerRows).toHaveCount(EXPECTED.totalTransactions);
  });
});
