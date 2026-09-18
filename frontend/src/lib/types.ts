export interface Transaction {
  id: number;
  statement_id: number;
  date: string;
  month: string;
  particulars: string;
  counterparty: string;
  bank: string;
  debit: number;
  credit: number;
  balance: number;
  type: 'debit' | 'credit';
  category: string;
  source: 'rule' | 'memory' | 'ml' | 'none' | 'user';
  confidence: number;
  confirmed: number;
}

export interface FilterOptions {
  months: string[];
  banks: string[];
  categories: string[];
}

export interface ImportResult {
  filename: string;
  inserted: number;
  skipped_duplicates: number;
  counts: { rule: number; memory: number; ml: number; none: number };
  needs_review: number;
  log: string[];
}

export interface RetrainResult {
  trained: boolean;
  example_count: number;
  message: string;
}
