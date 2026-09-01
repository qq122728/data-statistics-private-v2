"use client";

export type SmartDatePreset = "today" | "yesterday" | "7d" | "week" | "30d" | "month" | "lastMonth" | "custom";

const presets: Array<{ value: Exclude<SmartDatePreset, "custom">; label: string }> = [
  { value: "today", label: "今天" },
  { value: "yesterday", label: "昨天" },
  { value: "7d", label: "近7天" },
  { value: "week", label: "本周" },
  { value: "30d", label: "近30天" },
  { value: "month", label: "本月" },
  { value: "lastMonth", label: "上月" },
];

export function localCalendarDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function SmartDateRangeToolbar({
  range, from, to, currentLabel, loading, title = "统计日期", note = "快捷选择常用周期，也可以精确指定开始和结束日期",
  onRange, onFrom, onTo, onRefresh,
}: {
  range: string;
  from: string;
  to: string;
  currentLabel?: string;
  loading?: boolean;
  title?: string;
  note?: string;
  onRange: (value: SmartDatePreset) => void;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onRefresh: () => void;
}) {
  const today = localCalendarDate();
  const current = range === "custom" && from && to
    ? (from === to ? from : `${from} 至 ${to}`)
    : currentLabel || presets.find((item) => item.value === range)?.label || "当前区间";
  return <section className="fresh-toolbar analysis-date-toolbar" aria-label="智能日期筛选">
    <div className="fresh-history-intro"><strong>{title}</strong><span>{note}</span></div>
    <div className="analysis-date-presets" aria-label="快捷日期筛选">
      {presets.map((preset) => <button key={preset.value} type="button" data-active={range === preset.value} onClick={() => onRange(preset.value)}>{preset.label}</button>)}
      <button type="button" data-active={range === "custom"} onClick={() => onRange("custom")}>自定义</button>
    </div>
    {range === "custom" ? <div className="analysis-custom-range">
      <label><span>开始</span><input type="date" max={today} value={from} onChange={(event) => onFrom(event.target.value)} /></label>
      <b>至</b>
      <label><span>结束</span><input type="date" max={today} value={to} onChange={(event) => onTo(event.target.value)} /></label>
      <button type="button" className="fresh-primary" disabled={!from || !to || loading} onClick={onRefresh}>应用</button>
    </div> : null}
    <div className="analysis-range-current"><span>当前范围</span><strong>{current}</strong></div>
    <button type="button" className="fresh-primary" disabled={loading} onClick={onRefresh}>{loading ? "刷新中…" : "刷新"}</button>
  </section>;
}
