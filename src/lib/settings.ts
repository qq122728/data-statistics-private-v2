import { recordAudit } from "./audit";
import { db } from "./db";
import { localDateYYYYMMDD } from "./dates";
import {
  defaultRiskSettings,
  parseRiskSettings,
  riskSettingKeys,
  toRiskSettingEntries,
  type RiskSettings,
} from "./risk-settings";
import { API_LIMITS } from "./request-limits";

const settingKeys = [
  "appName",
  "timezone",
  "defaultReportMode",
  "allowMemberChannelCreation",
] as const;

type SettingKey = (typeof settingKeys)[number];
export type SystemSettings = {
  appName: string;
  timezone: string;
  defaultReportMode: "cumulative" | "incremental";
  allowMemberChannelCreation: boolean;
};

export type ParsedSystemSettings =
  | { success: true; data: SystemSettings }
  | { success: false; error: string };

export type ReportViewValues = Record<string, string | undefined> & {
  mode: "cumulative" | "incremental";
  occurredDateFrom?: string;
  occurredDateTo?: string;
};

const defaultSettings: SystemSettings = {
  appName: "数据统计",
  timezone: "Asia/Shanghai",
  defaultReportMode: "cumulative",
  allowMemberChannelCreation: false,
};

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}

function isSupportedTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function readStoredSettings(settings: Array<{ key: string; value: string }>): SystemSettings {
  const values = new Map(settings.map((setting) => [setting.key as SettingKey, setting.value]));

  return {
    appName: values.get("appName") || defaultSettings.appName,
    timezone: values.get("timezone") || defaultSettings.timezone,
    defaultReportMode: values.get("defaultReportMode") === "incremental" ? "incremental" : defaultSettings.defaultReportMode,
    // 渠道目录属于管理配置，一线成员永远不能自行创建。旧设置只保留兼容读取。
    allowMemberChannelCreation: false,
  };
}

export function parseSystemSettings(input: unknown): ParsedSystemSettings {
  const values = isRecord(input) ? input : {};

  if (values.defaultReportMode !== "cumulative" && values.defaultReportMode !== "incremental") {
    return { success: false, error: "默认报表模式不正确" };
  }
  if (typeof values.appName !== "string" || !values.appName.trim() || values.appName.trim().length > API_LIMITS.accountDisplayNameCharacters) {
    return { success: false, error: "系统名称必须在 1 到 100 个字之间" };
  }
  if (typeof values.timezone !== "string" || values.timezone.length > 100 || !isSupportedTimezone(values.timezone)) {
    return { success: false, error: "时区不正确" };
  }
  if (typeof values.allowMemberChannelCreation !== "boolean") {
    return { success: false, error: "成员创建渠道设置不正确" };
  }

  return {
    success: true,
    data: {
      appName: values.appName.trim(),
      timezone: values.timezone,
      defaultReportMode: values.defaultReportMode,
      allowMemberChannelCreation: values.allowMemberChannelCreation,
    },
  };
}

export async function getSystemSettings(): Promise<SystemSettings> {
  const settings = await db.systemSetting.findMany({
    where: { key: { in: [...settingKeys] } },
  });
  return readStoredSettings(settings);
}

export async function updateSystemSettings(input: unknown, actorId: string): Promise<SystemSettings> {
  const parsed = parseSystemSettings(input);
  if (!parsed.success) {
    throw new Error(parsed.error);
  }

  const settings = parsed.data;
  await db.$transaction(async (client) => {
    const existing = await client.systemSetting.findMany({
      where: { key: { in: [...settingKeys] } },
    });
    const previous = readStoredSettings(existing);
    const changedKeys = settingKeys.filter((key) => previous[key] !== settings[key]);

    await Promise.all([
      client.systemSetting.upsert({ where: { key: "appName" }, update: { value: settings.appName, updatedById: actorId }, create: { key: "appName", value: settings.appName, updatedById: actorId } }),
      client.systemSetting.upsert({ where: { key: "timezone" }, update: { value: settings.timezone, updatedById: actorId }, create: { key: "timezone", value: settings.timezone, updatedById: actorId } }),
      client.systemSetting.upsert({ where: { key: "defaultReportMode" }, update: { value: settings.defaultReportMode, updatedById: actorId }, create: { key: "defaultReportMode", value: settings.defaultReportMode, updatedById: actorId } }),
      client.systemSetting.upsert({ where: { key: "allowMemberChannelCreation" }, update: { value: String(settings.allowMemberChannelCreation), updatedById: actorId }, create: { key: "allowMemberChannelCreation", value: String(settings.allowMemberChannelCreation), updatedById: actorId } }),
    ]);
    await recordAudit(client, {
      actorId,
      action: "SYSTEM_SETTINGS_UPDATED",
      entityType: "SystemSetting",
      entityId: "system",
      summary: { changedKeys },
    });
  });

  return settings;
}

export async function getRiskSettings(): Promise<RiskSettings> {
  const settings = await db.systemSetting.findMany({
    where: { key: { in: [...riskSettingKeys] } },
  });
  return parseRiskSettings(settings);
}

export async function updateRiskSettings(settings: RiskSettings, actorId: string): Promise<RiskSettings> {
  const entries = toRiskSettingEntries(settings);

  await db.$transaction(async (client) => {
    const existing = await client.systemSetting.findMany({
      where: { key: { in: [...riskSettingKeys] } },
    });
    const previous = parseRiskSettings(existing);
    const changedKeys = (Object.keys(defaultRiskSettings) as Array<keyof RiskSettings>)
      .filter((key) => previous[key] !== settings[key]);

    await Promise.all(entries.map(({ key, value }) => client.systemSetting.upsert({
      where: { key },
      update: { value, updatedById: actorId },
      create: { key, value, updatedById: actorId },
    })));
    await recordAudit(client, {
      actorId,
      action: "RISK_SETTINGS_UPDATED",
      entityType: "SystemSetting",
      entityId: "risk",
      summary: { changedKeys, before: previous, after: settings },
    });
  });

  return settings;
}

export function resolveReportView(
  values: Record<string, string | undefined>,
  settings: Pick<SystemSettings, "defaultReportMode" | "timezone">,
  now = new Date(),
): ReportViewValues {
  const { occurredDateFrom, occurredDateTo, ...rest } = values;
  const explicitMode = values.mode === "cumulative" || values.mode === "incremental" ? values.mode : undefined;
  const hasOccurrenceRange = Boolean(occurredDateFrom || occurredDateTo);
  const mode = explicitMode ?? (hasOccurrenceRange ? "incremental" : settings.defaultReportMode);

  if (mode === "cumulative") return { ...rest, mode };

  const today = localDateYYYYMMDD(now, settings.timezone);
  return {
    ...rest,
    mode,
    occurredDateFrom: occurredDateFrom || today,
    occurredDateTo: occurredDateTo || today,
  };
}
