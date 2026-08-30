import type { DailyStatEntry, Position, Prisma } from "@prisma/client";
import { z } from "zod";
import { localDateYYYYMMDD } from "./dates";
import { getAssignedRoles } from "./role-access";

const nonNegativeInt = z.number().int().min(0).max(2_147_483_647).default(0);
const optionalId = z.string().trim().min(1).nullable().optional();

export const dailyStatValuesSchema = z.object({
  dispatchCount: nonNegativeInt,
  duplicateCount: nonNegativeInt,
  lowAmountCount: nonNegativeInt,
  noWsCount: nonNegativeInt,
  replyCount: nonNegativeInt,
  joinCount: nonNegativeInt,
  operatorReceivedCount: nonNegativeInt,
  normalLeaveCount: nonNegativeInt,
  abnormalLeaveCount: nonNegativeInt,
  currentInGroupCount: nonNegativeInt,
  expertIntroCount: nonNegativeInt,
  expertReceivedCount: nonNegativeInt,
  expertContactedCount: nonNegativeInt,
  registrationCount: nonNegativeInt,
  orderCount: nonNegativeInt,
  cryptoInitialDepositCents: nonNegativeInt,
  bankInitialDepositCents: nonNegativeInt,
  cryptoRechargeCents: nonNegativeInt,
  bankRechargeCents: nonNegativeInt,
  withdrawalCents: nonNegativeInt,
});

export const saveDailyStatSchema = z.object({
  entryId: z.string().trim().min(1).optional(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式不正确"),
  position: z.enum(["RECEPTION", "GROUP_OPERATOR", "EXPERT"]),
  channelId: z.string().trim().min(1, "请选择渠道"),
  sourceReceptionId: optionalId,
  sourceGroupOperatorId: optionalId,
  changeReason: z.string().trim().max(500).nullable().optional(),
  values: dailyStatValuesSchema,
});

export type SaveDailyStatInput = z.infer<typeof saveDailyStatSchema>;

type DailyStatActor = {
  id: string;
  active: boolean;
  role: Parameters<typeof getAssignedRoles>[0]["role"];
  groupId: string | null;
  roleAssignments?: Array<{ role: Parameters<typeof getAssignedRoles>[0]["role"] }>;
};

export class DailyStatError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function entryIdentity(input: {
  ownerId: string;
  groupId: string;
  businessDate: string;
  position: Position;
  channelId: string;
  sourceReceptionId: string | null;
  sourceGroupOperatorId: string | null;
}) {
  return JSON.stringify([
    input.ownerId,
    input.groupId,
    input.businessDate,
    input.position,
    input.channelId,
    input.sourceReceptionId,
    input.sourceGroupOperatorId,
  ]);
}

function normalizeSources(input: SaveDailyStatInput) {
  if (input.position === "RECEPTION") {
    return { sourceReceptionId: null, sourceGroupOperatorId: null };
  }
  if (!input.sourceReceptionId) throw new DailyStatError("炒群和专家数据必须选择来源接粉");
  if (input.position === "GROUP_OPERATOR") {
    return { sourceReceptionId: input.sourceReceptionId, sourceGroupOperatorId: null };
  }
  if (!input.sourceGroupOperatorId) throw new DailyStatError("专家数据必须选择来源炒群");
  return {
    sourceReceptionId: input.sourceReceptionId,
    sourceGroupOperatorId: input.sourceGroupOperatorId,
  };
}

function revisionValues(input: SaveDailyStatInput) {
  const all = input.values;
  if (input.position === "RECEPTION") {
    const effectiveCount = all.dispatchCount - all.duplicateCount - all.lowAmountCount - all.noWsCount;
    if (effectiveCount < 0) throw new DailyStatError("撞粉、低金额与无 WhatsApp 数量之和不能超过总下发粉数量");
    return {
      dispatchCount: all.dispatchCount,
      duplicateCount: all.duplicateCount,
      lowAmountCount: all.lowAmountCount,
      noWsCount: all.noWsCount,
      effectiveCount,
      replyCount: all.replyCount,
      joinCount: all.joinCount,
    };
  }
  if (input.position === "GROUP_OPERATOR") {
    return {
      operatorReceivedCount: all.operatorReceivedCount,
      normalLeaveCount: all.normalLeaveCount,
      abnormalLeaveCount: all.abnormalLeaveCount,
      currentInGroupCount: all.currentInGroupCount,
      expertIntroCount: all.expertIntroCount,
    };
  }
  return {
    expertReceivedCount: all.expertReceivedCount,
    expertContactedCount: all.expertContactedCount,
    registrationCount: all.registrationCount,
    orderCount: all.orderCount,
    cryptoInitialDepositCents: all.cryptoInitialDepositCents,
    bankInitialDepositCents: all.bankInitialDepositCents,
    cryptoRechargeCents: all.cryptoRechargeCents,
    bankRechargeCents: all.bankRechargeCents,
    withdrawalCents: all.withdrawalCents,
  };
}

async function validateSourcePerson(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    groupId: string;
    position: Position;
    businessDate: string;
    label: string;
    allowAnyGroupRole?: boolean;
  },
) {
  const person = await tx.user.findFirst({
    where: {
      id: input.userId,
      OR: input.allowAnyGroupRole ? [
        { groupId: input.groupId },
        { positionHistory: { some: { groupId: input.groupId } } },
      ] : [
        {
          groupId: input.groupId,
          OR: [
            { role: input.position },
            { roleAssignments: { some: { role: input.position } } },
            ...(input.position === "EXPERT" ? [{ role: "LEAD" as const }] : []),
          ],
        },
        {
          positionHistory: {
            some: {
              groupId: input.groupId,
              effectiveFrom: { lte: input.businessDate },
              AND: [
                {
                  OR: [
                    { effectiveTo: null },
                    { effectiveTo: { gte: input.businessDate } },
                  ],
                },
                {
                  OR: [
                    { position: input.position },
                    { secondaryPositions: { contains: input.position } },
                  ],
                },
              ],
            },
          },
        },
      ],
    },
    select: { id: true },
  });
  if (!person) {
    throw new DailyStatError(input.allowAnyGroupRole
      ? `${input.label}不属于该小组的现任或历史成员`
      : `${input.label}不属于该小组，或在所选日期没有对应岗位`);
  }
}

export async function saveDailyStat(
  tx: Prisma.TransactionClient,
  actor: DailyStatActor,
  rawInput: unknown,
) {
  if (!actor.active || !actor.groupId) throw new DailyStatError("当前账号未分配到可用小组", 403);
  const input = saveDailyStatSchema.parse(rawInput);
  if (!getAssignedRoles(actor).includes(input.position)) throw new DailyStatError("当前账号没有所选岗位权限", 403);

  const group = await tx.teamGroup.findUnique({
    where: { id: actor.groupId },
    select: { id: true, active: true, department: { select: { timezone: true } } },
  });
  if (!group?.active) throw new DailyStatError("当前小组不可用", 403);
  const timezone = group.department?.timezone || "Asia/Shanghai";
  if (input.businessDate > localDateYYYYMMDD(new Date(), timezone)) throw new DailyStatError("不能填写当地时间未来日期的数据");

  const channel = await tx.channel.findFirst({
    where: { id: input.channelId, groupId: actor.groupId, active: true },
    select: { id: true },
  });
  if (!channel) throw new DailyStatError("渠道不存在或已停用");

  const sources = normalizeSources(input);
  if (sources.sourceReceptionId) {
    await validateSourcePerson(tx, {
      userId: sources.sourceReceptionId,
      groupId: actor.groupId,
      position: "RECEPTION",
      businessDate: input.businessDate,
      label: "来源接粉",
      allowAnyGroupRole: input.position === "EXPERT",
    });
  }
  if (sources.sourceGroupOperatorId) {
    await validateSourcePerson(tx, {
      userId: sources.sourceGroupOperatorId,
      groupId: actor.groupId,
      position: "GROUP_OPERATOR",
      businessDate: input.businessDate,
      label: "来源炒群",
      allowAnyGroupRole: true,
    });
  }

  const identityKey = entryIdentity({
    ownerId: actor.id,
    groupId: actor.groupId,
    businessDate: input.businessDate,
    position: input.position,
    channelId: input.channelId,
    ...sources,
  });
  const existing = input.entryId
    ? await tx.dailyStatEntry.findUnique({ where: { id: input.entryId }, include: { revisions: { orderBy: { version: "desc" }, take: 1 } } })
    : await tx.dailyStatEntry.findUnique({ where: { identityKey }, include: { revisions: { orderBy: { version: "desc" }, take: 1 } } });
  if (existing && (existing.ownerId !== actor.id || existing.identityKey !== identityKey)) {
    throw new DailyStatError("不能修改其他员工或其他来源线的数据", 403);
  }
  if (existing && ["PENDING", "CORRECTION_PENDING"].includes(existing.status)) {
    throw new DailyStatError("这条数据正在等待审核，请先撤回再修改", 409);
  }
  if (existing?.status === "APPROVED" && !input.changeReason) {
    throw new DailyStatError("已审核数据必须填写更正原因", 400);
  }

  const values = revisionValues(input);
  let entry: DailyStatEntry;
  if (!existing) {
    entry = await tx.dailyStatEntry.create({
      data: {
        identityKey,
        ownerId: actor.id,
        groupId: actor.groupId,
        channelId: input.channelId,
        businessDate: input.businessDate,
        timezone,
        position: input.position,
        ...sources,
      },
    });
  } else {
    entry = existing;
  }
  const version = (existing?.revisions[0]?.version ?? 0) + 1;
  const revision = await tx.dailyStatRevision.create({
    data: {
      entryId: entry.id,
      version,
      createdById: actor.id,
      // 首次审核或资源部退回后，员工通常只需要按退回意见改数字。
      // 把退回原因带进新版本，避免重新提交后页面又误写成“首次填写”。
      changeReason: input.changeReason || existing?.reviewReason || null,
      ...values,
    },
  });
  const nextStatus = existing?.approvedRevisionId ? "DRAFT" : existing?.status === "RETURNED" ? "DRAFT" : entry.status;
  return tx.dailyStatEntry.update({
    where: { id: entry.id },
    data: {
      currentRevisionId: revision.id,
      status: nextStatus,
      reviewReason: null,
      reviewedAt: null,
      reviewedById: null,
    },
    include: dailyStatEntryInclude,
  });
}

export const dailyStatEntryInclude = {
  owner: { select: { id: true, name: true, active: true } },
  group: { select: { id: true, name: true } },
  channel: { select: { id: true, name: true } },
  sourceReception: { select: { id: true, name: true, active: true } },
  sourceGroupOperator: { select: { id: true, name: true, active: true } },
  reviewedBy: { select: { id: true, name: true } },
  currentRevision: true,
  approvedRevision: true,
} satisfies Prisma.DailyStatEntryInclude;

export type DailyStatWithDetails = Prisma.DailyStatEntryGetPayload<{ include: typeof dailyStatEntryInclude }>;

export function publicDailyStat(entry: DailyStatWithDetails) {
  return {
    ...entry,
    officialRevision: entry.approvedRevision,
  };
}

export async function transitionDailyStat(
  tx: Prisma.TransactionClient,
  actor: DailyStatActor,
  input: { entryId: string; action: "SUBMIT" | "WITHDRAW" },
) {
  const entry = await tx.dailyStatEntry.findUnique({ where: { id: input.entryId }, include: dailyStatEntryInclude });
  if (!entry || entry.ownerId !== actor.id) throw new DailyStatError("每日数据不存在", 404);
  if (!entry.currentRevisionId) throw new DailyStatError("请先保存数据");
  if (input.action === "SUBMIT") {
    if (!["DRAFT", "RETURNED"].includes(entry.status)) throw new DailyStatError("当前状态不能提交", 409);
    return tx.dailyStatEntry.update({
      where: { id: entry.id },
      data: {
        status: entry.approvedRevisionId ? "CORRECTION_PENDING" : "PENDING",
        submittedAt: new Date(),
        reviewReason: null,
      },
      include: dailyStatEntryInclude,
    });
  }
  if (!["PENDING", "CORRECTION_PENDING"].includes(entry.status)) throw new DailyStatError("当前状态不能撤回", 409);
  return tx.dailyStatEntry.update({
    where: { id: entry.id },
    data: { status: "DRAFT", submittedAt: null },
    include: dailyStatEntryInclude,
  });
}

export async function reviewDailyStat(
  tx: Prisma.TransactionClient,
  reviewer: { id: string; active: boolean; groupId: string | null; role: string; duty?: string | null },
  input: { entryId: string; action: "RETURN"; reason?: string | null },
) {
  if (!reviewer.active || !reviewer.groupId || !(reviewer.role === "LEAD" || reviewer.duty === "LEAD")) {
    throw new DailyStatError("只有本组组长可以审核每日数据", 403);
  }
  const entry = await tx.dailyStatEntry.findUnique({ where: { id: input.entryId }, include: dailyStatEntryInclude });
  if (!entry || entry.groupId !== reviewer.groupId) throw new DailyStatError("每日数据不存在", 404);
  if (!["PENDING", "CORRECTION_PENDING"].includes(entry.status)) throw new DailyStatError("这条数据不在待审核状态", 409);
  if (!input.reason?.trim()) throw new DailyStatError("退回时必须填写原因");

  return tx.dailyStatEntry.update({
    where: { id: entry.id },
    data: {
      status: "RETURNED",
      reviewedById: reviewer.id,
      reviewedAt: new Date(),
      reviewReason: input.reason.trim(),
    },
    include: dailyStatEntryInclude,
  });
}

export async function forwardDailyStatsToResource(
  tx: Prisma.TransactionClient,
  reviewer: { id: string; active: boolean; groupId: string | null; role: string; duty?: string | null },
  businessDate: string,
) {
  if (!reviewer.active || !reviewer.groupId || !(reviewer.role === "LEAD" || reviewer.duty === "LEAD")) {
    throw new DailyStatError("只有本组组长可以发送每日数据", 403);
  }
  const [entries, members] = await Promise.all([
    tx.dailyStatEntry.findMany({
      where: { groupId: reviewer.groupId, businessDate },
      select: { id: true, ownerId: true, position: true, status: true, currentRevisionId: true, channelId: true, channel: { select: { name: true } } },
    }),
    tx.user.findMany({
      where: { groupId: reviewer.groupId, active: true },
      select: { id: true, name: true, role: true, roleAssignments: { select: { role: true } } },
    }),
  ]);
  const editable = entries.filter((entry) => ["DRAFT", "RETURNED"].includes(entry.status));
  if (editable.length) throw new DailyStatError(`还有 ${editable.length} 条草稿或退回数据，不能发送资源部`, 409);
  const submitted = entries.filter((entry) => ["PENDING", "CORRECTION_PENDING"].includes(entry.status) && entry.currentRevisionId);
  if (!submitted.length) throw new DailyStatError("这一天没有可发送的员工数据", 409);

  const frontline = new Set(["RECEPTION", "GROUP_OPERATOR", "EXPERT"]);
  // 资源部可能先通过同一天的大部分记录、只退回其中一条。员工修好后再次发送时，
  // 已在资源部或已终审的岗位也算“当天已填写”，不能误报为整组漏填。
  const coveredKeys = new Set(entries
    .filter((entry) => ["PENDING", "CORRECTION_PENDING", "RESOURCE_PENDING", "APPROVED"].includes(entry.status) && entry.currentRevisionId)
    .map((entry) => `${entry.ownerId}:${entry.position}`));
  const missing = members.flatMap((member) => [...new Set([member.role, ...member.roleAssignments.map((item) => item.role)])]
    .filter((role) => frontline.has(role))
    .filter((role) => !coveredKeys.has(`${member.id}:${role}`))
    .map((role) => `${member.name}（${role === "RECEPTION" ? "接粉" : role === "GROUP_OPERATOR" ? "炒群" : "专家"}）`));
  if (missing.length) throw new DailyStatError(`以下岗位还没提交：${missing.join("、")}`, 409);

  const receptionSubmitted = submitted.filter((entry) => entry.position === "RECEPTION");
  const directlyApproved = submitted.filter((entry) => entry.position !== "RECEPTION");
  const channelIds = [...new Set(receptionSubmitted.map((entry) => entry.channelId))];
  const resourceAccess = await tx.resourceChannelAccess.findMany({
    where: { channelId: { in: channelIds }, user: { active: true, role: "RESOURCE_MANAGER" } },
    select: { channelId: true },
  });
  const coveredChannels = new Set(resourceAccess.map((access) => access.channelId));
  const uncovered = [...new Map(receptionSubmitted.filter((entry) => !coveredChannels.has(entry.channelId)).map((entry) => [entry.channelId, entry.channel.name])).values()];
  if (uncovered.length) throw new DailyStatError(`以下渠道没有在职资源部审核账号：${uncovered.join("、")}`, 409);

  const reviewedAt = new Date();
  const receptionIds = receptionSubmitted.map((entry) => entry.id);
  const directIds = directlyApproved.map((entry) => entry.id);
  if (receptionIds.length) {
    await tx.dailyStatEntry.updateMany({
      where: { id: { in: receptionIds }, status: { in: ["PENDING", "CORRECTION_PENDING"] } },
      data: { status: "RESOURCE_PENDING", reviewedById: reviewer.id, reviewedAt, reviewReason: null },
    });
  }
  for (const entry of directlyApproved) {
    await tx.dailyStatEntry.update({
      where: { id: entry.id },
      data: {
        status: "APPROVED",
        approvedRevisionId: entry.currentRevisionId,
        reviewedById: reviewer.id,
        reviewedAt,
        reviewReason: null,
      },
    });
  }
  return {
    count: receptionIds.length + directIds.length,
    resourceReviewCount: receptionIds.length,
    directlyApprovedCount: directIds.length,
    businessDate,
  };
}
