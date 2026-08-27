type AdminEntity = "member" | "group" | "channel";
type AdminMutation = "create" | "update" | "disable" | "enable" | "reset";
export type AdminFormField = "employeeCode" | "username" | "name" | "password" | "role" | "groupId" | "departmentId" | "effectiveFanPriceCents" | "hireDate" | "recruitmentSource" | "referrerName" | "stageOverride" | "stageOverrideReason";
export type AdminFormError = { message: string; field: AdminFormField | null };

const entityNames: Record<AdminEntity, string> = {
  member: "成员",
  group: "小组",
  channel: "渠道",
};

const auditEntityNames: Record<string, string> = {
  User: "成员",
  Department: "下属公司",
  TeamGroup: "小组",
  Channel: "渠道",
  SystemSetting: "系统设置",
  HistoryGroup: "历史数据",
  LeadCustomer: "客户",
};

const fieldNames: Record<string, string> = {
  employeeCode: "人员代号",
  name: "名称",
  username: "登录账号",
  role: "角色",
  groupId: "所属小组",
  departmentId: "所属下属公司",
  active: "启用状态",
  password: "密码",
  appName: "系统名称",
  timezone: "时区",
  defaultReportMode: "默认报表模式",
  allowMemberChannelCreation: "成员创建渠道",
  fanCostMode: "粉成本方式",
  effectiveFanPriceCents: "有效数据单价",
  hireDate: "入职日期",
  recruitmentSource: "入职来源",
  referrerName: "介绍人",
  stageOverride: "手动阶段",
  stageOverrideReason: "覆盖原因",
  conversionStandards: "岗位评级标准",
};

const roleNames: Record<string, string> = {
  ADMIN: "管理员",
  RESOURCE_MANAGER: "资源部管理员",
  LEAD: "组长",
  RECEPTION: "前台接粉",
  GROUP_OPERATOR: "前台炒群",
  EXPERT: "前台专家",
};

function auditFieldValue(field: string, value: unknown): string {
  if (field === "role" && typeof value === "string") return roleNames[value] ?? value;
  if (field === "active" && typeof value === "boolean") return value ? "启用" : "停用";
  if (field === "fanCostMode" && typeof value === "string") return value === "FREE" ? "免费粉" : value === "PAID" ? "付费粉" : value;
  if (field === "effectiveFanPriceCents") {
    if (value === null) return "待定价";
    if (typeof value === "number" && Number.isFinite(value)) return formatEffectiveFanPrice(value) ?? "待定价";
  }
  if ((field === "groupId" || field === "departmentId") && value === null) return "未设置";
  if (value === null || value === undefined || value === "") return "未设置";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "已更新";
}

export const employeeStageNames = {
  TRAINING: "培训",
  OBSERVATION: "观察",
  FORMAL: "正式",
  PAUSED: "暂停评价",
} as const;

export function formatEffectiveFanPrice(effectiveFanPriceCents: number | null): string | null {
  return effectiveFanPriceCents === null ? null : `$${(effectiveFanPriceCents / 100).toFixed(2)} / 有效数据`;
}

const historyMetricNames: Record<string, string> = {
  newFans: "添加数据",
  replies: "回复",
  groupJoin: "入群",
  groupLeave: "退群",
  expertIntro: "推专家",
  registration: "注册",
  order: "开单",
  rechargeCents: "入金",
};

function readSummary(summary: string): Record<string, unknown> {
  try {
    const value = JSON.parse(summary);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readChange(value: unknown): { from: unknown; to: unknown } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const change = value as Record<string, unknown>;
  return "from" in change && "to" in change ? { from: change.from, to: change.to } : null;
}

function dateValue(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function batchValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? `#${value.trim().slice(0, 8)}` : null;
}

function metricValue(value: unknown, field: string): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return field === "rechargeCents" ? `$${(value / 100).toFixed(2)}` : String(value);
}

export function adminMutationSuccessMessage(entity: AdminEntity, mutation: AdminMutation, name: string): string {
  const label = entityNames[entity];
  if (mutation === "create") return `已添加${label}“${name}”`;
  if (mutation === "update") return `已保存${label}“${name}”的修改`;
  if (mutation === "disable") return `已停用${label}“${name}”`;
  if (mutation === "enable") return `已重新启用${label}“${name}”`;
  return `已重置${label}“${name}”的密码`;
}

export function classifyAdminFormError(entity: AdminEntity, message: string): AdminFormError {
  let field: AdminFormField | null = null;
  if (entity === "member") {
    if (/账号.*(?:已存在|不能为空)/.test(message)) field = "username";
    else if (/成员姓名|姓名/.test(message)) field = "name";
    else if (/密码/.test(message)) field = "password";
    else if (/角色/.test(message)) field = "role";
    else if (/小组|分组/.test(message)) field = "groupId";
    else if (/入职日期/.test(message)) field = "hireDate";
    else if (/入职来源/.test(message)) field = "recruitmentSource";
    else if (/介绍人/.test(message)) field = "referrerName";
    else if (/原因/.test(message)) field = "stageOverrideReason";
    else if (/阶段/.test(message)) field = "stageOverride";
  } else if (entity === "group") {
    if (/小组名称|同名小组|小组.*存在/.test(message)) field = "name";
    else if (/下属公司|公司|部门/.test(message)) field = "departmentId";
  } else {
    if (/渠道名称|同名渠道|渠道.*存在/.test(message)) field = "name";
    else if (/所属小组|启用中的小组/.test(message)) field = "groupId";
    else if (/单价|整数分/.test(message)) field = "effectiveFanPriceCents";
  }
  return { message, field };
}

export async function requestAdminMutation(
  url: string,
  body: object,
  method = "POST",
  fetcher: typeof fetch = fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await fetcher(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("网络异常，请检查连接后重试");
  }
  if (response.ok) return;
  let message = "操作失败，请稍后重试";
  try {
    const payload = await response.json() as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) message = payload.error;
  } catch {
    // Keep the Chinese fallback when the server response is not JSON.
  }
  throw new Error(message);
}

export function formatAuditTarget(entityType: string, entityId: string, summary: string): string {
  const label = auditEntityNames[entityType] ?? "其他记录";
  if (entityType === "SystemSetting") return label;
  const value = readSummary(summary);
  if (entityType === "HistoryGroup") {
    const occurredOn = readChange(value.occurredOn);
    const date = dateValue(occurredOn?.from);
    return date ? `${label} · ${date}` : label;
  }
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const phone = typeof value.phone === "string" ? value.phone.trim() : "";
  const groupName = typeof value.groupName === "string" ? value.groupName.trim() : "";
  const groupId = typeof value.groupId === "string" ? value.groupId.trim() : "";
  if (entityType === "Channel" && name && groupName) return `${label} · ${name} · ${groupName}`;
  if (entityType === "Channel" && name && groupId) return `${label} · ${name} · 小组 #${groupId.slice(0, 8)}`;
  if (entityType === "LeadCustomer" && phone) return `${label} · ${phone}`;
  return name ? `${label} · ${name}` : `${label} · #${entityId.slice(0, 8)}`;
}

export function formatAuditSummary(summary: string): string {
  const value = readSummary(summary);
  const highRiskReason = typeof value.highRiskReason === "string" ? value.highRiskReason.trim() : "";
  const appendReason = (text: string) => highRiskReason ? `${text}；操作原因：${highRiskReason}` : text;
  const occurredOn = readChange(value.occurredOn);
  const batchId = readChange(value.batchId);
  const metrics = value.metrics && typeof value.metrics === "object" && !Array.isArray(value.metrics)
    ? value.metrics as Record<string, unknown>
    : {};
  const historyChanges = [
    (() => {
      const from = dateValue(occurredOn?.from); const to = dateValue(occurredOn?.to);
      return from && to ? `发生日期：${from} → ${to}` : null;
    })(),
    (() => {
      const from = batchValue(batchId?.from); const to = batchValue(batchId?.to);
      return from && to ? `来源批次：${from} → ${to}` : null;
    })(),
    ...Object.entries(historyMetricNames).map(([field, name]) => {
      const change = readChange(metrics[field]);
      const from = metricValue(change?.from, field); const to = metricValue(change?.to, field);
      return from && to ? `${name}：${from} → ${to}` : null;
    }),
  ].filter((change): change is string => Boolean(change));
  if (historyChanges.length) return appendReason(`变更：${historyChanges.join("；")}`);
  const fields = Array.isArray(value.changedFields) ? value.changedFields : Array.isArray(value.changedKeys) ? value.changedKeys : [];
  const before = value.before && typeof value.before === "object" && !Array.isArray(value.before) ? value.before as Record<string, unknown> : {};
  const after = value.after && typeof value.after === "object" && !Array.isArray(value.after) ? value.after as Record<string, unknown> : {};
  const readable = fields
    .filter((field): field is string => typeof field === "string" && field !== "currentPassword" && field !== "passwordHash")
    .map((field) => {
      const label = fieldNames[field] ?? field;
      const hasBefore = Object.prototype.hasOwnProperty.call(before, field);
      const hasAfter = Object.prototype.hasOwnProperty.call(after, field);
      if (field !== "password" && hasBefore && hasAfter) {
        return `${label}：${auditFieldValue(field, before[field])} → ${auditFieldValue(field, after[field])}`;
      }
      return label;
    });
  return appendReason(readable.length ? `变更：${readable.join("、")}` : "已完成操作");
}

export function formatAuditTime(createdAt: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(createdAt));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("month")}月${value("day")}日 ${value("hour")}:${value("minute")}`;
}
