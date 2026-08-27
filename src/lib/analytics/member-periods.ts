import { addCalendarDays } from "./maturity-window";

export type MemberPeriod = "mature7" | "mature30" | "custom";

export type MemberPeriodRange = {
  sourceDateFrom: string;
  sourceDateTo: string;
  sourceDayCount: number;
};

export type ResolvedMemberPeriods = {
  period: MemberPeriod;
  current: MemberPeriodRange;
  previous: MemberPeriodRange;
  warning: string | null;
};

export const invalidMemberPeriodWarning = "组员统计周期无效，已恢复最近 30 个成熟来源日。";

function isCalendarDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function calendarDayCount(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000) + 1;
}

function shortcut(period: "mature7" | "mature30", today: string, warning: string | null): ResolvedMemberPeriods {
  const sourceDayCount = period === "mature7" ? 7 : 30;
  const sourceDateTo = addCalendarDays(today, -7);
  const sourceDateFrom = addCalendarDays(sourceDateTo, -(sourceDayCount - 1));
  return {
    period,
    current: { sourceDateFrom, sourceDateTo, sourceDayCount },
    previous: {
      sourceDateFrom: addCalendarDays(sourceDateFrom, -sourceDayCount),
      sourceDateTo: addCalendarDays(sourceDateFrom, -1),
      sourceDayCount,
    },
    warning,
  };
}

export function resolveMemberPeriods(
  input: { period?: string; sourceDateFrom?: string; sourceDateTo?: string },
  today: string,
): ResolvedMemberPeriods {
  const period = input.period ?? "mature30";
  if (period === "mature7" || period === "mature30") return shortcut(period, today, null);

  if (period === "custom"
    && isCalendarDate(input.sourceDateFrom)
    && isCalendarDate(input.sourceDateTo)
    && input.sourceDateFrom <= input.sourceDateTo
    && input.sourceDateTo <= today) {
    const sourceDayCount = calendarDayCount(input.sourceDateFrom, input.sourceDateTo);
    return {
      period,
      current: { sourceDateFrom: input.sourceDateFrom, sourceDateTo: input.sourceDateTo, sourceDayCount },
      previous: {
        sourceDateFrom: addCalendarDays(input.sourceDateFrom, -sourceDayCount),
        sourceDateTo: addCalendarDays(input.sourceDateFrom, -1),
        sourceDayCount,
      },
      warning: null,
    };
  }

  return shortcut("mature30", today, invalidMemberPeriodWarning);
}
