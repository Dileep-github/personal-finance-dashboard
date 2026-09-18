import { useEffect, useState } from 'react';
import type { Transaction } from '../lib/types';
import { getCategories, updateTransactionCategory } from '../api/client';

interface Props {
  transaction: Transaction;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditCategoryDialog({ transaction, onClose, onSaved }: Props) {
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState(transaction.category);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCategories().then(setCategories).catch(() => {});
  }, []);

  async function handleSave() {
    const trimmed = category.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await updateTransactionCategory(transaction.id, trimmed);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <p className="modal-particulars">{transaction.particulars}</p>
        <p className="modal-counterparty">Counterparty: {transaction.counterparty || '—'}</p>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {!categories.includes(category) && <option value={category}>{category}</option>}
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button onClick={handleSave} disabled={saving}>Save (this trains the model)</button>
          <button onClick={onClose} disabled={saving}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
