export function WorkbenchStageChip({ active, label, count, onClick }: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return <button type="button" onClick={onClick} style={{
    display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 999,
    cursor: "pointer", fontSize: 13, fontWeight: 600,
    border: `1px solid ${active ? "var(--accent)" : "var(--line-strong)"}`,
    background: active ? "var(--accent-soft)" : "var(--surface)",
    color: active ? "var(--accent)" : "var(--ink-2)",
  }}>
    {label}<span className="tnum" style={{ fontSize: 12, color: active ? "var(--accent)" : "var(--ink-3)" }}>{count}</span>
  </button>;
}
