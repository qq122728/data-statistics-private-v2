"use client";

import { useId, useMemo, useState } from "react";
import { FieldError } from "./FieldError";

export type EntryBatch = {
  id: string;
  sourceDate: string;
  group: { name: string };
  channel: { id: string; name: string };
};

export function BatchPicker({
  batches,
  value,
  onChange,
  error,
}: {
  batches: EntryBatch[];
  value: string;
  onChange: (batchId: string) => void;
  error?: string;
}) {
  const [search, setSearch] = useState("");
  const selectId = useId();
  const searchId = useId();
  const errorId = `${selectId}-error`;
  const visibleBatches = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? batches.filter((batch) => `${batch.sourceDate} ${batch.channel.name} ${batch.group.name}`.toLowerCase().includes(query))
      : batches;
  }, [batches, search]);

  return <div className="grid gap-3 lg:col-span-2 lg:grid-cols-2">
    <label htmlFor={searchId} className="field-label">搜索来源批次<input id={searchId} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="日期、渠道或小组" className="control w-full" /></label>
    <label htmlFor={selectId} className="field-label">来源批次<select id={selectId} value={value} onChange={(event) => onChange(event.target.value)} required aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} className="control w-full">
      <option value="">请选择来源日期 · 渠道</option>
      {visibleBatches.map((batch) => <option key={batch.id} value={batch.id}>{batch.sourceDate} · {batch.channel.name} · {batch.group.name}</option>)}
    </select></label>
    <div className="lg:col-span-2">
      <FieldError id={errorId} label="来源批次" message={error} />
    </div>
  </div>;
}
