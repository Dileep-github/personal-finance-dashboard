import { test, expect } from '@playwright/test';
import { StatementPage } from './pages/StatementPage';

// No sample bank-statement PDF exists in this repo to drive a real parse
// through /api/import, so this covers the Import tab's UI/state logic only
// (button disabled until a file is chosen). The parse -> categorize ->
// insert pipeline itself is backend logic (parser.py/categorizer.py/
// storage.py), already exercised independently of this UI.
test.describe('Import tab', () => {
  test('is the default tab, with Import disabled until a file is chosen', async ({ page }) => {
    const statement = new StatementPage(page);
    await statement.goto();

    await expect(page.locator('main')).toContainText('No file selected');
    await expect(page.getByRole('button', { name: 'Import Statement' })).toBeDisabled();
  });
});
