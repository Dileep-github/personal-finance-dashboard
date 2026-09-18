import { useState } from 'react';
import type { Transaction } from '../lib/types';
import { formatMoney } from '../lib/format';
import EditCategoryDialog from './EditCategoryDialog';

interface Props {
  rows: Transaction[];
  onSaved: () => void;
}

export default function LedgerTable({ rows, onSaved }: Props) {
  const [editing, setEditing] = useState<Transaction | null>(null);

  return (
    <div className="ledger-table-wrap">
      <table className="ledger-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Particulars</th>
            <th>Category</th>
            <th>Bank</th>
            <th className="num">Debit</th>
            <th className="num">Credit</th>
            <th className="num">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} onDoubleClick={() => setEditing(r)} className={r.confirmed ? '' : 'needs-review'}>
              <td className="ledger-date">{r.date}</td>
              <td className="ledger-particulars">
                <div className="ledger-particulars-title">{r.counterparty || r.particulars.slice(0, 40)}</div>
                <div className="ledger-particulars-sub">{r.particulars}</div>
              </td>
              <td>{r.category}</td>
              <td>{r.bank}</td>
              <td className="num debit">{r.debit ? formatMoney(r.debit) : ''}</td>
              <td className="num credit">{r.credit ? formatMoney(r.credit) : ''}</td>
              <td className="num">{formatMoney(r.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <EditCategoryDialog
          transaction={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onSaved();
          }}
        />
      )}
    </div>
  );
}
