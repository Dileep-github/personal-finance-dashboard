import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { formatMoney } from '../lib/format';

// Validated 8-hue categorical order (dataviz skill, adjacent-pair CVD-safe).
// "Other" intentionally sits outside this set as a neutral gray — it isn't
// a real category identity, just an overflow bucket.
const CATEGORY_COLORS = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100',
  '#e87ba4', '#008300', '#4a3aa7',
];
const OTHER_COLOR = '#b8b6ae';
const MAX_SLICES = 7;

export interface CategorySlice {
  category: string;
  debit: number;
}

interface Props {
  data: CategorySlice[];
  selected: string | null;
  onSelect: (category: string | null) => void;
}

export default function CategoryDonut({ data, selected, onSelect }: Props) {
  const sorted = [...data].sort((a, b) => b.debit - a.debit);
  const top = sorted.slice(0, MAX_SLICES);
  const rest = sorted.slice(MAX_SLICES);
  const otherTotal = rest.reduce((sum, r) => sum + r.debit, 0);
  const slices = otherTotal > 0 ? [...top, { category: 'Other', debit: otherTotal }] : top;
  const total = slices.reduce((sum, s) => sum + s.debit, 0);

  const colorFor = (category: string, index: number) =>
    category === 'Other' ? OTHER_COLOR : CATEGORY_COLORS[index % CATEGORY_COLORS.length];

  function handleClick(category: string) {
    if (category === 'Other') return; // not a real filterable category
    onSelect(selected === category ? null : category);
  }

  return (
    <div className="donut-block">
      <div className="donut-chart">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={slices}
              dataKey="debit"
              nameKey="category"
              innerRadius="55%"
              outerRadius="92%"
              paddingAngle={slices.length > 1 ? 3 : 0}
              cornerRadius={4}
              stroke="none"
              onClick={(entry) => handleClick(String(entry.name))}
            >
              {slices.map((s, i) => (
                <Cell
                  key={s.category}
                  fill={colorFor(s.category, i)}
                  cursor={s.category === 'Other' ? 'default' : 'pointer'}
                  opacity={selected && selected !== s.category ? 0.35 : 1}
                />
              ))}
            </Pie>
            <Tooltip formatter={(v) => formatMoney(Number(v))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="donut-legend">
        {slices.map((s, i) => {
          const pct = total > 0 ? Math.round((s.debit / total) * 100) : 0;
          const isOther = s.category === 'Other';
          return (
            <li
              key={s.category}
              className={selected === s.category ? 'selected' : ''}
              onClick={() => handleClick(s.category)}
              style={{ cursor: isOther ? 'default' : 'pointer' }}
            >
              <span className="donut-dot" style={{ background: colorFor(s.category, i) }} />
              <span className="donut-label">{s.category}</span>
              <span className="donut-value">{formatMoney(s.debit)} · {pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
