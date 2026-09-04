import type { DailyStatEntry, Position, Prisma } from "@prisma/client";
import { z } from "zod";
import { STATISTICS_TIMEZONE, statisticsDate } from "./statistics-date";
import { getAssignedRoles, isFrontlineGroupMember } from "./role-access";
import { NUMBER_TRACKED_DAILY_FIELDS, usesCustomerNumberTracking } from "./customer-number-tracking";

const nonNegativeInt = z.number().int().min(0).max(2_147_483_647).default(0);
const optionalId = z.string().trim().min(1).nullable().optional();

export const dailyStatNumberFields = [
  "dispatchCount", "duplicateCount", "lowAmountCount", "noWsCount", "manualInvalidCount",
  "lawyerRealCaseCount", "lawyerAddedCount", "lawyerExpertAddedCount", "customerServicePushCount",
  "replyCount", "joinCount", "operatorReceivedCount", "normalLeaveCount",
  "abnormalLeaveCount", "currentInGroupCount", "expertIntroCount", "expertReceivedCount",
  "expertContactedCount", "registrationCount", "orderCount", "cryptoInitialDepositCents",
  "bankInitialDepositCents", "cryptoRechargeCents", "bankRechargeCents", "withdrawalCents",
] as const;

export const dailyStatValuesSchema = z.object({
  dispatchCount: nonNegativeInt,
  duplicateCount: nonNegativeInt,
  lowAmountCount: nonNegativeInt,
  noWsCount: nonNegativeInt,
  manualInvalidCount: nonNegativeInt,
  lawyerRealCaseCount: nonNegativeInt,
  lawyerAddedCount: nonNegativeInt,
  lawyerExpertAddedCount: nonNegativeInt,
  customerServicePushCount: nonNegativeInt,
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
  // position 仅是旧库的存储分类。新组员页面不传时默认写基础日报。
  position: z.enum(["RECEPTION", "GROUP_OPERATOR", "EXPERT"]).default("RECEPTION"),
  channelId: z.string().trim().min(1, "请选择渠道"),
  sourceReceptionId: optionalId,
  sourceGroupOperatorId: optionalId,
  changeReason: z.string().trim().max(500).nullable().optional(),
  expectedStatisticsDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
  const serialized = JSON.stringify([
    input.ownerId,
    input.groupId,
    input.businessDate,
    input.position,
    input.channelId,
    input.sourceReceptionId,
    input.sourceGroupOperatorId,
  ]);
  return input.position === "RECEPTION" ? `unified-member-v1:${serialized}` : serialized;
}

export function isUnifiedDailyStatIdentity(identityKey: string): boolean {
  return identityKey.startsWith("unified-member-v1:");
}

function normalizeSources(input: SaveDailyStatInput, actorId: string) {
  if (input.position === "RECEPTION") {
    return { sourceReceptionId: null, sourceGroupOperatorId: null };
  }
  const sourceReceptionId = input.sourceReceptionId ?? actorId;
  if (input.position === "GROUP_OPERATOR") {
    return { sourceReceptionId, sourceGroupOperatorId: null };
  }
  return {
    sourceReceptionId,
    sourceGroupOperatorId: input.sourceGroupOperatorId ?? actorId,
  };
}

function revisionValues(
  input: SaveDailyStatInput,
  groupType: "HACKER" | "LAWYER",
  options: { allowHistoricalFunnelOverflow?: boolean } = {},
) {
  const all = input.values;
  if (input.position === "RECEPTION" && groupType === "LAWYER") {
    for (const [label, value] of [
      ["接粉小金额", all.lowAmountCount],
      ["接粉真实案件", all.lawyerRealCaseCount],
      ["添加律师", all.lawyerAddedCount],
      ["添加专家", all.lawyerExpertAddedCount],
    ] as const) {
      if (value > all.dispatchCount) throw new DailyStatError(`${label}数量不能超过接粉数量`);
    }
    return {
      dispatchCount: all.dispatchCount,
      replyCount: all.replyCount,
      lowAmountCount: all.lowAmountCount,
      lawyerRealCaseCount: all.lawyerRealCaseCount,
      lawyerAddedCount: all.lawyerAddedCount,
      lawyerExpertAddedCount: all.lawyerExpertAddedCount,
      customerServicePushCount: all.customerServicePushCount,
      registrationCount: all.registrationCount,
      orderCount: all.orderCount,
      cryptoInitialDepositCents: all.cryptoInitialDepositCents,
      bankInitialDepositCents: all.bankInitialDepositCents,
      cryptoRechargeCents: all.cryptoRechargeCents,
      bankRechargeCents: all.bankRechargeCents,
      withdrawalCents: all.withdrawalCents,
    };
  }
  if (input.position === "RECEPTION") {
    const effectiveCount = all.dispatchCount - all.duplicateCount - all.lowAmountCount - all.noWsCount - all.manualInvalidCount;
    // 无效、回复和进群都按“当天实际发生”登记，其中可能包含前几天接粉的存量客户。
    // 因此它们可以高于当天添加数；有效数也允许为负，月度总账再按合计重新计算。
    // 注册和开单按实际发生日期登记，可能来自前几天已经推专家或注册的存量客户，
    // 因此不能拿当天推专家、当天注册数量作为上限。
    return {
      dispatchCount: all.dispatchCount,
      duplicateCount: all.duplicateCount,
      lowAmountCount: all.lowAmountCount,
      noWsCount: all.noWsCount,
      manualInvalidCount: all.manualInvalidCount,
      effectiveCount,
      replyCount: all.replyCount,
      joinCount: all.joinCount,
      normalLeaveCount: all.normalLeaveCount,
      abnormalLeaveCount: all.abnormalLeaveCount,
      currentInGroupCount: all.currentInGroupCount,
      expertIntroCount: all.expertIntroCount,
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
  if (input.position === "GROUP_OPERATOR") {
    // 当前在群是存量快照，正常/异常退群及推专家都可能来自前几天的存量。
    // 由于表单没有“昨日存量”，不能用当天接收数给这些字段设置错误上限。
    return {
      operatorReceivedCount: all.operatorReceivedCount,
      normalLeaveCount: all.normalLeaveCount,
      abnormalLeaveCount: all.abnormalLeaveCount,
      currentInGroupCount: all.currentInGroupCount,
      expertIntroCount: all.expertIntroCount,
    };
  }
  // 专家今天注册、开单的客户也可能是之前接手的存量，不能做同日漏斗上限校验。
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
  options: { allowHistoricalFunnelOverflow?: boolean } = {},
) {
  if (!actor.active || !actor.groupId) throw new DailyStatError("当前账号未分配到可用小组", 403);
  const input = saveDailyStatSchema.parse(rawInput);
  const requestedExisting = input.entryId
    ? await tx.dailyStatEntry.findUnique({
        where: { id: input.entryId },
        include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
      })
    : null;
  const editingOwnHistoricalPosition = Boolean(requestedExisting
    && requestedExisting.ownerId === actor.id
    && requestedExisting.groupId === actor.groupId
    && requestedExisting.businessDate === input.businessDate
    && requestedExisting.position === input.position
    && requestedExisting.channelId === input.channelId);
  if (!isFrontlineGroupMember(actor) && !editingOwnHistoricalPosition)
    throw new DailyStatError("只有在职组员可以填写每日和资金数据", 403);

  const group = await tx.teamGroup.findUnique({
    where: { id: actor.groupId },
    select: { id: true, active: true, groupType: true, department: { select: { timezone: true } } },
  });
  if (!group?.active) throw new DailyStatError("当前小组不可用", 403);
  const currentStatisticsDate = statisticsDate();
  if (input.businessDate > currentStatisticsDate) throw new DailyStatError("不能填写北京时间统计日之后的数据");
  if (input.expectedStatisticsDate && input.expectedStatisticsDate !== currentStatisticsDate) {
    throw new DailyStatError("统计日已在北京时间 14:00 切换，请刷新后填写新日期", 409);
  }

  const channel = await tx.channel.findFirst({
    where: { id: input.channelId, groupId: actor.groupId, active: true },
    select: { id: true },
  });
  if (!channel) throw new DailyStatError("渠道不存在或已停用");

  const sources = normalizeSources(input, actor.id);
  if (sources.sourceReceptionId) {
    await validateSourcePerson(tx, {
      userId: sources.sourceReceptionId,
      groupId: actor.groupId,
      position: "RECEPTION",
      businessDate: input.businessDate,
      label: "来源接粉",
      // 炒群/专家都可能由兼岗或历史转岗成员提供上游来源；这里只限制小组，不再锁当前岗位。
      allowAnyGroupRole: true,
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
  let existing = input.entryId
    ? requestedExisting
    : await tx.dailyStatEntry.findUnique({ where: { identityKey }, include: { revisions: { orderBy: { version: "desc" }, take: 1 } } });
  // 切换统一组员日报时，极少数范围同时保留了旧 RECEPTION 行和新版统一行。
  // 旧页面或浏览器缓存可能仍提交旧行 id；此时必须把修改写进唯一的新版行，
  // 不能返回 409 让用户看起来永远保存失败，也不能再制造第三条记录。
  if (existing && input.position === "RECEPTION" && !isUnifiedDailyStatIdentity(existing.identityKey)) {
    const canonical = await tx.dailyStatEntry.findUnique({
      where: { identityKey },
      include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (canonical) existing = canonical;
  }
  // 旧 RECEPTION 行的 identityKey 没有 unified-member-v1 标记。第一次用新页面保存时
  // 复用原行并升级标记，不另建一条导致同日同渠道重复。
  if (!existing && input.position === "RECEPTION") {
    existing = await tx.dailyStatEntry.findFirst({
      where: {
        ownerId: actor.id,
        groupId: actor.groupId,
        businessDate: input.businessDate,
        channelId: input.channelId,
        position: "RECEPTION",
      },
      include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
      orderBy: { createdAt: "asc" },
    });
  }
  const migratedEntry = Boolean(existing && (
    existing.identityKey.startsWith("legacy-metric-v1:")
    || existing.identityKey.startsWith("transition-customer-v1:")
    || (input.position === "RECEPTION" && !isUnifiedDailyStatIdentity(existing.identityKey))
  ));
  const migratedScopeMatches = Boolean(existing && migratedEntry
    && existing.groupId === actor.groupId
    && existing.businessDate === input.businessDate
    && existing.position === input.position
    && existing.channelId === input.channelId);
  if (existing && (existing.ownerId !== actor.id || (existing.identityKey !== identityKey && !migratedScopeMatches))) {
    throw new DailyStatError("不能修改其他员工或其他来源线的数据", 403);
  }
  if (existing && migratedScopeMatches && existing.identityKey !== identityKey) {
    const identityConflict = await tx.dailyStatEntry.findUnique({ where: { identityKey }, select: { id: true } });
    if (identityConflict && identityConflict.id !== existing.id) {
      throw new DailyStatError("该日期和来源线已经有一条正常记录，请直接修改正常记录", 409);
    }
  }
  // 当天数据允许随业务进展继续更新；只有修改已经过去的统计日才强制填写原因。
  if (existing?.approvedRevisionId && input.businessDate < currentStatisticsDate && !input.changeReason) {
    throw new DailyStatError("已确认数据必须填写更正原因", 400);
  }

  const values = revisionValues(input, group.groupType, options);
  // 切换日之后，进群、推专家、注册、开单等流程由号码事件提供；
  // 资金不在锁定列表里，仍由组员填写，作为公司最终认账数字。
  if (group.groupType === "HACKER" && input.position === "RECEPTION" && usesCustomerNumberTracking(input.businessDate)) {
    for (const field of NUMBER_TRACKED_DAILY_FIELDS) values[field] = 0;
  }
  let entry: DailyStatEntry;
  if (!existing) {
    entry = await tx.dailyStatEntry.create({
      data: {
        identityKey,
        ownerId: actor.id,
        groupId: actor.groupId,
        channelId: input.channelId,
        businessDate: input.businessDate,
        timezone: STATISTICS_TIMEZONE,
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
      // 兼容旧流程留下的退回原因；当前流程由员工直接修改并立即成为正式版本。
      changeReason: input.changeReason || existing?.reviewReason || null,
      ...values,
    },
  });
  const savedAt = new Date();
  const updated = await tx.dailyStatEntry.update({
    where: { id: entry.id },
    data: {
      ...(migratedScopeMatches ? { identityKey, ...sources } : {}),
      currentRevisionId: revision.id,
      status: "APPROVED",
      // 当前业务不走资源部审批；每次保存的新修订立即成为正式版本。
      approvedRevisionId: revision.id,
      submittedAt: savedAt,
      reviewReason: null,
      reviewedAt: null,
      reviewedById: null,
    },
    include: dailyStatEntryInclude,
  });

  const numberTrackedReception = group.groupType === "HACKER" && usesCustomerNumberTracking(input.businessDate);
  if (input.position === "RECEPTION" && isUnifiedDailyStatIdentity(updated.identityKey) && numberTrackedReception) {
    // 号码统计切换期若残留旧接粉行，统一行保存成功后立即封存旧行。
    // 修订内容继续保留用于审计，但旧行不再是正式账，也不会参与任何汇总。
    await tx.dailyStatEntry.updateMany({
      where: {
        id: { not: updated.id },
        ownerId: updated.ownerId,
        groupId: updated.groupId,
        channelId: updated.channelId,
        businessDate: updated.businessDate,
        position: "RECEPTION",
        status: { not: "RETURNED" },
      },
      data: {
        status: "RETURNED",
        approvedRevisionId: null,
        reviewedById: actor.id,
        reviewedAt: savedAt,
        reviewReason: `已由统一组员日报 ${updated.id} 替代`,
      },
    });
  }

  // 旧版曾把同一个人的接粉、炒群、专家数据拆成三行。统一组员日报直接保存后，
  // 只有在新行已经完整覆盖旧行时才停用旧行，避免正式报表重复相加。
  if (input.position === "RECEPTION" && isUnifiedDailyStatIdentity(updated.identityKey) && !numberTrackedReception) {
    const legacyCompanions = await tx.dailyStatEntry.findMany({
      where: {
        id: { not: updated.id },
        groupId: updated.groupId,
        channelId: updated.channelId,
        businessDate: updated.businessDate,
        position: { in: ["GROUP_OPERATOR", "EXPERT"] },
        approvedRevisionId: { not: null },
        OR: [{ ownerId: updated.ownerId }, { sourceReceptionId: updated.ownerId }],
      },
      select: { id: true, position: true, approvedRevision: true },
    });
    const legacyTotals = legacyCompanions.reduce((totals, companion) => {
      const old = companion.approvedRevision;
      if (!old) return totals;
      if (companion.position === "GROUP_OPERATOR") {
        totals.normalLeaveCount += old.normalLeaveCount;
        totals.abnormalLeaveCount += old.abnormalLeaveCount;
        totals.currentInGroupCount += old.currentInGroupCount;
        totals.expertIntroCount += old.expertIntroCount;
      } else {
        totals.expertContactedCount += old.expertContactedCount;
        totals.registrationCount += old.registrationCount;
        totals.orderCount += old.orderCount;
        totals.cryptoInitialDepositCents += old.cryptoInitialDepositCents;
        totals.bankInitialDepositCents += old.bankInitialDepositCents;
        totals.cryptoRechargeCents += old.cryptoRechargeCents;
        totals.bankRechargeCents += old.bankRechargeCents;
        totals.withdrawalCents += old.withdrawalCents;
      }
      return totals;
    }, {
      normalLeaveCount: 0,
      abnormalLeaveCount: 0,
      currentInGroupCount: 0,
      expertIntroCount: 0,
      expertContactedCount: 0,
      registrationCount: 0,
      orderCount: 0,
      cryptoInitialDepositCents: 0,
      bankInitialDepositCents: 0,
      cryptoRechargeCents: 0,
      bankRechargeCents: 0,
      withdrawalCents: 0,
    });
    const coversLegacyValues = Object.entries(legacyTotals).every(
      ([field, value]) => revision[field as keyof typeof legacyTotals] === value,
    );
    if (legacyCompanions.length && (coversLegacyValues || Boolean(revision.changeReason))) {
      await tx.dailyStatEntry.updateMany({
        where: { id: { in: legacyCompanions.map((companion) => companion.id) } },
        data: {
          status: "RETURNED",
          approvedRevisionId: null,
          reviewedById: actor.id,
          reviewedAt: savedAt,
          reviewReason: `已并入统一组员日报 ${updated.id}`,
        },
      });
    }
  }

  return updated;
}

export const dailyStatEntryInclude = {
  owner: { select: { id: true, name: true, active: true } },
  group: { select: { id: true, name: true, groupType: true } },
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

type DailyStatIncrement = Partial<Record<(typeof dailyStatNumberFields)[number], number>>;

/**
 * 把“老客户今天新发生的步骤”并入现有日报行。
 * 接粉量保持不变，只累加这次真实发生的进群、注册、开单或资金事实。
 */
export async function incrementCustomerEventDailyStat(
  tx: Prisma.TransactionClient,
  input: {
    ownerId: string;
    groupId: string;
    channelId: string;
    businessDate: string;
    position: "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
    sourceReceptionId: string;
    sourceGroupOperatorId?: string | null;
    reason: string;
    increment: DailyStatIncrement;
    currentInGroupSnapshot?: number;
    allowBeforeNumberTracking?: boolean;
  },
) {
  if (!usesCustomerNumberTracking(input.businessDate) && !input.allowBeforeNumberTracking) return null;
  const owner = await tx.user.findFirst({
    where: { id: input.ownerId, groupId: input.groupId, active: true },
    select: {
      id: true,
      active: true,
      role: true,
      groupId: true,
      group: { select: { groupType: true } },
      roleAssignments: { select: { role: true } },
    },
  });
  if (!owner) throw new DailyStatError("老客户当前负责人已停用或不在本组，请先重新选择负责人");
  // 号码漏斗只适用于黑客组；律师组继续使用自己的统计口径，避免重复入账。
  if (owner.group?.groupType !== "HACKER") return null;

  const sources = normalizeSources({
    businessDate: input.businessDate,
    position: input.position,
    channelId: input.channelId,
    sourceReceptionId: input.sourceReceptionId,
    sourceGroupOperatorId: input.sourceGroupOperatorId ?? undefined,
    values: Object.fromEntries(dailyStatNumberFields.map((field) => [field, 0])) as z.infer<typeof dailyStatValuesSchema>,
  }, owner.id);
  const identityKey = entryIdentity({
    ownerId: owner.id,
    groupId: input.groupId,
    businessDate: input.businessDate,
    position: input.position,
    channelId: input.channelId,
    ...sources,
  });
  const existing = await tx.dailyStatEntry.findUnique({
    where: { identityKey },
    include: { currentRevision: true, approvedRevision: true },
  });
  const previous = existing?.currentRevision ?? existing?.approvedRevision;
  const values = Object.fromEntries(dailyStatNumberFields.map((field) => [field, previous?.[field] ?? 0])) as z.infer<typeof dailyStatValuesSchema>;
  for (const [field, amount] of Object.entries(input.increment) as Array<[keyof DailyStatIncrement, number | undefined]>) {
    if (!amount) continue;
    values[field] = Math.max(0, values[field] + amount);
  }
  if (input.currentInGroupSnapshot !== undefined) values.currentInGroupCount = Math.max(0, input.currentInGroupSnapshot);
  return saveDailyStat(tx, owner, {
    ...(existing ? { entryId: existing.id } : {}),
    businessDate: input.businessDate,
    position: input.position,
    channelId: input.channelId,
    sourceReceptionId: input.sourceReceptionId,
    sourceGroupOperatorId: input.sourceGroupOperatorId ?? undefined,
    changeReason: `AI客户事件同步：${input.reason}`,
    values,
  }, { allowHistoricalFunnelOverflow: true });
}

// 老客户入口原本就按“本次真实发生日期”入账，保留切换日前的兼容能力。
export function incrementHistoricalCustomerDailyStat(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof incrementCustomerEventDailyStat>[1],
) {
  return incrementCustomerEventDailyStat(tx, { ...input, allowBeforeNumberTracking: true });
}
