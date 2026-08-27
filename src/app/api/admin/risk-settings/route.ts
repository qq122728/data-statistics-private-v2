import { NextResponse } from "next/server";
import { defaultRiskSettings, hasBasisPointPrecision, type RiskSettings } from "../../../../lib/risk-settings";
import { getRiskSettings, updateRiskSettings } from "../../../../lib/settings";
import { requireAdminRequest } from "../_auth";

type ParsedRiskSettings = { success: true; data: RiskSettings } | { success: false; error: string };

const fields = Object.keys(defaultRiskSettings) as Array<keyof RiskSettings>;
const efficiencyFields = ["coachingEfficiency", "limitEfficiency", "eliminationEfficiency"] as const;
const consecutiveDayFields = ["coachingDays", "limitDays", "eliminationDays"] as const;
const sampleFields = [
  "replyMinNewFans",
  "groupMinNewFans",
  "leaveMinGroupJoin",
  "expertMinGroupJoin",
  "registrationMinExpert",
  "orderMinNewFans",
  "efficiencyMinEffectiveFans",
  "priceComparisonMinOrders",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseRiskSettings(input: unknown): ParsedRiskSettings {
  if (!isRecord(input) || Object.keys(input).length !== fields.length || !fields.every((field) => Object.hasOwn(input, field))) {
    return { success: false, error: "请完整提交全部预警规则" };
  }
  if (!fields.every((field) => typeof input[field] === "number" && Number.isFinite(input[field]))) {
    return { success: false, error: "预警规则必须填写有效数字" };
  }

  const data = input as RiskSettings;
  if (!Number.isSafeInteger(data.trainingDays) || data.trainingDays <= 0
    || !Number.isSafeInteger(data.observationDays) || data.observationDays <= data.trainingDays) {
    return { success: false, error: "培训期和观察期必须是递增的正整数天" };
  }
  if (!efficiencyFields.every((field) => data[field] >= 0 && data[field] <= 1)) {
    return { success: false, error: "效率阈值必须在 0 到 1 之间" };
  }
  if (!efficiencyFields.every((field) => hasBasisPointPrecision(data[field]))) {
    return { success: false, error: "效率阈值最多保留 4 位小数" };
  }
  if (!consecutiveDayFields.every((field) => Number.isSafeInteger(data[field]) && data[field] > 0)) {
    return { success: false, error: "连续偏低天数必须是正整数" };
  }
  if (!sampleFields.every((field) => Number.isSafeInteger(data[field]) && data[field] >= 0)) {
    return { success: false, error: "样本门槛必须是非负整数" };
  }
  return { success: true, data };
}

export async function GET() {
  const access = await requireAdminRequest();
  if ("response" in access) return access.response;
  return NextResponse.json(await getRiskSettings());
}

export async function PATCH(request: Request) {
  const access = await requireAdminRequest();
  if ("response" in access) return access.response;
  try {
    const parsed = parseRiskSettings(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });
    return NextResponse.json(await updateRiskSettings(parsed.data, access.actor.id));
  } catch {
    return NextResponse.json({ error: "设置参数不正确" }, { status: 400 });
  }
}
