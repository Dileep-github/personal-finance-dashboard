import type { Transaction, FilterOptions, ImportResult, RetrainResult } from '../lib/types';

declare global {
  interface Window {
    // Set by electron/preload.js in packaged builds — production picks a
    // free backend port at launch instead of a fixed one (see
    // electron/main.js), so the built frontend can't know it at build time.
    statementLedger?: { apiBaseUrl: string };
  }
}

// Overridable so the E2E suite can point at an isolated test backend
// instance without colliding with a real `npm run dev` session on 8756.
// window.statementLedger (Electron production) takes priority over both,
// since it reflects the port actually bound at runtime.
const BASE_URL =
  (typeof window !== 'undefined' && window.statementLedger?.apiBaseUrl) ||
  import.meta.env.VITE_API_BASE_URL ||
  'http://127.0.0.1:8756';

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      // response wasn't JSON — fall back to statusText
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function getCategories(): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/api/categories`);
  const data = await handle<{ categories: string[] }>(res);
  return data.categories;
}

export async function getFilters(): Promise<FilterOptions> {
  const res = await fetch(`${BASE_URL}/api/filters`);
  return handle<FilterOptions>(res);
}

export interface TransactionQuery {
  month?: string;
  bank?: string;
  category?: string;
  type?: string;
  needsReview?: boolean;
}

export async function getTransactions(query: TransactionQuery = {}): Promise<Transaction[]> {
  const params = new URLSearchParams();
  if (query.month) params.set('month', query.month);
  if (query.bank) params.set('bank', query.bank);
  if (query.type) params.set('type', query.type);
  if (query.category) params.set('category', query.category);
  if (query.needsReview) params.set('needs_review', 'true');
  const res = await fetch(`${BASE_URL}/api/transactions?${params.toString()}`);
  const data = await handle<{ transactions: Transaction[] }>(res);
  return data.transactions;
}

export async function updateTransactionCategory(id: number, category: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/transactions/${id}/category`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category }),
  });
  await handle<{ ok: boolean }>(res);
}

export async function retrain(): Promise<RetrainResult> {
  const res = await fetch(`${BASE_URL}/api/retrain`, { method: 'POST' });
  return handle<RetrainResult>(res);
}

export async function importStatement(file: File): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE_URL}/api/import`, { method: 'POST', body: form });
  return handle<ImportResult>(res);
}
