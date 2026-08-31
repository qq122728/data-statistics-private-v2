import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { resolveUserBusinessTimezone } from "../../../../lib/business-time";
import { db } from "../../../../lib/db";
import { isCalendarDate, localDateYYYYMMDD } from "../../../../lib/dates";
import { isFrontlineGroupMember } from "../../../../lib/role-access";
import { authorizationDenied } from "../../../../lib/security-events";
import { getSystemSettings } from "../../../../lib/settings";

const dateValue = z.string().trim().max(10).refine((value) => !value || isCalendarDate(value), "日期必须是实际存在的 YYYY-MM-DD");
const bodySchema = z.object({
  joinedOn: dateValue.optional(),
  phone: z.string().trim().max(80, "客户号码不能超过 80 个字").optional(),
  attributionMemberName: z.string().trim().max(80).optional(),
  sourceChannelName: z.string().trim().max(80).optional(),
  groupOperatorName: z.string().trim().max(80).optional(),
  deviceCode: z.string().trim().max(80).optional(),
  groupSituation: z.string().trim().max(500).optional(),
  leaveType: z.string().trim().max(80).optional(),
  expertName: z.string().trim().max(80).optional(),
  expertSituation: z.string().trim().max(500).optional(),
  registeredOn: dateValue.optional(),
  initialDeposit: z.string().trim().max(30).optional(),
  recharge: z.string().trim().max(30).optional(),
  withdrawal: z.string().trim().max(30).optional(),
}).refine((value) => Object.keys(value).length > 0, "没有需要保存的字段");

function moneyToCents(value: string, label: string): number {
  const normalized = value.replace(/[$,\s]/g, "");
  if (!normalized) return 0;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error(`${label}请输入正确金额，最多两位小数`);
  const [whole, decimal = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 2_147_483_647) throw new Error(`${label}金额过大`);
  return cents;
}

function serialize(row: {
  id: string; joinedOn: string | null; phone: string; attributionMemberName: string; sourceChannelName: string;
  groupOperatorName: string; deviceCode: string; groupSituation: string; leaveType: string; leftOn: string | null;
  expertName: string; expertSituation: string; registeredOn: string | null; initialDepositCents: number;
  rechargeCents: number; withdrawalCents: number; updatedAt: Date;
}) {
  return {
    ...row,
    initialDeposit: (row.initialDepositCents / 100).toFixed(2),
    recharge: (row.rechargeCents / 100).toFixed(2),
    withdrawal: (row.withdrawalCents / 100).toFixed(2),
    netPerformanceCents: row.initialDepositCents + row.rechargeCents - row.withdrawalCents,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function PATCH(request: Request, context: { params: Promise<{ rowId: string }> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  if (!actor.active || !actor.groupId || !isFrontlineGroupMember(actor))
    return authorizationDenied(actor, "当前账号不能编辑老客户导入表");

  try {
    const { rowId } = await context.params;
    const input = bodySchema.parse(await request.json());
    const existing = await db.legacyCustomerRow.findFirst({ where: { id: rowId, groupId: actor.groupId } });
    if (!existing) return NextResponse.json({ error: "这行老客户记录不存在" }, { status: 404 });

    const settings = input.leaveType !== undefined && input.leaveType && !existing.leaveType
      ? await getSystemSettings()
      : null;
    const today = settings
      ? localDateYYYYMMDD(new Date(), await resolveUserBusinessTimezone(actor, settings.timezone))
      : null;
    const data = {
      ...(input.joinedOn !== undefined ? { joinedOn: input.joinedOn || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.attributionMemberName !== undefined ? { attributionMemberName: input.attributionMemberName } : {}),
      ...(input.sourceChannelName !== undefined ? { sourceChannelName: input.sourceChannelName } : {}),
      ...(input.groupOperatorName !== undefined ? { groupOperatorName: input.groupOperatorName } : {}),
      ...(input.deviceCode !== undefined ? { deviceCode: input.deviceCode } : {}),
      ...(input.groupSituation !== undefined ? { groupSituation: input.groupSituation } : {}),
      ...(input.leaveType !== undefined ? { leaveType: input.leaveType, leftOn: input.leaveType ? (existing.leftOn ?? today) : null } : {}),
      ...(input.expertName !== undefined ? { expertName: input.expertName } : {}),
      ...(input.expertSituation !== undefined ? { expertSituation: input.expertSituation } : {}),
      ...(input.registeredOn !== undefined ? { registeredOn: input.registeredOn || null } : {}),
      ...(input.initialDeposit !== undefined ? { initialDepositCents: moneyToCents(input.initialDeposit, "首充") } : {}),
      ...(input.recharge !== undefined ? { rechargeCents: moneyToCents(input.recharge, "续充") } : {}),
      ...(input.withdrawal !== undefined ? { withdrawalCents: moneyToCents(input.withdrawal, "出金") } : {}),
      updatedById: actor.id,
    };
    const row = await db.$transaction(async (tx) => {
      const updated = await tx.legacyCustomerRow.update({ where: { id: rowId }, data });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "LEGACY_CUSTOMER_ROW_UPDATED",
        entityType: "LegacyCustomerRow",
        entityId: rowId,
        summary: { fields: Object.keys(input) },
      });
      return updated;
    });
    return NextResponse.json({ row: serialize(row) });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "请检查填写内容" }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 400 });
  }
}
