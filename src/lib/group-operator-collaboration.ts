import type { Prisma } from "@prisma/client";

/**
 * 组长手工分配的接粉员，加上炒群员自己兼任接粉时的本人。
 * 本人不需要再额外配置一遍，也会自动去重。
 */
export function resolveAccessibleReceptionistIds(input: {
  operatorId: string;
  pairedReceptionistIds: string[];
  isReceptionist: boolean;
}): string[] {
  return [...new Set([
    ...input.pairedReceptionistIds,
    ...(input.isReceptionist ? [input.operatorId] : []),
  ])];
}

type CurrentPairing = {
  groupOperatorId: string;
  receptionistId: string;
  createdAt: Date;
};

async function closePairingHistory(
  tx: Prisma.TransactionClient,
  pairing: CurrentPairing,
  effectiveTo: Date,
  createdById: string | null,
  reason: string,
) {
  const closed = await tx.groupOperatorReceptionHistory.updateMany({
    where: {
      groupOperatorId: pairing.groupOperatorId,
      receptionistId: pairing.receptionistId,
      effectiveTo: null,
    },
    data: { effectiveTo },
  });
  // 兼容迁移前或人工修库留下的“只有当前关系、没有历史行”的旧数据。
  if (closed.count === 0) {
    await tx.groupOperatorReceptionHistory.create({
      data: {
        groupOperatorId: pairing.groupOperatorId,
        receptionistId: pairing.receptionistId,
        effectiveFrom: pairing.createdAt,
        effectiveTo,
        createdById,
        reason,
      },
    });
  }
}

/**
 * 更新一个炒群员的当前配对，并同步保留历史版本。
 * 这里只改“当前配对指针”，不会批量改 LeadCustomer.groupOperatorOwnerId，
 * 因此已明确归属的老客户仍留在原负责人名下。
 */
export async function replaceGroupOperatorReceptionAssignments(input: {
  tx: Prisma.TransactionClient;
  groupOperatorId: string;
  receptionistIds: string[];
  actorId: string;
  reason?: string;
  effectiveAt?: Date;
}) {
  const receptionistIds = [...new Set(input.receptionistIds)];
  const selected = new Set(receptionistIds);
  const effectiveAt = input.effectiveAt ?? new Date();
  const reason = input.reason?.trim() || "组长调整接粉与炒群配对";
  const current = await input.tx.groupOperatorReception.findMany({
    where: {
      OR: [
        { groupOperatorId: input.groupOperatorId },
        ...(receptionistIds.length ? [{ receptionistId: { in: receptionistIds } }] : []),
      ],
    },
    select: { groupOperatorId: true, receptionistId: true, createdAt: true },
  });
  const unchanged = new Set(
    current
      .filter((pairing) => pairing.groupOperatorId === input.groupOperatorId && selected.has(pairing.receptionistId))
      .map((pairing) => pairing.receptionistId),
  );
  const removed = current.filter((pairing) =>
    (pairing.groupOperatorId === input.groupOperatorId && !selected.has(pairing.receptionistId))
    || (pairing.groupOperatorId !== input.groupOperatorId && selected.has(pairing.receptionistId)),
  );

  for (const pairing of removed) {
    await closePairingHistory(input.tx, pairing, effectiveAt, input.actorId, reason);
    await input.tx.groupOperatorReception.delete({
      where: {
        groupOperatorId_receptionistId: {
          groupOperatorId: pairing.groupOperatorId,
          receptionistId: pairing.receptionistId,
        },
      },
    });
  }

  const added = receptionistIds.filter((receptionistId) => !unchanged.has(receptionistId));
  for (const receptionistId of added) {
    await input.tx.groupOperatorReception.create({
      data: { groupOperatorId: input.groupOperatorId, receptionistId },
    });
    await input.tx.groupOperatorReceptionHistory.create({
      data: {
        groupOperatorId: input.groupOperatorId,
        receptionistId,
        effectiveFrom: effectiveAt,
        createdById: input.actorId,
        reason,
      },
    });
  }
  return { addedCount: added.length, removedCount: removed.length };
}

/**
 * 以接粉员为中心更新一条当前配对。groupOperatorId 为空表示明确保存为“待配对”。
 * 这条入口只关闭该接粉员自己的当前关系；兼任炒群的人员仍可继续承接其他接粉员，
 * 不会因为把自己设为待配对而误删其作为炒群员的其他配对。
 */
export async function replaceReceptionistGroupOperatorAssignment(input: {
  tx: Prisma.TransactionClient;
  receptionistId: string;
  groupOperatorId: string | null;
  actorId: string;
  reason?: string;
  effectiveAt?: Date;
}) {
  const effectiveAt = input.effectiveAt ?? new Date();
  const reason = input.reason?.trim() || "组长调整接粉与炒群配对";
  const current = await input.tx.groupOperatorReception.findFirst({
    where: { receptionistId: input.receptionistId },
    select: { groupOperatorId: true, receptionistId: true, createdAt: true },
  });
  if (current?.groupOperatorId === input.groupOperatorId) {
    return { changed: false, previousGroupOperatorId: current.groupOperatorId };
  }
  if (current) {
    await closePairingHistory(input.tx, current, effectiveAt, input.actorId, reason);
    await input.tx.groupOperatorReception.delete({
      where: {
        groupOperatorId_receptionistId: {
          groupOperatorId: current.groupOperatorId,
          receptionistId: current.receptionistId,
        },
      },
    });
  }
  if (input.groupOperatorId) {
    await input.tx.groupOperatorReception.create({
      data: {
        groupOperatorId: input.groupOperatorId,
        receptionistId: input.receptionistId,
      },
    });
    await input.tx.groupOperatorReceptionHistory.create({
      data: {
        groupOperatorId: input.groupOperatorId,
        receptionistId: input.receptionistId,
        effectiveFrom: effectiveAt,
        createdById: input.actorId,
        reason,
      },
    });
  }
  return {
    changed: true,
    previousGroupOperatorId: current?.groupOperatorId ?? null,
  };
}

/** 转岗/停用时关闭涉及该成员的当前配对，同时保留已结束的历史行。 */
export async function closeGroupOperatorReceptionAssignmentsForMember(input: {
  tx: Prisma.TransactionClient;
  userId: string;
  actorId: string;
  reason: string;
  effectiveAt?: Date;
}) {
  const effectiveAt = input.effectiveAt ?? new Date();
  const current = await input.tx.groupOperatorReception.findMany({
    where: { OR: [{ groupOperatorId: input.userId }, { receptionistId: input.userId }] },
    select: { groupOperatorId: true, receptionistId: true, createdAt: true },
  });
  for (const pairing of current) {
    await closePairingHistory(input.tx, pairing, effectiveAt, input.actorId, input.reason);
  }
  if (current.length) {
    await input.tx.groupOperatorReception.deleteMany({
      where: { OR: [{ groupOperatorId: input.userId }, { receptionistId: input.userId }] },
    });
  }
  return current.length;
}

export function activeGroupOperatorHandoffWhere(input: {
  groupId: string;
  receptionistId: string;
  fromGroupOperatorId: string;
}): Prisma.LeadCustomerWhereInput {
  return {
    batch: { groupId: input.groupId },
    ownerId: input.receptionistId,
    groupOperatorOwnerId: input.fromGroupOperatorId,
    joinedOn: { not: null },
    leftOn: null,
    expertIntroducedOn: null,
    invalid: false,
  };
}

/**
 * 明确交接仍在炒群阶段的客户。调用方必须先预览数量，再把同一个数量作为
 * expectedCount 带回来确认；期间数据若变化就拒绝，避免“看见 5 个却转走 6 个”。
 */
export async function handoffActiveGroupOperatorCustomers(input: {
  tx: Prisma.TransactionClient;
  groupId: string;
  receptionistId: string;
  fromGroupOperatorId: string;
  toGroupOperatorId: string;
  expectedCount: number;
}) {
  const where = activeGroupOperatorHandoffWhere(input);
  const actualCount = await input.tx.leadCustomer.count({ where });
  if (actualCount !== input.expectedCount) {
    return { conflict: true as const, actualCount };
  }
  const updated = await input.tx.leadCustomer.updateMany({
    where,
    data: { groupOperatorOwnerId: input.toGroupOperatorId },
  });
  if (updated.count !== actualCount) {
    return { conflict: true as const, actualCount: updated.count };
  }
  return { conflict: false as const, transferredCount: updated.count };
}
