const DAY_MS = 24 * 60 * 60 * 1000;

function dayStamp(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
}

export function groupDayNumber(joinedOn: string | null, currentDate: string) {
  if (!joinedOn) return null;
  const joined = dayStamp(joinedOn);
  const current = dayStamp(currentDate);
  if (joined === null || current === null || current < joined) return null;
  return Math.floor((current - joined) / DAY_MS) + 1;
}
