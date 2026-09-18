import { formatMonth } from '../lib/format';

interface Props {
  months: string[];
  banks: string[];
  month: string;
  bank: string;
  type: string;
  onMonthChange: (v: string) => void;
  onBankChange: (v: string) => void;
  onTypeChange: (v: string) => void;
  onReset: () => void;
}

export default function FilterBar({
  months, banks, month, bank, type,
  onMonthChange, onBankChange, onTypeChange, onReset,
}: Props) {
  return (
    <div className="filter-bar">
      <label>
        Month
        <select value={month} onChange={(e) => onMonthChange(e.target.value)}>
          <option value="All">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>{formatMonth(m)}</option>
          ))}
        </select>
      </label>
      <label>
        Bank
        <select value={bank} onChange={(e) => onBankChange(e.target.value)}>
          <option value="All">All banks</option>
          {banks.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </label>
      <label>
        Type
        <select value={type} onChange={(e) => onTypeChange(e.target.value)}>
          <option value="All">All types</option>
          <option value="debit">Debit only</option>
          <option value="credit">Credit only</option>
        </select>
      </label>
      <button className="reset-filters-button" onClick={onReset}>Reset filters</button>
    </div>
  );
}
