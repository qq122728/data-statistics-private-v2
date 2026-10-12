"use client";
import { normalizeResourceMonth } from './resource-buyer-groups';
import styles from './ResourceMonthInput.module.css';

export function ResourceMonthInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const normalized = normalizeResourceMonth(value);
  const year = Number(normalized?.slice(0, 4) || new Date().getFullYear());
  const month = normalized?.slice(5) || '01';
  // Keep nearby years available even when browsing older records.
  const firstYear = Math.max(1, year - 5);
  const lastYear = Math.min(9999, year + 5);
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => String(firstYear + index).padStart(4, '0'));
  return <span className={styles.picker} role="group" aria-label="统计月份">
    <select aria-label="统计年份" value={String(year).padStart(4, '0')} onChange={event => onChange(`${event.target.value}-${month}`)}>
      {years.map(item => <option key={item} value={item}>{Number(item)}年</option>)}
    </select>
    <select aria-label="统计月份" value={month} onChange={event => onChange(`${String(year).padStart(4, '0')}-${event.target.value}`)}>
      {Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')).map(item => <option key={item} value={item}>{Number(item)}月</option>)}
    </select>
  </span>;
}
