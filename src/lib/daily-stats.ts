import type { DailyStatEntry, Position, Prisma } from "@prisma/client";
import { z } from "zod";
import { localDateYYYYMMDD } from "./dates";
import { getAssignedRoles, isFrontlineGroupMember } from "./role-access";

const nonNegativeInt = z.number().int().min(0).max(2_147_483_647).default(0);
const optionalId = z.string().trim().min(1).nullable().optional();

export const dailyStatValuesSchema = z.object({
  dispatchCount: nonNegativeInt,
  duplicateCount: nonNegativeInt,
  lowAmountCount: nonNegativeInt,
  noWsCount: nonNegativeInt,
  manualInvalidCount: nonNegativeInt,
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

function revisionValues(input: SaveDailyStatInput) {
  const all = input.values;
  if (input.position === "RECEPTION") {
    const effectiveCount = all.dispatchCount - all.duplicateCount - all.lowAmountCount - all.noWsCount - all.manualInvalidCount;
    if (effectiveCount < 0) throw new DailyStatError("撞粉、低金额、无 WhatsApp 与人工无效数量之和不能超过总下发粉数量");
    if (all.replyCount > effectiveCount) throw new DailyStatError("回复数量不能超过有效数据数量");
    if (all.joinCount > effectiveCount) throw new DailyStatError("进群数量不能超过有效数据数量");
    if (all.registrationCount > all.expertIntroCount) throw new DailyStatError("注册数量不能超过推专家数量");
    if (all.orderCount > all.registrationCount) throw new DailyStatError("开单数量不能超过注册数量");
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
  if (all.registrationCount > all.expertReceivedCount) throw new DailyStatError("注册数量不能超过收到的推专家数量");
  if (all.orderCount > all.registrationCount) throw new DailyStatError("开单数量不能超过注册数量");
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
  if (existing?.approvedRevisionId && !input.changeReason) {
    throw new DailyStatError("已确认数据必须填写更正原因", 400);
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
      // 兼容旧流程留下的退回原因；新流程发现问题后由资源部线下联系员工直接修改。
      changeReason: input.changeReason || existing?.reviewReason || null,
      ...values,
    },
  });
  const requiresResourceCheck = input.position === "RECEPTION";
  const savedAt = new Date();
  return tx.dailyStatEntry.update({
    where: { id: entry.id },
    data: {
      ...(migratedScopeMatches ? { identityKey, ...sources } : {}),
      currentRevisionId: revision.id,
      status: requiresResourceCheck ? "RESOURCE_PENDING" : "APPROVED",
      // 接粉纠错在资源部确认前继续保留上一版正式数字；炒群/专家保存后立即采用最新版。
      approvedRevisionId: requiresResourceCheck ? existing?.approvedRevisionId ?? null : revision.id,
      submittedAt: savedAt,
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
