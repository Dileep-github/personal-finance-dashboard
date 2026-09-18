import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import FilterBar from './FilterBar';
import CategoryDonut from './CategoryDonut';
import LedgerTable from './LedgerTable';
import { getFilters, getTransactions, retrain } from '../api/client';
import { formatMoney, formatMonth } from '../lib/format';
import type { Transaction, FilterOptions } from '../lib/types';

interface Props {
  reviewOnly: boolean;
  setReviewOnly: (v: boolean) => void;
}

// Transaction.date is "dd-mm-yyyy" — parse to a real timestamp so we sort
// chronologically rather than trusting a plain string sort.
function parseDate(d: string): number {
  const [dd, mm, yyyy] = d.split('-').map(Number);
  return new Date(yyyy, (mm || 1) - 1, dd || 1).getTime();
}

export default function StatementView({ reviewOnly, setReviewOnly }: Props) {
  const [filters, setFilters] = useState<FilterOptions>({ months: [], banks: [], categories: [] });
  const [month, setMonth] = useState('All');
  const [bank, setBank] = useState('All');
  const [type, setType] = useState('All');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [baseRows, setBaseRows] = useState<Transaction[]>([]);
  const [retrainMessage, setRetrainMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const [f, rows] = await Promise.all([getFilters(), getTransactions({ bank, type })]);
      setFilters(f);
      setBaseRows(rows);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bank, type]);

  const displayRows = useMemo(
    () => (month === 'All' ? baseRows : baseRows.filter((r) => r.month === month)),
    [baseRows, month],
  );

  const ledgerRows = useMemo(() => {
    let rows = displayRows;
    if (selectedCategory) rows = rows.filter((r) => r.category === selectedCategory);
    if (reviewOnly) rows = rows.filter((r) => !r.confirmed);
    return [...rows].sort((a, b) => parseDate(b.date) - parseDate(a.date) || b.id - a.id);
  }, [displayRows, selectedCategory, reviewOnly]);

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const r of ledgerRows) {
      if (r.type === 'debit') debit += r.debit;
      else credit += r.credit;
    }
    let opening = 0;
    let closing = 0;
    let bankName = 'All banks';
    let dateRange = '';
    if (ledgerRows.length > 0) {
      const chronological = [...ledgerRows].sort((a, b) => parseDate(a.date) - parseDate(b.date));
      const first = chronological[0];
      const last = chronological[chronological.length - 1];
      opening = first.balance - first.credit + first.debit;
      closing = last.balance;
      dateRange = `${first.date} – ${last.date}`;
    }
    if (bank !== 'All') bankName = bank;
    return {
      debit, credit, net: credit - debit, count: ledgerRows.length,
      opening, closing, bankName, dateRange,
      needsReview: ledgerRows.filter((r) => !r.confirmed).length,
    };
  }, [ledgerRows, bank]);

  const categoryData = useMemo(() => {
    const byCat = new Map<string, number>();
    for (const r of displayRows) {
      if (r.type !== 'debit') continue;
      byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.debit);
    }
    return [...byCat.entries()].map(([category, debit]) => ({ category, debit }));
  }, [displayRows]);

  const monthlyData = useMemo(() => {
    const months = [...new Set(baseRows.map((r) => r.month))].sort();
    return months.map((m) => {
      let debit = 0;
      let credit = 0;
      for (const r of baseRows) {
        if (r.month !== m) continue;
        if (r.type === 'debit') debit += r.debit;
        else credit += r.credit;
      }
      return { month: m, debit, credit };
    });
  }, [baseRows]);

  async function handleRetrain() {
    const result = await retrain();
    setRetrainMessage(result.message);
  }

  async function handleSaved() {
    await refresh();
  }

  function handleReset() {
    setMonth('All');
    setBank('All');
    setType('All');
    setSelectedCategory(null);
    setReviewOnly(false);
  }

  return (
    <div className="statement-view">
      <div className="statement-header">
        <div>
          <h1>Statement Ledger</h1>
          <p className="statement-subtitle">Debit / credit analysis — categorised, by month, by bank</p>
        </div>
        <div className="statement-header-right">
          <div>{totals.bankName}</div>
          {totals.dateRange && <div>{totals.dateRange}</div>}
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-label">Opening balance</div>
          <div className="stat-value">{formatMoney(totals.opening)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Closing balance</div>
          <div className="stat-value">{formatMoney(totals.closing)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total debit</div>
          <div className="stat-value debit">{formatMoney(totals.debit)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total credit</div>
          <div className="stat-value credit">{formatMoney(totals.credit)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Net change</div>
          <div className={`stat-value ${totals.net < 0 ? 'debit' : 'credit'}`}>{formatMoney(totals.net)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Transactions</div>
          <div className="stat-value">{totals.count}</div>
        </div>
      </div>

      <FilterBar
        months={filters.months}
        banks={filters.banks}
        month={month}
        bank={bank}
        type={type}
        onMonthChange={setMonth}
        onBankChange={setBank}
        onTypeChange={setType}
        onReset={handleReset}
      />

      <div className="charts-row">
        <div className="chart-box">
          <h3>Monthly trend</h3>
          <p className="chart-hint">Debits vs credits by month — click a bar to drill into that month</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={monthlyData}
              onClick={(state) => {
                const label = state?.activeLabel;
                if (label) setMonth((m) => (m === label ? 'All' : String(label)));
              }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tickFormatter={formatMonth} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => formatMoney(Number(v))} labelFormatter={(label) => formatMonth(String(label))} />
              <Legend itemSorter={(item) => (item.dataKey === 'debit' ? 0 : 1)} />
              <Bar dataKey="debit" name="Debit" fill="#a3402f" cursor="pointer" />
              <Bar dataKey="credit" name="Credit" fill="#1f5c4f" cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-box">
          <h3>Spend by category</h3>
          <p className="chart-hint">Click a category to filter the ledger below</p>
          <CategoryDonut data={categoryData} selected={selectedCategory} onSelect={setSelectedCategory} />
        </div>
      </div>

      <div className="ledger-section">
        <div className="ledger-toolbar">
          <h3>Ledger entries</h3>
          <div className="ledger-toolbar-right">
            <span>{totals.count} entries</span>
            {totals.needsReview > 0 && (
              <button className="link-button" onClick={() => setReviewOnly(!reviewOnly)}>
                {reviewOnly ? 'showing needs review' : `${totals.needsReview} need review`}
              </button>
            )}
            <button className="link-button" onClick={handleRetrain}>Retrain model</button>
          </div>
        </div>
        {retrainMessage && <p className="retrain-message">{retrainMessage}</p>}
        {loading ? (
          <p className="hint">Loading…</p>
        ) : (
          <LedgerTable rows={ledgerRows} onSaved={handleSaved} />
        )}
        <p className="hint">Double-click a row to confirm or change its category.</p>
      </div>
    </div>
  );
}
