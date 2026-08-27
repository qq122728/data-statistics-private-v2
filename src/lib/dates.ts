export function localDateYYYYMMDD(date = new Date(), timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  return normalized.getUTCFullYear() === year && normalized.getUTCMonth() === month - 1 && normalized.getUTCDate() === day;
}

function parseLocalDate(value: string): [number, number, number] | null {
  if (!isCalendarDate(value)) return null;
  const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)!;
  return [Number(year), Number(month), Number(day)];
}

export function addLocalDays(value: string, days: number): string | null {
  const parts = parseLocalDate(value);
  if (!parts) return null;
  const [year, month, day] = parts;
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`;
}

function localMidnightUtc(value: string, timeZone: string): Date | null {
  const parts = parseLocalDate(value);
  if (!parts) return null;
  const [year, month, day] = parts;
  const target = Date.UTC(year, month - 1, day);
  let candidate = target;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const formatted = formatter.formatToParts(new Date(candidate));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(formatted.find((item) => item.type === type)?.value);
    const representedLocalTime = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    const adjustment = target - representedLocalTime;
    candidate += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(candidate);
}

export function localDateFilterBounds(from: string | null, to: string | null, timeZone: string): { gte?: Date; lt?: Date } {
  const gte = from ? localMidnightUtc(from, timeZone) : null;
  const nextDay = to ? addLocalDays(to, 1) : null;
  const lt = nextDay ? localMidnightUtc(nextDay, timeZone) : null;
  return { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };
}
