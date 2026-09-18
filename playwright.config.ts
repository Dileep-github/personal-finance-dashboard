import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

// Isolated fixture data dir — the backend under test never touches the
// real data/ledger.db (personal bank transactions). See tests/e2e/seed.py.
const TEST_DATA_DIR = path.resolve(__dirname, 'tests/e2e/.data');

// Deliberately NOT 8756/5173 — those are the real `npm run dev` ports, and
// running tests must never collide with (or require closing) an active
// dev/Electron session on the developer's machine.
const TEST_BACKEND_PORT = 8766;
const TEST_FRONTEND_PORT = 5183;
const TEST_BACKEND_URL = `http://127.0.0.1:${TEST_BACKEND_PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // all specs share one seeded backend/DB
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${TEST_FRONTEND_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  // This is a single-user Windows desktop app (Electron/Chromium), not a
  // cross-browser site — Chromium-only is the right scope, not a gap.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: `${path.resolve(__dirname, '.venv/Scripts/python.exe')} tests/e2e/seed.py "${TEST_DATA_DIR}" && ${path.resolve(__dirname, '.venv/Scripts/python.exe')} -m uvicorn backend.main:app --host 127.0.0.1 --port ${TEST_BACKEND_PORT}`,
      url: `${TEST_BACKEND_URL}/api/health`,
      cwd: __dirname,
      reuseExistingServer: false,
      timeout: 30000,
      env: { STATEMENT_LEDGER_DATA_DIR: TEST_DATA_DIR },
    },
    {
      command: `npx vite --port ${TEST_FRONTEND_PORT} --strictPort`,
      url: `http://localhost:${TEST_FRONTEND_PORT}`,
      cwd: path.resolve(__dirname, 'frontend'),
      reuseExistingServer: false,
      timeout: 30000,
      env: { VITE_API_BASE_URL: TEST_BACKEND_URL },
    },
  ],
});
