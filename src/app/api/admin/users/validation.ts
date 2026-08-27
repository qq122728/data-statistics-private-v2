import { API_LIMITS } from "../../../../lib/request-limits";

type UserRole = "ADMIN" | "RESOURCE_MANAGER" | "COMPANY_MANAGER" | "FINANCE" | "HR" | "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
export type EmploymentStage = "TRAINING" | "OBSERVATION" | "FORMAL" | "PAUSED";
export type RecruitmentSource = "DIRECT" | "AGENT";

const employeeStages = new Set<EmploymentStage>(["TRAINING", "OBSERVATION", "FORMAL", "PAUSED"]);
const recruitmentSources = new Set<RecruitmentSource>(["DIRECT", "AGENT"]);
const prismaIntMax = 2_147_483_647;

function hasOwn(input: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, field);
}

function isDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  return normalized.getUTCFullYear() === year && normalized.getUTCMonth() === month - 1 && normalized.getUTCDate() === day;
}

export function parseEffectiveFanPriceCents(input: unknown):
  | { success: true; value: number | null }
  | { success: false; error: string } {
  if (input === null) return { success: true, value: null };
  if (!Number.isInteger(input) || (input as number) < 0 || (input as number) > prismaIntMax) {
    return { success: false, error: "有效粉单价必须是 0 到 2147483647 之间的整数分" };
  }
  return { success: true, value: input as number };
}

export type EmploymentUpdate = {
  hireDate?: string | null;
  stageOverride?: EmploymentStage | null;
  stageOverrideReason?: string | null;
};

export type RecruitmentUpdate = {
  recruitmentSource?: RecruitmentSource | null;
  referrerName?: string | null;
};

export function parseRecruitmentUpdate(input: Record<string, unknown>):
  | { success: true; value: RecruitmentUpdate }
  | { success: false; error: string } {
  const value: RecruitmentUpdate = {};
  const hasSource = hasOwn(input, "recruitmentSource");
  const hasReferrer = hasOwn(input, "referrerName");
  if (hasSource) {
    if (input.recruitmentSource === null || input.recruitmentSource === "") value.recruitmentSource = null;
    else if (typeof input.recruitmentSource !== "string" || !recruitmentSources.has(input.recruitmentSource as RecruitmentSource)) return { success: false, error: "入职来源不正确" };
    else value.recruitmentSource = input.recruitmentSource as RecruitmentSource;
  }
  if (hasReferrer) {
    if (input.referrerName === null || input.referrerName === "") value.referrerName = null;
    else if (typeof input.referrerName !== "string") return { success: false, error: "介绍人不正确" };
    else {
      const referrerName = input.referrerName.trim();
      if (!referrerName || referrerName.length > 60) return { success: false, error: "介绍人请填写 1 到 60 个字" };
      value.referrerName = referrerName;
    }
  }
  const source = value.recruitmentSource;
  if (hasSource && (source === "DIRECT" || source === null)) value.referrerName = null;
  if (source === "AGENT" && !value.referrerName) return { success: false, error: "代理介绍请填写介绍人" };
  return { success: true, value };
}

export function parseEmploymentUpdate(input: Record<string, unknown>):
  | { success: true; value: EmploymentUpdate }
  | { success: false; error: string } {
  const value: EmploymentUpdate = {};
  if (hasOwn(input, "hireDate")) {
    if (input.hireDate === null || input.hireDate === "") value.hireDate = null;
    else if (typeof input.hireDate !== "string" || !isDateOnly(input.hireDate)) return { success: false, error: "入职日期不正确" };
    else value.hireDate = input.hireDate;
  }
  if (hasOwn(input, "stageOverride")) {
    if (input.stageOverride === null || input.stageOverride === "") value.stageOverride = null;
    else if (typeof input.stageOverride !== "string" || !employeeStages.has(input.stageOverride as EmploymentStage)) return { success: false, error: "手动阶段不正确" };
    else value.stageOverride = input.stageOverride as EmploymentStage;
  }
  if (hasOwn(input, "stageOverrideReason")) {
    if (input.stageOverrideReason === null || input.stageOverrideReason === "") value.stageOverrideReason = null;
    else if (typeof input.stageOverrideReason !== "string") return { success: false, error: "手动阶段原因不正确" };
    else {
      const reason = input.stageOverrideReason.trim();
      if (reason.length > API_LIMITS.accountReasonCharacters) return { success: false, error: `手动阶段原因不能超过 ${API_LIMITS.accountReasonCharacters} 个字` };
      value.stageOverrideReason = reason || null;
    }
  }
  if (value.stageOverride === null) value.stageOverrideReason = null;
  if (value.stageOverride !== undefined && value.stageOverride !== null && (!value.stageOverrideReason || value.stageOverrideReason.length < 4)) {
    return { success: false, error: "手动阶段原因至少需要 4 个字" };
  }
  return { success: true, value };
}

export function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

export function isActiveLeadGroupConstraintError(error: unknown): boolean {
  if (!isUniqueConstraintError(error) || !error || typeof error !== "object") return false;
  const target = "meta" in error && error.meta && typeof error.meta === "object" && "target" in error.meta
    ? error.meta.target
    : undefined;
  return Array.isArray(target)
    ? target.includes("groupId")
    : typeof target === "string" && (target.includes("groupId") || target.includes("User_one_active_lead_per_group"));
}

export function getMemberProtectionError(input: {
  actorId: string;
  targetId: string;
  currentRole: UserRole;
  currentActive: boolean;
  nextRole: UserRole;
  nextActive: boolean;
  activeAdminCount: number;
}): string | null {
  if (input.actorId === input.targetId && input.currentActive && !input.nextActive) {
    return "不能停用当前登录账号";
  }
  const removesActiveAdmin = input.currentRole === "ADMIN" && input.currentActive
    && (input.nextRole !== "ADMIN" || !input.nextActive);
  if (removesActiveAdmin && input.activeAdminCount <= 1) {
    return "系统至少需要保留一个启用中的管理员";
  }
  return null;
}
