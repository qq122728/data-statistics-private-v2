import type { MetricKind } from "@prisma/client";
import { db } from "../db";
import { assessGroupLeave } from "../group-leave";

export type CanonicalMetricEvent = {
  id: string;
  kind: MetricKind;
  quantity: number | null;
  amountCents: number | null;
  occurredOn: string;
  batchId: string;
  enteredById: string;
  voidedAt: null;
  // 号码的资源归类只在导入当天计入日报。保留在事实事件上，
  // 让日报可以准确拆出低金额和无 WS，而不会影响后续漏斗统计。
  receptionCategory?: "PENDING" | "VALID" | "INVALID" | "LOW_AMOUNT" | "NO_WS";
  isInvalid?: boolean;
  batch: {
    sourceDate: string;
    group: { id: string; name: string };
    channel: {
      id: string;
      groupId: string;
      name: string;
      normalizedName: string;
    };
  };
  enteredBy: {
    id: string;
    name: string;
    role: "RECEPTION";
    active: boolean;
    hireDate: string | null;
    stageOverride: "TRAINING" | "OBSERVATION" | "FORMAL" | "PAUSED" | null;
  };
};

export type CanonicalEventScope = {
  groupIds: string[];
  channelIds?: string[];
  sourceDateFrom?: string;
  sourceDateTo?: string;
  normalizedName?: string;
  memberId?: string;
  batchId?: string;
  occurredOnFrom?: string;
  occurredOnTo?: string;
};

function withinOccurredRange(
  occurredOn: string,
  scope: CanonicalEventScope,
): boolean {
  if (scope.occurredOnFrom && occurredOn < scope.occurredOnFrom) return false;
  if (scope.occurredOnTo && occurredOn > scope.occurredOnTo) return false;
  return true;
}

/**
 * Builds reporting facts from the phone-level customer ledger.
 *
 * LeadCustomer is the source of truth for funnel counts. MetricEvent remains
 * the detail ledger for continuation recharges and withdrawals only.
 */
export async function loadCanonicalMetricEvents(
  scope: CanonicalEventScope,
): Promise<CanonicalMetricEvent[]> {
  if (!scope.groupIds.length) return [];

  const batches = await db.sourceBatch.findMany({
    where: {
      groupId: { in: scope.groupIds },
      ...(scope.channelIds ? { channelId: { in: scope.channelIds } } : {}),
      ...(scope.batchId ? { id: scope.batchId } : {}),
      ...(scope.sourceDateFrom || scope.sourceDateTo
        ? {
            sourceDate: {
              ...(scope.sourceDateFrom ? { gte: scope.sourceDateFrom } : {}),
              ...(scope.sourceDateTo ? { lte: scope.sourceDateTo } : {}),
            },
          }
        : {}),
      ...(scope.normalizedName
        ? { channel: { normalizedName: scope.normalizedName } }
        : {}),
    },
    select: {
      id: true,
      sourceDate: true,
      isHistoricalRecord: true,
      group: { select: { id: true, name: true } },
      channel: {
        select: {
          id: true,
          groupId: true,
          name: true,
          normalizedName: true,
        },
      },
      leads: {
        where: {
          // 业绩按“粉的归属”统计；ownerId 仍是实际接粉操作人，用于工作台权限和操作追溯。
          ...(scope.memberId
            ? {
                OR: [
                  { attributionOwnerId: scope.memberId },
                  // 兼容尚未回填完成的旧客户：空归属仍按原录入人展示。
                  { attributionOwnerId: null, ownerId: scope.memberId },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          invalid: true,
          isHistoricalRecord: true,
          historicalReplyCounted: true,
          historicalJoinCounted: true,
          historicalLeaveCounted: true,
          historicalExpertIntroCounted: true,
          historicalRegistrationCounted: true,
          receptionCategory: true,
          repliedOn: true,
          joinedOn: true,
          leftOn: true,
          expertIntroducedOn: true,
          registeredOn: true,
          owner: {
            select: {
              id: true,
              name: true,
              role: true,
              active: true,
              hireDate: true,
              stageOverride: true,
            },
          },
          attributionOwner: {
            select: {
              id: true,
              name: true,
              role: true,
              active: true,
              hireDate: true,
              stageOverride: true,
            },
          },
          customerOrder: {
            select: {
              id: true,
              openedOn: true,
              initialDepositCents: true,
              voidedAt: true,
              events: {
                where: {
                  kind: { in: ["RECHARGE", "WITHDRAWAL"] },
                  voidedAt: null,
                },
                select: {
                  id: true,
                  kind: true,
                  amountCents: true,
                  occurredOn: true,
                  continuationNumber: true,
                },
              },
            },
          },
        },
      },
      events: {
        where: {
          voidedAt: null,
          // 新系统的号码和漏斗从客户账本生成；只有“撞粉”没有客户记录，
          // 必须保留这条导入事实，才能让组长、资源部和财务看到同一个撞粉数。
          AND: [
            {
              OR: [
                { derivedFromLedger: false },
                { derivedFromLedger: true, kind: "DUPLICATE_FANS" },
              ],
            },
            // 历史汇总按事件发生时记录的归属保留。员工后来转岗时，
            // 不能因为当前主岗位不再是接粉，就把以前的接粉数据从报表中删掉。
            {
              OR: [
                { enteredBy: { role: "RECEPTION" } },
                { batch: { isHistoricalRecord: true } },
              ],
            },
          ],
          ...(scope.memberId ? { enteredById: scope.memberId } : {}),
        },
        select: {
          id: true,
          kind: true,
          quantity: true,
          amountCents: true,
          occurredOn: true,
          enteredById: true,
          enteredBy: {
            select: {
              id: true,
              name: true,
              role: true,
              active: true,
              hireDate: true,
              stageOverride: true,
            },
          },
        },
      },
    },
  });

  const facts: CanonicalMetricEvent[] = [];
  const add = (
    batch: (typeof batches)[number],
    lead: (typeof batches)[number]["leads"][number],
    suffix: string,
    kind: MetricKind,
    occurredOn: string | null,
    quantity: number | null,
    amountCents: number | null = null,
  ) => {
    if (!occurredOn || !withinOccurredRange(occurredOn, scope)) return;
    // 旧数据升级时会回填 attributionOwnerId；这里保留兜底，避免极少量迁移中数据导致报表空白。
    const attributionOwner = lead.attributionOwner ?? lead.owner;
    facts.push({
      id: `${lead.id}:${suffix}`,
      kind,
      quantity,
      amountCents,
      occurredOn,
      batchId: batch.id,
      enteredById: attributionOwner.id,
      voidedAt: null,
      receptionCategory: lead.receptionCategory,
      isInvalid: lead.invalid,
      batch: {
        sourceDate: batch.sourceDate,
        group: batch.group,
        channel: batch.channel,
      },
      // 这里是“粉的归属”漏斗，按接粉业绩口径聚合；实际岗位仍在原客户和操作日志里保留。
      enteredBy: { ...attributionOwner, role: "RECEPTION" },
    });
  };

  for (const batch of batches) {
    // Genuine pre-phone-ledger aggregates can coexist with newer phone-level
    // customers in one source batch. Compatibility rows written from the
    // phone ledger are filtered by derivedFromLedger above.
    for (const event of batch.events) {
      if (!withinOccurredRange(event.occurredOn, scope)) continue;
      facts.push({
        id: `legacy:${event.id}`,
        kind: event.kind,
        quantity: event.quantity,
        amountCents: event.amountCents,
        occurredOn: event.occurredOn,
        batchId: batch.id,
        enteredById: event.enteredById,
        voidedAt: null,
        batch: {
          sourceDate: batch.sourceDate,
          group: batch.group,
          channel: batch.channel,
        },
        enteredBy: { ...event.enteredBy, role: "RECEPTION" },
      });
    }
    for (const lead of batch.leads) {
      // 历史客户不重复增加粉数；只有系统启用后真实发生、明确打标的步骤进入累计分子。
      const historical = batch.isHistoricalRecord || lead.isHistoricalRecord;
      if (!historical)
        add(batch, lead, "new", "NEW_FANS", batch.sourceDate, 1);
      // 无效库转入客户可供炒群记录实际进度，但不进入有效粉、转化或业绩报表。
      const reportEligible = !lead.invalid && lead.receptionCategory !== "INVALID" && lead.receptionCategory !== "LOW_AMOUNT" && lead.receptionCategory !== "NO_WS";
      if (reportEligible && !historical)
        add(batch, lead, "effective", "EFFECTIVE_FANS", batch.sourceDate, 1);
      if (!reportEligible) continue;
      if (!historical) {
        add(batch, lead, "reply", "REPLIES", lead.repliedOn, 1);
        add(batch, lead, "join", "GROUP_JOIN", lead.joinedOn, 1);
        add(batch, lead, "leave", "GROUP_LEAVE", lead.leftOn, 1);
        if (assessGroupLeave(lead.joinedOn, lead.leftOn).level === "EARLY")
          add(batch, lead, "abnormal-leave", "ABNORMAL_GROUP_LEAVE", lead.leftOn, 1);
        add(batch, lead, "expert", "EXPERT_INTRO", lead.expertIntroducedOn, 1);
        add(batch, lead, "registration", "REGISTRATION", lead.registeredOn, 1);
      } else {
        if (lead.historicalReplyCounted) add(batch, lead, "historical-reply", "REPLIES", lead.repliedOn, 1);
        if (lead.historicalJoinCounted) add(batch, lead, "historical-join", "GROUP_JOIN", lead.joinedOn, 1);
        if (lead.historicalLeaveCounted) {
          add(batch, lead, "historical-leave", "GROUP_LEAVE", lead.leftOn, 1);
          if (assessGroupLeave(lead.joinedOn, lead.leftOn).level === "EARLY")
            add(batch, lead, "historical-abnormal-leave", "ABNORMAL_GROUP_LEAVE", lead.leftOn, 1);
        }
        if (lead.historicalExpertIntroCounted) add(batch, lead, "historical-expert", "EXPERT_INTRO", lead.expertIntroducedOn, 1);
        if (lead.historicalRegistrationCounted) add(batch, lead, "historical-registration", "REGISTRATION", lead.registeredOn, 1);
      }

      const order = lead.customerOrder;
      if (!order || order.voidedAt) continue;
      add(batch, lead, `order:${order.id}`, "ORDER", order.openedOn, 1);
      add(
        batch,
        lead,
        `initial:${order.id}`,
        "RECHARGE",
        order.openedOn,
        null,
        order.initialDepositCents,
      );
      for (const event of order.events) {
        if (event.kind === "RECHARGE" && event.continuationNumber === null)
          continue;
        add(
          batch,
          lead,
          `finance:${event.id}`,
          event.kind,
          event.occurredOn,
          null,
          event.amountCents ?? 0,
        );
      }
    }
  }

  return facts.sort(
    (left, right) =>
      left.occurredOn.localeCompare(right.occurredOn) ||
      left.id.localeCompare(right.id),
  );
}
