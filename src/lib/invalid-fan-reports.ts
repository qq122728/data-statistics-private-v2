import { type Prisma, type Role } from "@prisma/client";
import { db, getOrCreateSourceBatch } from "./db";
import { hasAssignedRole } from "./role-access";

export type InvalidFanReportStatus = "PENDING" | "APPROVED" | "RETURNED";

export type InvalidFanCounts = {
  noWsCount: number;
  lowAmountCount: number;
  collisionCount: number;
};

export type InvalidFanReportFinalizationInput = InvalidFanCounts & {
  status: InvalidFanReportStatus;
  approvedNoWsCount: number | null;
  approvedLowAmountCount: number | null;
  approvedCollisionCount: number | null;
};

export type OfficialInvalidFanTotals = InvalidFanCounts & { total: number };

export function validateInvalidFanCounts(input: InvalidFanCounts): { ok: true } | { ok: false; error: string } {
  for (const [label, value] of Object.entries({
    "无 WS": input.noWsCount,
    "低金额": input.lowAmountCount,
    "撞粉": input.collisionCount,
  })) {
    if (!Number.isInteger(value) || value < 0) return { ok: false, error: `${label}数量必须是大于或等于 0 的整数` };
  }
  return { ok: true };
}

export function finalizeInvalidFanReport(input: InvalidFanReportFinalizationInput): OfficialInvalidFanTotals {
  if (input.status !== "APPROVED") return { noWsCount: 0, lowAmountCount: 0, collisionCount: 0, total: 0 };
  const noWsCount = input.approvedNoWsCount ?? input.noWsCount;
  const lowAmountCount = input.approvedLowAmountCount ?? input.lowAmountCount;
  const collisionCount = input.approvedCollisionCount ?? input.collisionCount;
  return { noWsCount, lowAmountCount, collisionCount, total: noWsCount + lowAmountCount + collisionCount };
}

export class InvalidFanReportError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409, message: string) {
    super(message);
  }
}

export type InvalidFanReportActor = {
  id: string;
  role: Role;
  groupId: string | null;
  active: boolean;
  roleAssignments?: Array<{ role: Role }>;
};

type InvalidFanReportClient = Pick<typeof db, "sourceBatch" | "invalidFanReport" | "invalidFanReportAudit"> | Prisma.TransactionClient;

async function findBatchInActorGroup(client: InvalidFanReportClient, actor: InvalidFanReportActor, batchId: string) {
  if (!actor.active || !actor.groupId) throw new InvalidFanReportError(403, "当前账号没有本组无效粉操作权限");
  const batch = await client.sourceBatch.findUnique({
    where: { id: batchId },
    select: { id: true, groupId: true },
  });
  if (!batch) throw new InvalidFanReportError(404, "来源批次不存在");
  if (batch.groupId !== actor.groupId) throw new InvalidFanReportError(403, "只能操作本小组的无效粉数据");
  return batch;
}

export async function resolveInvalidFanReportBatch(input: {
  actor: InvalidFanReportActor;
  channelId: string;
  sourceDate: string;
}) {
  if (!input.actor.active || !input.actor.groupId) throw new InvalidFanReportError(403, "当前账号没有本组无效粉操作权限");
  return db.$transaction(async (transaction) => {
    const channel = await transaction.channel.findUnique({
      where: { id_groupId: { id: input.channelId, groupId: input.actor.groupId! } },
      select: { id: true, active: true },
    });
    if (!channel || !channel.active) throw new InvalidFanReportError(400, "渠道不存在或已停用");
    const batch = await getOrCreateSourceBatch({
      groupId: input.actor.groupId!,
      channelId: channel.id,
      sourceDate: input.sourceDate,
    }, transaction);
    return batch.id;
  });
}

function requireValidCounts(counts: InvalidFanCounts) {
  const validation = validateInvalidFanCounts(counts);
  if (!validation.ok) throw new InvalidFanReportError(400, validation.error);
}

export async function createInvalidFanReport(input: {
  actor: InvalidFanReportActor;
  batchId: string;
  counts: InvalidFanCounts;
}) {
  if (!hasAssignedRole(input.actor, "RECEPTION")) throw new InvalidFanReportError(403, "只有前台接粉可以提交无效粉数据");
  requireValidCounts(input.counts);
  return db.$transaction(async (transaction) => {
    await findBatchInActorGroup(transaction, input.actor, input.batchId);
    const existing = await transaction.invalidFanReport.findUnique({
      where: { batchId_reporterId: { batchId: input.batchId, reporterId: input.actor.id } },
    });
    if (existing?.status === "APPROVED") throw new InvalidFanReportError(409, "该批次无效粉已审核，如需更正请由组长操作");
    const report = existing
      ? await transaction.invalidFanReport.update({
        where: { id: existing.id },
        data: {
          status: "PENDING",
          ...input.counts,
          approvedNoWsCount: null,
          approvedLowAmountCount: null,
          approvedCollisionCount: null,
          reviewReason: null,
          reviewedAt: null,
          reviewedById: null,
        },
      })
      : await transaction.invalidFanReport.create({
        data: { batchId: input.batchId, reporterId: input.actor.id, ...input.counts },
      });
    await transaction.invalidFanReportAudit.create({
      data: {
        reportId: report.id,
        actorId: input.actor.id,
        action: existing ? "UPDATED" : "REPORTED",
        beforeNoWsCount: existing?.noWsCount ?? null,
        beforeLowAmountCount: existing?.lowAmountCount ?? null,
        beforeCollisionCount: existing?.collisionCount ?? null,
        afterNoWsCount: input.counts.noWsCount,
        afterLowAmountCount: input.counts.lowAmountCount,
        afterCollisionCount: input.counts.collisionCount,
      },
    });
    return report;
  });
}

export async function reviewInvalidFanReport(input: {
  actor: InvalidFanReportActor;
  reportId: string;
  action: "approve" | "return";
  approvedCounts?: InvalidFanCounts;
  reason?: string;
}) {
  if (!hasAssignedRole(input.actor, "LEAD")) throw new InvalidFanReportError(403, "只有组长可以审核无效粉数据");
  return db.$transaction(async (transaction) => {
    const report = await transaction.invalidFanReport.findUnique({
      where: { id: input.reportId },
      include: { batch: { select: { groupId: true } } },
    });
    if (!report) throw new InvalidFanReportError(404, "无效粉记录不存在");
    if (report.batch.groupId !== input.actor.groupId || !input.actor.active) throw new InvalidFanReportError(403, "只能审核本小组的无效粉数据");
    if (report.status !== "PENDING") throw new InvalidFanReportError(409, "只有待审核记录可以审核");
    const now = new Date();
    if (input.action === "return") {
      const reason = input.reason?.trim();
      if (!reason) throw new InvalidFanReportError(400, "退回扣粉登记必须填写原因");
      const returned = await transaction.invalidFanReport.update({
        where: { id: report.id },
        data: { status: "RETURNED", reviewReason: reason, reviewedAt: now, reviewedById: input.actor.id },
      });
      await transaction.invalidFanReportAudit.create({
        data: { reportId: report.id, actorId: input.actor.id, action: "RETURNED", reason },
      });
      return returned;
    }
    if (!input.approvedCounts) throw new InvalidFanReportError(400, "请填写组长确认后的三个无效粉数量");
    requireValidCounts(input.approvedCounts);
    const corrected = report.noWsCount !== input.approvedCounts.noWsCount
      || report.lowAmountCount !== input.approvedCounts.lowAmountCount
      || report.collisionCount !== input.approvedCounts.collisionCount;
    const reason = input.reason?.trim();
    if (corrected && !reason) throw new InvalidFanReportError(400, "更正组员填写的数据必须说明原因");
    const approved = await transaction.invalidFanReport.update({
      where: { id: report.id },
      data: {
        status: "APPROVED",
        approvedNoWsCount: input.approvedCounts.noWsCount,
        approvedLowAmountCount: input.approvedCounts.lowAmountCount,
        approvedCollisionCount: input.approvedCounts.collisionCount,
        reviewReason: reason || null,
        reviewedAt: now,
        reviewedById: input.actor.id,
      },
    });
    await transaction.invalidFanReportAudit.create({
      data: {
        reportId: report.id,
        actorId: input.actor.id,
        action: corrected ? "CORRECTED" : "APPROVED",
        beforeNoWsCount: report.noWsCount,
        beforeLowAmountCount: report.lowAmountCount,
        beforeCollisionCount: report.collisionCount,
        afterNoWsCount: input.approvedCounts.noWsCount,
        afterLowAmountCount: input.approvedCounts.lowAmountCount,
        afterCollisionCount: input.approvedCounts.collisionCount,
        reason: reason || null,
      },
    });
    return approved;
  });
}

export async function createLeaderInvalidFanSupplement(input: {
  actor: InvalidFanReportActor;
  batchId: string;
  counts: InvalidFanCounts;
  reason: string;
}) {
  if (!hasAssignedRole(input.actor, "LEAD")) throw new InvalidFanReportError(403, "只有组长可以补录无效粉数据");
  requireValidCounts(input.counts);
  const reason = input.reason.trim();
  if (!reason) throw new InvalidFanReportError(400, "组长补录无效粉必须填写原因");
  return db.$transaction(async (transaction) => {
    await findBatchInActorGroup(transaction, input.actor, input.batchId);
    const existing = await transaction.invalidFanReport.findUnique({
      where: { batchId_reporterId: { batchId: input.batchId, reporterId: input.actor.id } },
    });
    if (existing) {
      if (!existing.isLeaderSupplement || existing.status !== "APPROVED") throw new InvalidFanReportError(409, "该批次已有组长补录记录，当前不能直接更正");
      const report = await transaction.invalidFanReport.update({
        where: { id: existing.id },
        data: {
          ...input.counts,
          approvedNoWsCount: input.counts.noWsCount,
          approvedLowAmountCount: input.counts.lowAmountCount,
          approvedCollisionCount: input.counts.collisionCount,
          reviewReason: reason,
          reviewedAt: new Date(),
          reviewedById: input.actor.id,
        },
      });
      await transaction.invalidFanReportAudit.create({
        data: {
          reportId: report.id,
          actorId: input.actor.id,
          action: "CORRECTED",
          beforeNoWsCount: existing.approvedNoWsCount ?? existing.noWsCount,
          beforeLowAmountCount: existing.approvedLowAmountCount ?? existing.lowAmountCount,
          beforeCollisionCount: existing.approvedCollisionCount ?? existing.collisionCount,
          afterNoWsCount: input.counts.noWsCount,
          afterLowAmountCount: input.counts.lowAmountCount,
          afterCollisionCount: input.counts.collisionCount,
          reason,
        },
      });
      return report;
    }
    const report = await transaction.invalidFanReport.create({
      data: {
        batchId: input.batchId,
        reporterId: input.actor.id,
        status: "APPROVED",
        ...input.counts,
        approvedNoWsCount: input.counts.noWsCount,
        approvedLowAmountCount: input.counts.lowAmountCount,
        approvedCollisionCount: input.counts.collisionCount,
        reviewReason: reason,
        reviewedAt: new Date(),
        reviewedById: input.actor.id,
        isLeaderSupplement: true,
      },
    });
    await transaction.invalidFanReportAudit.create({
      data: {
        reportId: report.id,
        actorId: input.actor.id,
        action: "SUPPLEMENTED",
        afterNoWsCount: input.counts.noWsCount,
        afterLowAmountCount: input.counts.lowAmountCount,
        afterCollisionCount: input.counts.collisionCount,
        reason,
      },
    });
    return report;
  });
}

export type ApprovedInvalidFanReportTotal = OfficialInvalidFanTotals & {
  batchId: string;
  reporterId: string;
  reporterName: string;
  groupId: string;
  groupName: string;
  sourceDate: string;
  channelId: string;
  channelName: string;
  normalizedChannelName: string;
  channelType: "SMS" | "ADS" | "REBATE";
  reviewReason: string | null;
  reviewedAt: Date | null;
  reviewedByName: string | null;
};

/** 所有分析页复用这一个查询，避免待审核数据提前进入正式指标。 */
export async function getApprovedInvalidFanTotals(input: {
  batchIds?: string[];
  reporterIds?: string[];
  groupIds?: string[];
  channelIds?: string[];
  sourceDateFrom?: string;
  sourceDateTo?: string;
  normalizedChannelName?: string;
} = {}): Promise<ApprovedInvalidFanReportTotal[]> {
  const reports = await db.invalidFanReport.findMany({
    where: {
      status: "APPROVED",
      ...(input.batchIds?.length ? { batchId: { in: input.batchIds } } : {}),
      ...(input.reporterIds?.length ? { reporterId: { in: input.reporterIds } } : {}),
      batch: {
        ...(input.groupIds?.length ? { groupId: { in: input.groupIds } } : {}),
        ...(input.channelIds ? { channelId: { in: input.channelIds } } : {}),
        ...(input.sourceDateFrom || input.sourceDateTo ? {
          sourceDate: {
            ...(input.sourceDateFrom ? { gte: input.sourceDateFrom } : {}),
            ...(input.sourceDateTo ? { lte: input.sourceDateTo } : {}),
          },
        } : {}),
        ...(input.normalizedChannelName ? { channel: { normalizedName: input.normalizedChannelName } } : {}),
      },
    },
    select: {
      batchId: true,
      reporterId: true,
      status: true,
      noWsCount: true,
      lowAmountCount: true,
      collisionCount: true,
      approvedNoWsCount: true,
      approvedLowAmountCount: true,
      approvedCollisionCount: true,
      reviewReason: true,
      reviewedAt: true,
      reporter: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      batch: { select: { groupId: true, sourceDate: true, channelTypeSnapshot: true, group: { select: { name: true } }, channel: { select: { id: true, name: true, normalizedName: true } } } },
    },
    orderBy: [{ batch: { sourceDate: "asc" } }, { reporterId: "asc" }],
  });
  return reports.map((report) => ({
    batchId: report.batchId,
    reporterId: report.reporterId,
    reporterName: report.reporter.name,
    groupId: report.batch.groupId,
    groupName: report.batch.group.name,
    sourceDate: report.batch.sourceDate,
    channelId: report.batch.channel.id,
    channelName: report.batch.channel.name,
    normalizedChannelName: report.batch.channel.normalizedName,
    channelType: report.batch.channelTypeSnapshot,
    reviewReason: report.reviewReason,
    reviewedAt: report.reviewedAt,
    reviewedByName: report.reviewedBy?.name ?? null,
    ...finalizeInvalidFanReport(report),
  }));
}
