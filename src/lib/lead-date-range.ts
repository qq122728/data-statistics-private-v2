export type LeadDatePreset = "all" | "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth" | "custom";

export type LeadDateRange = {
  preset: LeadDatePreset;
  from: string;
  to: string;
  label: string;
};

const labels: Record<LeadDatePreset, string> = {
  all: "全部",
  today: "今日",
  yesterday: "昨日",
  "7d": "近7天",
  "30d": "近30天",
  month: "当月",
  lastMonth: "上月",
  custom: "自定义",
};

function validDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function addDateDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function leadDateRangeForPreset(preset: LeadDatePreset, today: string, customFrom?: string, customTo?: string): LeadDateRange {
  if (preset === "all") return { preset, from: "", to: "", label: labels[preset] };
  let from = today;
  let to = today;
  if (preset === "yesterday") from = to = addDateDays(today, -1);
  if (preset === "7d") from = addDateDays(today, -6);
  if (preset === "30d") from = addDateDays(today, -29);
  if (preset === "month") from = `${today.slice(0, 7)}-01`;
  if (preset === "lastMonth") {
    const [year, month] = today.slice(0, 7).split("-").map(Number);
    const previousMonthEnd = new Date(Date.UTC(year, month - 1, 0));
    from = new Date(Date.UTC(previousMonthEnd.getUTCFullYear(), previousMonthEnd.getUTCMonth(), 1)).toISOString().slice(0, 10);
    to = previousMonthEnd.toISOString().slice(0, 10);
  }
  if (preset === "custom") {
    from = validDate(customFrom) ? customFrom : addDateDays(today, -6);
    to = validDate(customTo) ? customTo : today;
    if (from > to) [from, to] = [to, from];
  }
  return { preset, from, to, label: labels[preset] };
}

export function resolveLeadDateRange(values: Record<string, string | undefined>, today: string): LeadDateRange {
  const rawPreset = values.range;
  const hasExplicitDates = validDate(values.sourceDateFrom) || validDate(values.sourceDateTo);
  const preset: LeadDatePreset = rawPreset === "all" || rawPreset === "today" || rawPreset === "yesterday" || rawPreset === "7d" || rawPreset === "30d" || rawPreset === "month" || rawPreset === "lastMonth" || rawPreset === "custom" ? rawPreset : hasExplicitDates ? "custom" : "7d";
  return leadDateRangeForPreset(preset, today, values.sourceDateFrom, values.sourceDateTo);
}

export function resolveDateRangeWithDefault(
  values: Record<string, string | undefined>,
  today: string,
  defaultPreset: Exclude<LeadDatePreset, "custom" | "all"> = "30d",
): LeadDateRange {
  return resolveLeadDateRange(
    values.range || values.sourceDateFrom || values.sourceDateTo
      ? values
      : { ...values, range: defaultPreset },
    today,
  );
}

export const leadDatePresets: Array<{ value: Exclude<LeadDatePreset, "custom" | "all">; label: string }> = [
  { value: "today", label: "今日" },
  { value: "yesterday", label: "昨日" },
  { value: "7d", label: "近7天" },
  { value: "30d", label: "近30天" },
  { value: "month", label: "当月" },
  { value: "lastMonth", label: "上月" },
];

export function leadDateRangeQuery(range: LeadDateRange): string {
  const params = new URLSearchParams({ range: range.preset });
  if (range.preset !== "all") {
    params.set("sourceDateFrom", range.from);
    params.set("sourceDateTo", range.to);
  }
  return params.toString();
}
