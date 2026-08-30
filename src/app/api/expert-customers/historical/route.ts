import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { normalizeChannelName } from "../../../../lib/channel-names";
import { db } from "../../../../lib/db";
import { entryDateError } from "../../../../lib/entry-date-validation";
import { normalizeCustomerPhone } from "../../../../lib/entry-ledger";
import { isCalendarDate, localDateYYYYMMDD } from "../../../../lib/dates";
import { getSystemSettings } from "../../../../lib/settings";
import { resolveUserBusinessTimezone } from "../../../../lib/business-time";
import { hasAssignedRole } from "../../../../lib/role-access";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";

const date = z.string().refine(isCalendarDate, "日期必须是实际存在的 YYYY-MM-DD");
const optionalDate = z.preprocess((value) => typeof value === "string" && !value.trim() ? undefined : value, date.optional());
const stage = z.enum(["QUEUED", "MATERIALS", "TRACKING", "PENDING_REGISTRATION", "PENDING_ORDER", "DECLINED_DEPOSIT", "ORDERED", "STALLED"]);
const money = z.coerce.number().int().positive("首充金额必须大于 0").max(2_147_483_647);

const inputSchema = z.object({
  phone: z.string().trim().min(1, "请输入客户号码").max(80, "客户号码不能超过 80 个字"),
  customerName: z.string().trim().max(100, "客户姓名不能超过 100 个字").optional(),
  historicalSourceName: z.string().trim().max(100, "历史来源不能超过 100 个字").optional(),
  receptionOwnerId: z.string().min(1, "请选择接粉归属").max(API_LIMITS.identifierCharacters),
  groupOperatorOwnerId: z.string().min(1, "请选择炒群归属").max(API_LIMITS.identifierCharacters),
  expertOwnerId: z.string().min(1).max(API_LIMITS.identifierCharacters).optional(),
  contactedOn: date,
  joinedOn: date,
  expertIntroducedOn: date,
  expertStage: stage,
  stageChangedOn: date,
  registeredOn: optionalDate,
  openedOn: optionalDate,
  initialDepositCents: money.optional(),
  initialDepositMethod: z.enum(["CRYPTO", "BANK"]).optional(),
  stalledReason: z.string().trim().max(100, "杀不动原因不能超过 100 个字").optional(),
  notes: z.string().trim().max(1_000, "备注不能超过 1,000 个字").optional(),
}).superRefine((value, context) => {
  if (value.joinedOn < value.contactedOn)
    context.addIssue({ code: "custom", path: ["joinedOn"], message: "入群日期不能早于接粉日期" });
  if (value.expertIntroducedOn < value.joinedOn)
    context.addIssue({ code: "custom", path: ["expertIntroducedOn"], message: "推专家日期不能早于入群日期" });
  if (value.stageChangedOn < value.expertIntroducedOn)
    context.addIssue({ code: "custom", path: ["stageChangedOn"], message: "阶段更新日期不能早于推专家日期" });
  const needsRegistration = ["PENDING_ORDER", "DECLINED_DEPOSIT", "ORDERED"].includes(value.expertStage);
  if (needsRegistration && !value.registeredOn)
    context.addIssue({ code: "custom", path: ["registeredOn"], message: "该阶段请填写真实注册日期" });
  if (value.registeredOn && value.registeredOn < value.expertIntroducedOn)
    context.addIssue({ code: "custom", path: ["registeredOn"], message: "注册日期不能早于推专家日期" });
  if (value.expertStage === "ORDERED" && (!value.openedOn || !value.initialDepositCents || !value.initialDepositMethod))
    context.addIssue({ code: "custom", path: ["openedOn"], message: "已开单必须填写真实开单日期和首充金额" });
  if (value.expertStage !== "ORDERED" && (value.openedOn || value.initialDepositCents || value.initialDepositMethod))
    context.addIssue({ code: "custom", path: ["openedOn"], message: "只有“已开单”才需要填写首充资料" });
  if (value.openedOn && value.registeredOn && value.openedOn < value.registeredOn)
    context.addIssue({ code: "custom", path: ["openedOn"], message: "开单日期不能早于注册日期" });
  if (value.expertStage === "STALLED" && !value.stalledReason)
    context.addIssue({ code: "custom", path: ["stalledReason"], message: "杀不动客户请填写原因" });
});

const HISTORICAL_EXPERT_CHANNEL_NAME = "专家历史补录（系统）";

/** 专家或组长统一补录旧客户；只写入后续开单与资金统计。 */
export async function POST(request: Request) {
  let sessionUser;
  try { sessionUser = await requireUser(); }
  catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  if (!hasAssignedRole(sessionUser, "LEAD") && !hasAssignedRole(sessionUser, "EXPERT"))
    return authorizationDenied(sessionUser, "只有组长或专家可以补录历史专家客户");
  if (!sessionUser.groupId)
    return authorizationDenied(sessionUser, "当前账号未绑定小组，不能补录客户");

  try {
    const rawInput = await request.json();
    if (rawInput && typeof rawInput === "object" && (
      (rawInput as { expertStage?: unknown }).expertStage === "ORDERED"
      || Boolean((rawInput as { openedOn?: unknown }).openedOn)
      || Boolean((rawInput as { initialDepositCents?: unknown }).initialDepositCents)
      || Boolean((rawInput as { initialDepositMethod?: unknown }).initialDepositMethod)
    )) return NextResponse.json({ error: "历史已开单和历史资金补录入口已关闭；请只记录客户当前进度，统计数字在“每日数据填写”中单独填写" }, { status: 410 });
    const input = inputSchema.parse(rawInput);
    const phone = normalizeCustomerPhone(input.phone);
    const settings = await getSystemSettings();
    const timezone = await resolveUserBusinessTimezone(sessionUser, settings.timezone);
    const today = localDateYYYYMMDD(new Date(), timezone);
    for (const [label, value] of [
      ["接粉日期", input.contactedOn], ["入群日期", input.joinedOn], ["推专家日期", input.expertIntroducedOn],
      ["阶段更新日期", input.stageChangedOn], ["注册日期", input.registeredOn], ["开单日期", input.openedOn],
    ] as const) {
      if (!value) continue;
      const error = entryDateError(value, today, label);
      if (error) return NextResponse.json({ error }, { status: 400 });
    }

    const result = await db.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: sessionUser.id },
        select: { id: true, active: true, groupId: true, role: true, roleAssignments: { select: { role: true } } },
      });
      if (!actor?.active || !actor.groupId || (!hasAssignedRole(actor, "LEAD") && !hasAssignedRole(actor, "EXPERT")))
        return { status: 403 as const, error: "当前账号没有补录历史专家客户权限" };

      // 录入人可以由专家本人或组长担任；两者都可把客户归给本组任一在职专家。
      // 归属人与录入人分开保存，后续由被指定专家继续处理。
      const expertOwnerId = input.expertOwnerId || actor.id;
      const [reception, groupOperator, expert, duplicate] = await Promise.all([
        tx.user.findUnique({ where: { id: input.receptionOwnerId }, select: { id: true, active: true, groupId: true, role: true, roleAssignments: { select: { role: true } } } }),
        tx.user.findUnique({ where: { id: input.groupOperatorOwnerId }, select: { id: true, active: true, groupId: true, role: true, roleAssignments: { select: { role: true } } } }),
        tx.user.findUnique({ where: { id: expertOwnerId }, select: { id: true, active: true, groupId: true, role: true, roleAssignments: { select: { role: true } } } }),
        tx.leadCustomer.findUnique({ where: { phone }, select: { batch: { select: { groupId: true } } } }),
      ]);
      if (duplicate) {
        if (duplicate.batch.groupId !== actor.groupId)
          return { status: 409 as const, error: "该手机号已存在" };
        const inGroupDuplicate = await tx.leadCustomer.findUniqueOrThrow({
          where: { phone },
          select: { id: true, customerName: true },
        });
        return { status: 409 as const, error: `该号码已在本组客户库中：${inGroupDuplicate.customerName || inGroupDuplicate.id}。请打开原客户补资料，不要重复导入。` };
      }
      // 这是历史归属，不用今天的岗位或在职状态倒推过去。只限制在同一个小组，避免跨组串数据。
      if (!reception || reception.groupId !== actor.groupId)
        return { status: 400 as const, error: "历史接粉归属只能选择本组成员" };
      if (!groupOperator || groupOperator.groupId !== actor.groupId)
        return { status: 400 as const, error: "历史炒群归属只能选择本组成员" };
      if (!expert?.active || expert.groupId !== actor.groupId || (!hasAssignedRole(expert, "EXPERT") && expert.id !== actor.id))
        return { status: 400 as const, error: "专家归属只能选择本组在职专家；组长可选择本人代专家跟进" };

      const channelId = `historical-expert-manual-${actor.groupId}`;
      const channel = await tx.channel.upsert({
        where: { id_groupId: { id: channelId, groupId: actor.groupId } },
        update: {},
        create: { id: channelId, groupId: actor.groupId, name: HISTORICAL_EXPERT_CHANNEL_NAME, normalizedName: normalizeChannelName(HISTORICAL_EXPERT_CHANNEL_NAME), createdById: actor.id, channelType: "SMS" },
      });
      const batch = await tx.sourceBatch.upsert({
        where: { groupId_channelId_sourceDate: { groupId: actor.groupId, channelId: channel.id, sourceDate: input.contactedOn } },
        update: { isHistoricalRecord: true },
        create: { groupId: actor.groupId, channelId: channel.id, sourceDate: input.contactedOn, channelTypeSnapshot: "SMS", isHistoricalRecord: true },
      });
      const isContacted = input.expertStage !== "QUEUED";
      const isTracking = input.expertStage === "TRACKING";
      const isRegistered = ["PENDING_ORDER", "DECLINED_DEPOSIT", "ORDERED"].includes(input.expertStage);
      const lead = await tx.leadCustomer.create({
        data: {
          phone,
          batchId: batch.id,
          ownerId: reception.id,
          attributionOwnerId: reception.id,
          groupOperatorOwnerId: groupOperator.id,
          expertOwnerId: expert.id,
          customerName: input.customerName || null,
          historicalSourceName: input.historicalSourceName || "专家历史补录",
          isHistoricalRecord: true,
          notes: input.notes || null,
          replyStatus: "REPLIED",
          repliedOn: input.contactedOn,
          groupStatus: "JOINED",
          joinedOn: input.joinedOn,
          expertIntroducedOn: input.expertIntroducedOn,
          expertContactedOn: isContacted ? input.stageChangedOn : null,
          expertWorkflowStage: input.expertStage,
          expertStageChangedAt: new Date(`${input.stageChangedOn}T12:00:00.000Z`),
          expertTrackingStartedAt: isTracking ? new Date(`${input.stageChangedOn}T12:00:00.000Z`) : null,
          registeredOn: isRegistered ? input.registeredOn : null,
          noInitialDepositOn: input.expertStage === "DECLINED_DEPOSIT" ? input.stageChangedOn : null,
          noInitialDepositReason: input.expertStage === "DECLINED_DEPOSIT" ? "历史补录" : null,
          expertStalledOn: input.expertStage === "STALLED" ? input.stageChangedOn : null,
          expertStalledReason: input.expertStage === "STALLED" ? input.stalledReason : null,
          expertStalledNote: input.expertStage === "STALLED" ? input.notes || null : null,
        },
      });
      let orderId: string | null = null;
      if (input.expertStage === "ORDERED" && input.openedOn && input.initialDepositCents && input.initialDepositMethod) {
        const order = await tx.customerOrder.create({ data: { phone, batchId: batch.id, leadId: lead.id, enteredById: actor.id, openedOn: input.openedOn, initialDepositCents: input.initialDepositCents, initialDepositMethod: input.initialDepositMethod } });
        orderId = order.id;
      }
      await recordAudit(tx, {
        actorId: actor.id,
        action: "HISTORICAL_EXPERT_CUSTOMER_CREATED",
        entityType: "LeadCustomer",
        entityId: lead.id,
        summary: { phone, expertStage: input.expertStage, receptionOwnerId: reception.id, groupOperatorOwnerId: groupOperator.id, expertOwnerId: expert.id, orderId, excludedFromAcquisitionMetrics: true },
      });
      return { status: 201 as const, leadId: lead.id, orderId };
    }, { isolationLevel: "Serializable" });
    if (result.status === 403) return authorizationDenied(sessionUser, result.error);
    if (result.status !== 201) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "请检查填写内容" }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return NextResponse.json({ error: "该号码刚刚被其他人录入，请刷新后打开原客户补资料。" }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 400 });
  }
}
