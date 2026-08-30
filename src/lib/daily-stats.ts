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
  const existing = input.entryId
    ? await tx.dailyStatEntry.findUnique({ where: { id: input.entryId }, include: { revisions: { orderBy: { version: "desc" }, take: 1 } } })
    : await tx.dailyStatEntry.findUnique({ where: { identityKey }, include: { revisions: { orderBy: { version: "desc" }, take: 1 } } });
  if (existing && (existing.ownerId !== actor.id || existing.identityKey !== identityKey)) {
    throw new DailyStatError("不能修改其他员工或其他来源线的数据", 403);
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
