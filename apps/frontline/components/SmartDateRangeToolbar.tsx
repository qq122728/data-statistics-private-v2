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

function monthOptions(today: string, count = 36) {
  const [year, month] = today.slice(0, 7).split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - index, 1));
    const value = date.toISOString().slice(0, 7);
    return { value, label: `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月` };
  });
}

function monthBounds(month: string, today: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const naturalTo = `${month}-${String(lastDay).padStart(2, "0")}`;
  return { from: `${month}-01`, to: naturalTo > today ? today : naturalTo, dayCount: lastDay };
}

export function localCalendarDate() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  const base = `${part("year")}-${part("month")}-${part("day")}`;
  if (Number(part("hour")) < 14) return base;
  const next = new Date(`${base}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function SmartDateRangeToolbar({
  range, from, to, currentLabel, loading, title = "统计日期", note = "统一按北京时间统计，每天 14:00 切换到下一统计日",
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
  const selectedMonth = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from.slice(0, 7) : today.slice(0, 7);
  const selectedDay = range === "custom" && from === to ? String(Number(from.slice(8, 10))) : "";
  const selectedBounds = monthBounds(selectedMonth, today);
  const selectMonth = (month: string) => {
    const bounds = monthBounds(month, today);
    onRange("custom");
    onFrom(bounds.from);
    onTo(bounds.to);
  };
  const selectDay = (day: string) => {
    onRange("custom");
    if (!day) {
      onFrom(selectedBounds.from);
      onTo(selectedBounds.to);
      return;
    }
    const date = `${selectedMonth}-${day.padStart(2, "0")}`;
    onFrom(date);
    onTo(date);
  };
  const current = range === "custom" && from && to
    ? (from === to ? from : `${from} 至 ${to}`)
    : currentLabel || presets.find((item) => item.value === range)?.label || "当前区间";
  return <section className="fresh-toolbar analysis-date-toolbar" aria-label="智能日期筛选">
    <div className="fresh-history-intro"><strong>{title}</strong><span>{note}</span></div>
    <div className="analysis-date-presets" aria-label="快捷日期筛选">
      {presets.map((preset) => <button key={preset.value} type="button" data-active={range === preset.value} onClick={() => onRange(preset.value)}>{preset.label}</button>)}
      <button type="button" data-active={range === "custom"} onClick={() => onRange("custom")}>自定义</button>
    </div>
    <div className="analysis-month-day" aria-label="按月份和日期筛选">
      <label><span>月份</span><select value={selectedMonth} onChange={(event) => selectMonth(event.target.value)}>{monthOptions(today).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label><span>日期</span><select value={selectedDay} onChange={(event) => selectDay(event.target.value)}><option value="">整月</option>{Array.from({ length: selectedBounds.dayCount }, (_, index) => index + 1).map((day) => <option key={day} value={day} disabled={`${selectedMonth}-${String(day).padStart(2, "0")}` > today}>{day}日</option>)}</select></label>
      <button type="button" className="fresh-primary" disabled={loading} onClick={onRefresh}>查询</button>
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
