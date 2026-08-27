export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function isWithinMaturityWindow(sourceDate: string, occurredOn: string, days: 7 | 14): boolean {
  return occurredOn >= sourceDate && occurredOn <= addCalendarDays(sourceDate, days);
}
