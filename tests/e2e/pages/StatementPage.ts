import { Page, Locator, expect } from '@playwright/test';

export class StatementPage {
  readonly page: Page;
  readonly importTabButton: Locator;
  readonly statementTabButton: Locator;
  readonly statementView: Locator;
  readonly monthSelect: Locator;
  readonly bankSelect: Locator;
  readonly typeSelect: Locator;
  readonly resetButton: Locator;
  readonly ledgerRows: Locator;
  readonly entriesLabel: Locator;
  readonly donutLegendItems: Locator;
  readonly debitBars: Locator;
  readonly modal: Locator;

  constructor(page: Page) {
    this.page = page;
    this.importTabButton = page.locator('nav.tabs button', { hasText: 'Import' });
    this.statementTabButton = page.locator('nav.tabs button', { hasText: 'Statement' });
    this.statementView = page.locator('.statement-view');
    this.monthSelect = page.locator('.filter-bar select').nth(0);
    this.bankSelect = page.locator('.filter-bar select').nth(1);
    this.typeSelect = page.locator('.filter-bar select').nth(2);
    this.resetButton = page.locator('.reset-filters-button');
    this.ledgerRows = page.locator('.ledger-table tbody tr');
    this.entriesLabel = page.locator('.ledger-toolbar-right span');
    this.donutLegendItems = page.locator('.donut-legend li');
    this.debitBars = page.locator('.recharts-bar-rectangle path[fill="#a3402f"]');
    this.modal = page.locator('.modal');
  }

  async goto() {
    await this.page.goto('/');
  }

  // recharts computes its internal "activeLabel" from hover tracking, not
  // purely from the click's own coordinates — a bare .click() can fire
  // before that state commits. Hovering first and waiting for the tooltip
  // to actually render is what makes the subsequent click reliable.
  async clickDebitBar(index: number) {
    const bar = this.debitBars.nth(index);
    await bar.hover();
    // Scoped to the Monthly trend chart-box — the donut chart on the same
    // page also renders its own (separate) .recharts-tooltip-wrapper.
    const monthlyTrendBox = this.page.locator('.charts-row .chart-box').first();
    await expect(monthlyTrendBox.locator('.recharts-tooltip-wrapper')).toBeVisible();
    await bar.click();
  }

  async openStatementTab() {
    await this.statementTabButton.click();
    await expect(this.statementView).toBeVisible();
    // Wait for the fixture data to actually load, not just the shell.
    await expect(this.ledgerRows.first()).toBeVisible();
  }

  statCard(label: string): Locator {
    return this.page.locator('.stat-card', { has: this.page.locator('.stat-label', { hasText: label }) });
  }

  async statValue(label: string): Promise<string> {
    return (await this.statCard(label).locator('.stat-value').innerText()).trim();
  }

  async entriesCount(): Promise<number> {
    const text = await this.entriesLabel.innerText();
    return Number(text.replace(/\D/g, ''));
  }

  async selectMonth(value: string) {
    await this.monthSelect.selectOption(value);
  }

  async selectBank(value: string) {
    await this.bankSelect.selectOption(value);
  }

  async selectType(value: 'All' | 'debit' | 'credit') {
    await this.typeSelect.selectOption(value);
  }

  async resetFilters() {
    await this.resetButton.click();
  }

  donutLegendItem(category: string): Locator {
    return this.donutLegendItems.filter({ hasText: category });
  }

  async clickDonutCategory(category: string) {
    await this.donutLegendItem(category).click();
  }

  reviewToggleButton(): Locator {
    return this.page.locator('.ledger-toolbar-right .link-button', { hasText: /need review|showing needs review/ });
  }

  async openEditDialogForRow(index: number) {
    await this.ledgerRows.nth(index).dblclick();
    await expect(this.modal).toBeVisible();
  }

  async cancelEditDialog() {
    await this.page.locator('.modal-actions button', { hasText: 'Cancel' }).click();
    await expect(this.modal).toBeHidden();
  }
}
