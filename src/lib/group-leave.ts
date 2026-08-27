import { groupDayNumber } from "./group-progress";

export type GroupLeaveLevel = "EARLY" | "WATCH" | "NORMAL" | "UNKNOWN";

export type GroupLeaveAssessment = {
  dayNumber: number | null;
  level: GroupLeaveLevel;
  label: "1–8天异常退群" | "9–13天观察退群" | "14天起正常退群" | "退群日期待核对";
};

export function assessGroupLeave(joinedOn: string | null, leftOn: string | null): GroupLeaveAssessment {
  if (!leftOn) return { dayNumber: null, level: "UNKNOWN", label: "退群日期待核对" };
  const dayNumber = groupDayNumber(joinedOn, leftOn);
  if (dayNumber === null) return { dayNumber: null, level: "UNKNOWN", label: "退群日期待核对" };
  if (dayNumber <= 8) return { dayNumber, level: "EARLY", label: "1–8天异常退群" };
  if (dayNumber <= 13) return { dayNumber, level: "WATCH", label: "9–13天观察退群" };
  return { dayNumber, level: "NORMAL", label: "14天起正常退群" };
}

export function leaveOrderLabel(hasActiveOrder: boolean) {
  return hasActiveOrder ? "已开单退群" : "未开单退群";
}
