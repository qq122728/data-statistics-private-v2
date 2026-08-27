import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { recordAudit } from "../../../lib/audit";
import { db } from "../../../lib/db";
import { touchDailyEntryConfirmations } from "../../../lib/daily-confirmations";
import {
  buildHistoryGroupFingerprint,
  groupHistoryEvents,
  type HistoryMetricTotals,
} from "../../../lib/history-groups";
import { parseHistoryGroupUpdate } from "../../../lib/validation";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { getSystemSettings } from "../../../lib/settings";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { entryDateError } from "../../../lib/entry-date-validation";
import { API_LIMITS, hasOversizedQueryValue, RequestBodyTooLargeError, readLimitedJson, tooLargeResponse } from "../../../lib/request-limits";
import { authorizationDenied } from "../../../lib/security-events";

type FieldErrors = Record<string, string[]>;

const historyEventSelect = {
  id: true,
  occurredOn: true,
  kind: true,
  quantity: true,
  amountCents: true,
  derivedFromLedger: true,
  createdAt: true,
  batch: {
    select: {
      id: true,
      sourceDate: true,
      group: { select: { id: true, name: true, active: true } },
      channel: { select: { id: true, name: true, active: true } },
    },
  },
  enteredBy: { select: { id: true, name: true, active: true } },
} satisfies Prisma.MetricEventSelect;

const metricMappings = [
  ["NEW_FANS", "newFans", "quantity"],
  ["EFFECTIVE_FANS", "effectiveFans", "quantity"],
  ["NO_NUMBER", "noNumber", "quantity"],
  ["DUPLICATE_FANS", "duplicateFans", "quantity"],
  ["REPLIES", "replies", "quantity"],
  ["GROUP_JOIN", "groupJoin", "quantity"],
  ["GROUP_LEAVE", "groupLeave", "quantity"],
  ["EXPERT_INTRO", "expertIntro", "quantity"],
  ["REGISTRATION", "registration", "quantity"],
  ["ORDER", "order", "quantity"],
  ["RECHARGE", "rechargeCents", "amountCents"],
  ["WITHDRAWAL", "withdrawalCents", "amountCents"],
  ["CHANNEL_PERFORMANCE", "channelPerformanceCents", "amountCents"],
] as const;

const targetBatchResponse = (message: string) => NextResponse.json({
  error: "请重新选择来源",
  fields: { batchId: [message] },
}, { status: 400 });

function validationResponse(error: ZodError) {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path.join(".") || "request";
    fields[field] = [...(fields[field] ?? []), issue.message];
  }
  return NextResponse.json({ error: "请检查填写内容", fields }, { status: 400 });
}

function readFilter(url: URL, name: string) {
  return url.searchParams.get(name)?.trim() || undefined;
}

export async function GET(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }

  const url = new URL(request.url);
  if (hasOversizedQueryValue(url.searchParams))
    return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  if (!["ADMIN", "LEAD", "RECEPTION"].includes(user.role))
    return authorizationDenied(user, "当前岗位无权查看历史记录");
  const occurredOn = readFilter(url, "occurredOn");
  const sourceDate = readFilter(url, "sourceDate");
  const channelId = readFilter(url, "channelId");
  const enteredById = readFilter(url, "enteredById");
  const filters: Prisma.MetricEventWhereInput = {
    ...(occurredOn ? { occurredOn } : {}),
    ...(enteredById ? { enteredById } : {}),
    ...(sourceDate || channelId
      ? { batch: { ...(sourceDate ? { sourceDate } : {}), ...(channelId ? { channelId } : {}) } }
      : {}),
  };
  const scope: Prisma.MetricEventWhereInput = user.role === "LEAD"
    ? { batch: { groupId: user.groupId ?? "" } }
    : user.role === "RECEPTION"
      ? { enteredById: user.id }
      : {};
  const events = await db.metricEvent.findMany({
    // 作废数据保留在审计/客户时间线中，但不能混进可编辑的历史业务汇总。
    where: { AND: [filters, scope, { voidedAt: null }] },
    select: {
      id: true,
      occurredOn: true,
      kind: true,
      quantity: true,
      amountCents: true,
      batch: {
        select: {
          sourceDate: true,
          group: { select: { id: true, name: true } },
          channel: { select: { id: true, name: true, active: true } },
        },
      },
      enteredBy: { select: { id: true, name: true, active: true } },
    },
    orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({ events });
}

export async function PATCH(request: Request) {
  let sessionUser;
  try {
    sessionUser = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }

  try {
    const input = parseHistoryGroupUpdate(await readLimitedJson(request, API_LIMITS.historyBodyBytes));
    const settings = await getSystemSettings();
    const timezone = await resolveUserBusinessTimezone(sessionUser, settings.timezone);
    const dateError = entryDateError(input.occurredOn, localDateYYYYMMDD(new Date(), timezone), "业务日期");
    if (dateError) return NextResponse.json({ error: "请检查填写内容", fields: { occurredOn: [dateError] } }, { status: 400 });
    const result = await db.$transaction(async (transaction) => {
      const actor = await transaction.user.findUnique({
        where: { id: sessionUser.id },
        select: { id: true, role: true, groupId: true, active: true },
      });
      if (!actor?.active || actor.role !== "RECEPTION") return { status: 403 as const, error: "FORBIDDEN" as const };

      const submittedEvents = await transaction.metricEvent.findMany({
        where: { id: { in: input.eventIds } },
        select: { id: true, enteredById: true, occurredOn: true, batchId: true, derivedFromLedger: true },
      });
      const firstSubmitted = submittedEvents[0];
      const submittedOneGroup = firstSubmitted
        && submittedEvents.length === input.eventIds.length
        && submittedEvents.every((event) =>
          event.enteredById === firstSubmitted.enteredById
          && event.occurredOn === firstSubmitted.occurredOn
          && event.batchId === firstSubmitted.batchId,
        );
      if (!submittedOneGroup || firstSubmitted.enteredById !== actor.id) {
        return { status: 403 as const, error: "FORBIDDEN" as const };
      }
      if (submittedEvents.some((event) => event.derivedFromLedger)) {
        return { status: 409 as const, error: "LEDGER_MANAGED" as const };
      }

      const originalEvents = await transaction.metricEvent.findMany({
        where: {
          enteredById: firstSubmitted.enteredById,
          occurredOn: firstSubmitted.occurredOn,
          batchId: firstSubmitted.batchId,
        },
        select: historyEventSelect,
      });
      if (buildHistoryGroupFingerprint(originalEvents) !== input.fingerprint) {
        return { status: 409 as const, error: "STALE" as const };
      }

      const [originalGroup] = groupHistoryEvents(originalEvents);
      if (!originalGroup) return { status: 403 as const, error: "FORBIDDEN" as const };

      const targetBatch = await transaction.sourceBatch.findUnique({
        where: { id: input.batchId },
        include: { group: true, channel: true },
      });
      if (!targetBatch) return { status: 400 as const, error: "MISSING_BATCH" as const };

      const changesBatch = input.batchId !== firstSubmitted.batchId;
      const changesDate = input.occurredOn !== firstSubmitted.occurredOn;
      const targetIsActive = targetBatch.group.active && targetBatch.channel.active;
      if (!targetIsActive && (changesBatch || changesDate)) {
        return { status: 400 as const, error: "INACTIVE_BATCH" as const };
      }
      if (changesBatch && (!actor.groupId || actor.groupId !== targetBatch.groupId)) {
        return { status: 403 as const, error: "FORBIDDEN" as const };
      }

      if (changesBatch || changesDate) {
        const collision = await transaction.metricEvent.findFirst({
          where: {
            enteredById: actor.id,
            occurredOn: input.occurredOn,
            batchId: input.batchId,
            id: { notIn: originalEvents.map((event) => event.id) },
          },
          select: { id: true },
        });
        if (collision) return { status: 409 as const, error: "COLLISION" as const };
      }

      for (const [kind, metricField, valueField] of metricMappings) {
        const nextTotal = input.metrics[metricField];
        const existing = originalEvents
          .filter((event) => event.kind === kind)
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
        const first = existing[0];
        const valueData = valueField === "quantity"
          ? { quantity: nextTotal, amountCents: null }
          : { quantity: null, amountCents: nextTotal };

        if (first) {
          await transaction.metricEvent.update({
            where: { id: first.id },
            data: {
              batchId: input.batchId,
              occurredOn: input.occurredOn,
              ...valueData,
            },
          });
          const extraIds = existing.slice(1).map((event) => event.id);
          if (extraIds.length) {
            const zeroValueData = valueField === "quantity"
              ? { quantity: 0, amountCents: null }
              : { quantity: null, amountCents: 0 };
            await transaction.metricEvent.updateMany({
              where: { id: { in: extraIds } },
              data: {
                batchId: input.batchId,
                occurredOn: input.occurredOn,
                ...zeroValueData,
              },
            });
          }
        } else if (nextTotal > 0) {
          await transaction.metricEvent.create({
            data: {
              batchId: input.batchId,
              enteredById: actor.id,
              occurredOn: input.occurredOn,
              kind,
              ...valueData,
            },
          });
        }
      }

      const changedMetrics = Object.fromEntries(
        metricMappings.flatMap(([, metricField]) => {
          const from = originalGroup.metrics[metricField];
          const to = input.metrics[metricField];
          return from === to ? [] : [[metricField, { from, to }]];
        }),
      ) as Partial<Record<keyof HistoryMetricTotals, { from: number; to: number }>>;
      await recordAudit(transaction, {
        actorId: actor.id,
        action: "HISTORY_GROUP_UPDATED",
        entityType: "HistoryGroup",
        entityId: originalGroup.key,
        summary: {
          occurredOn: { from: firstSubmitted.occurredOn, to: input.occurredOn },
          batchId: { from: firstSubmitted.batchId, to: input.batchId },
          metrics: changedMetrics,
        },
      });
      await touchDailyEntryConfirmations(transaction, actor.id, [firstSubmitted.occurredOn, input.occurredOn]);

      const normalizedEvents = await transaction.metricEvent.findMany({
        where: {
          enteredById: actor.id,
          occurredOn: input.occurredOn,
          batchId: input.batchId,
        },
        select: historyEventSelect,
      });
      const [group] = groupHistoryEvents(normalizedEvents);
      return { status: 200 as const, group };
    }, { isolationLevel: "Serializable" });

    if (result.status === 200) return NextResponse.json({ group: result.group });
    if (result.error === "FORBIDDEN") return authorizationDenied(sessionUser, "无权修改该记录");
    if (result.error === "STALE") {
      return NextResponse.json(
        { error: "这组数据已被更新，请刷新后再修改" },
        { status: 409 },
      );
    }
    if (result.error === "COLLISION") {
      return NextResponse.json(
        { error: "目标日期和来源批次已有记录，请打开已有记录修改" },
        { status: 409 },
      );
    }
    if (result.error === "LEDGER_MANAGED") {
      return NextResponse.json(
        { error: "这组数据来自手机号客户账本，请到对应客户记录中修改" },
        { status: 409 },
      );
    }
    return targetBatchResponse(result.error === "MISSING_BATCH" ? "来源批次不存在" : "来源批次已停用");
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return tooLargeResponse(error);
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    }
    if (error instanceof ZodError) return validationResponse(error);
    throw error;
  }
}
