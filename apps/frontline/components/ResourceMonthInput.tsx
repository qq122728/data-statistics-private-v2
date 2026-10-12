"use client";
import { useEffect, useState } from 'react';
import { normalizeResourceMonth } from './resource-buyer-groups';

export function ResourceMonthInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input type="month" aria-label="统计月份" value={draft} onChange={event => {
    const next = event.target.value;
    setDraft(next);
    const normalized = normalizeResourceMonth(next);
    if (normalized && next === normalized) onChange(normalized);
  }} onBlur={event => {
    const normalized = normalizeResourceMonth(event.currentTarget.value);
    event.currentTarget.value = normalized ?? value;
    setDraft(normalized ?? value);
    if (normalized && normalized !== value) onChange(normalized);
  }} />;
}
