import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { db } from "../db";
import { isPostgresDatabase } from "../database-provider";
import type { ManagementOverview } from "./overview";

export type PerformanceLeaderboardRow = NonNullable<ManagementOverview["groupComparison"]>[number];

type LeaderboardQueryInput = {
  groupIds: string[];
  sourceDateFrom: string;
  sourceDateTo: string;
  today: string;
  channelIds?: string[];
};

type RawLeaderboardRow = {
  groupId: string;
  groupName: string;
  departmentId: string;
  departmentName: string;
  countryCode: string | null;
  orders: bigint | number;
  rechargeCents: bigint | number;
  withdrawalCents: bigint | number;
  newFans: bigint | number;
  effectiveFans: bigint | number;
  replies: bigint | number;
  groupJoin: bigint | number;
  groupLeave: bigint | number;
  abnormalGroupLeave: bigint | number;
  expertIntro: bigint | number;
  expertContacted: bigint | number;
  registration: bigint | number;
  noNumber: bigint | number;
  duplicateFans: bigint | number;
  matureNewFans: bigint | number;
  matureOrders: bigint | number;
};

const number = (value: bigint | number) => Number(value);

export async function queryPerformanceLeaderboard(input: LeaderboardQueryInput): Promise<PerformanceLeaderboardRow[]> {
  if (!input.groupIds.length) return [];
  const matureCutoff = new Date(`${input.today}T00:00:00Z`);
  matureCutoff.setUTCDate(matureCutoff.getUTCDate() - 7);
  const matureThrough = matureCutoff.toISOString().slice(0, 10);
  const groupIds = Prisma.join(input.groupIds);
  const channelCondition = input.channelIds
    ? input.channelIds.length
      ? Prisma.sql`AND batch."channelId" IN (${Prisma.join(input.channelIds)})`
      : Prisma.sql`AND 1 = 0`
    : Prisma.empty;
  const batchMaturityEnd = isPostgresDatabase()
    ? Prisma.sql`(batch."sourceDate"::date + INTERVAL '7 days')::text`
    : Prisma.sql`date(batch."sourceDate", '+7 day')`;
  const abnormalLeaveCondition = isPostgresDatabase()
    ? Prisma.sql`lc."joinedOn" ~ '^\\d{4}-\\d{2}-\\d{2}$' AND lc."leftOn" ~ '^\\d{4}-\\d{2}-\\d{2}$' AND (lc."leftOn"::date - lc."joinedOn"::date) BETWEEN 0 AND 7`
    : Prisma.sql`(julianday(lc."leftOn") - julianday(lc."joinedOn")) BETWEEN 0 AND 7`;

  const rows = await db.$queryRaw<RawLeaderboardRow[]>(Prisma.sql`
    WITH lead_rollup AS (
      SELECT
        batch."groupId" AS "groupId",
        SUM(CASE WHEN batch."isHistoricalRecord" = ${false} AND lc."isHistoricalRecord" = ${false} AND batch."sourceDate" <= ${input.today} THEN 1 ELSE 0 END) AS "newFans",
        SUM(CASE WHEN batch."isHistoricalRecord" = ${false} AND lc."isHistoricalRecord" = ${false} AND lc."invalid" = ${false} AND batch."sourceDate" <= ${input.today} THEN 1 ELSE 0 END) AS "effectiveFans",
        SUM(CASE WHEN batch."isHistoricalRecord" = ${false} AND lc."isHistoricalRecord" = ${false} AND lc."invalid" = ${false} AND lc."repliedOn" IS NOT NULL AND lc."repliedOn" <= ${input.today} THEN 1 ELSE 0 END) AS "replies",
        SUM(CASE WHEN batch."isHistoricalRecord" = ${false} AND lc."isHistoricalRecord" = ${false} AND lc."invalid" = ${false} AND lc."joinedOn" IS NOT NULL AND lc."joinedOn" <= ${input.today} THEN 1 ELSE 0 END) AS "groupJoin",
        SUM(CASE WHEN batch."isHistoricalRecord" = ${false} AND lc."isHistoricalRecord" = ${false} AND lc."invalid" = ${false} AND lc."leftOn" IS NOT NULL AND lc."leftOn" <= ${input.today} THEN 1 ELSE 0 END) AS "groupLeave",
        SUM(CASE WHEN batch."isHistoricalRecord" = ${false} AND lc."isHistoricalRecord" = ${false} AND lc."invalid" = ${false} AND lc."leftOn" IS NOT NULL AND lc."leftOn" <= ${input.today} AND ${abnormalLeaveCondition} THEN 1 ELSE 0 END) AS "abnormalGroupLeave",
        SUM(CASE WHEN batch."isHistoricalRecord" = ${false} AND lc."isHistoricalRecord" = ${false} AND lc."invalid" = ${false} AND lc."expertIntroducedOn" IS NOT NULL AND lc."expertIntroducedOn" <= ${input.today} THEN 1 ELSE 0 END) AS "expertIntro",
        SUM(CASE WHEN batch."isHistoricalRecord" = ${false} AND lc."isHistoricalRecord" = ${false} AND lc."invalid" = ${false} AND lc."registeredOn" IS NOT NULL AND lc."registeredOn" <= ${input.today} THEN 1 ELSE 0 END) AS "registration",
        SUM(CASE WHEN lc."invalid" = ${false} AND orders."id" IS NOT NULL AND orders."openedOn" <= ${input.today} THEN 1 ELSE 0 END) AS "orders",
        SUM(CASE WHEN batch."isHistoricalRecord" = ${false} AND lc."isHistoricalRecord" = ${false} AND batch."sourceDate" <= ${matureThrough} THEN 1 ELSE 0 END) AS "matureNewFans",
        SUM(CASE WHEN batch."isHistoricalRecord" = ${false} AND lc."isHistoricalRecord" = ${false} AND lc."invalid" = ${false} AND orders."id" IS NOT NULL AND batch."sourceDate" <= ${matureThrough} AND orders."openedOn" >= batch."sourceDate" AND orders."openedOn" <= ${batchMaturityEnd} THEN 1 ELSE 0 END) AS "matureOrders"
      FROM "SourceBatch" batch
      INNER JOIN "LeadCustomer" lc ON lc."batchId" = batch."id"
      INNER JOIN "User" owner ON owner."id" = lc."ownerId" AND owner."role" = 'RECEPTION'
      LEFT JOIN "CustomerOrder" orders ON orders."leadId" = lc."id" AND orders."voidedAt" IS NULL
      WHERE batch."groupId" IN (${groupIds})
        ${channelCondition}
        AND batch."sourceDate" >= ${input.sourceDateFrom}
        AND batch."sourceDate" <= ${input.sourceDateTo}
      GROUP BY batch."groupId"
    ),
    ledger_order_finance AS (
      SELECT
        batch."id" AS "batchId",
        batch."groupId" AS "groupId",
        orders."initialDepositCents" + COALESCE((
          SELECT SUM(COALESCE(finance_event."amountCents", 0))
          FROM "CustomerFinanceEvent" finance_event
          WHERE finance_event."customerOrderId" = orders."id"
            AND finance_event."kind" = 'RECHARGE'
            AND finance_event."continuationNumber" IS NOT NULL
            AND finance_event."occurredOn" <= ${input.today}
            AND finance_event."voidedAt" IS NULL
        ), 0) AS "rechargeCents",
        COALESCE((
          SELECT SUM(COALESCE(finance_event."amountCents", 0))
          FROM "CustomerFinanceEvent" finance_event
          WHERE finance_event."customerOrderId" = orders."id"
            AND finance_event."kind" = 'WITHDRAWAL'
            AND finance_event."occurredOn" <= ${input.today}
            AND finance_event."voidedAt" IS NULL
        ), 0) AS "withdrawalCents"
      FROM "SourceBatch" batch
      INNER JOIN "LeadCustomer" lc ON lc."batchId" = batch."id" AND lc."invalid" = ${false}
      INNER JOIN "User" owner ON owner."id" = lc."ownerId" AND owner."role" = 'RECEPTION'
      INNER JOIN "CustomerOrder" orders ON orders."leadId" = lc."id" AND orders."voidedAt" IS NULL
      WHERE batch."groupId" IN (${groupIds})
        ${channelCondition}
        AND batch."sourceDate" >= ${input.sourceDateFrom}
        AND batch."sourceDate" <= ${input.sourceDateTo}
        AND orders."openedOn" <= ${input.today}
    ),
    legacy_batch_finance AS (
      SELECT
        batch."id" AS "batchId",
        batch."groupId" AS "groupId",
        SUM(CASE WHEN events."kind" = 'RECHARGE' THEN COALESCE(events."amountCents", 0) ELSE 0 END) AS "rechargeCents",
        SUM(CASE WHEN events."kind" = 'WITHDRAWAL' THEN COALESCE(events."amountCents", 0) ELSE 0 END) AS "withdrawalCents"
      FROM "SourceBatch" batch
      INNER JOIN "MetricEvent" events ON events."batchId" = batch."id"
      INNER JOIN "User" actor ON actor."id" = events."enteredById"
      WHERE batch."groupId" IN (${groupIds})
        ${channelCondition}
        AND batch."sourceDate" >= ${input.sourceDateFrom}
        AND batch."sourceDate" <= ${input.sourceDateTo}
        AND events."occurredOn" <= ${input.today}
        AND events."kind" IN ('RECHARGE', 'WITHDRAWAL')
        AND events."voidedAt" IS NULL
        AND events."derivedFromLedger" = ${false}
      GROUP BY batch."id", batch."groupId"
    ),
    all_finance AS (
      SELECT * FROM ledger_order_finance
      UNION ALL
      SELECT * FROM legacy_batch_finance
    ),
    finance_rollup AS (
      SELECT
        "groupId",
        SUM("rechargeCents") AS "rechargeCents",
        SUM("withdrawalCents") AS "withdrawalCents"
      FROM all_finance
      GROUP BY "groupId"
    ),
    legacy_rollup AS (
      SELECT
        batch."groupId" AS "groupId",
        SUM(CASE WHEN events."kind" = 'NEW_FANS' THEN COALESCE(events."quantity", 0) ELSE 0 END) AS "newFans",
        SUM(CASE WHEN events."kind" = 'EFFECTIVE_FANS' THEN COALESCE(events."quantity", 0) ELSE 0 END) AS "effectiveFans",
        SUM(CASE WHEN events."kind" = 'REPLIES' THEN COALESCE(events."quantity", 0) ELSE 0 END) AS "replies",
        SUM(CASE WHEN events."kind" = 'GROUP_JOIN' THEN COALESCE(events."quantity", 0) ELSE 0 END) AS "groupJoin",
        SUM(CASE WHEN events."kind" = 'GROUP_LEAVE' THEN COALESCE(events."quantity", 0) ELSE 0 END) AS "groupLeave",
        SUM(CASE WHEN events."kind" = 'ABNORMAL_GROUP_LEAVE' THEN COALESCE(events."quantity", 0) ELSE 0 END) AS "abnormalGroupLeave",
        SUM(CASE WHEN events."kind" = 'EXPERT_INTRO' THEN COALESCE(events."quantity", 0) ELSE 0 END) AS "expertIntro",
        SUM(CASE WHEN events."kind" = 'REGISTRATION' THEN COALESCE(events."quantity", 0) ELSE 0 END) AS "registration",
        SUM(CASE WHEN events."kind" = 'ORDER' THEN COALESCE(events."quantity", 0) ELSE 0 END) AS "orders",
        SUM(CASE WHEN events."kind" = 'NO_NUMBER' THEN COALESCE(events."quantity", 0) ELSE 0 END) AS "noNumber",
        SUM(CASE WHEN events."kind" = 'DUPLICATE_FANS' THEN COALESCE(events."quantity", 0) ELSE 0 END) AS "duplicateFans",
        SUM(CASE WHEN batch."sourceDate" <= ${matureThrough} AND events."occurredOn" >= batch."sourceDate" AND events."occurredOn" <= ${batchMaturityEnd} AND events."kind" = 'NEW_FANS' THEN COALESCE(events."quantity", 0) ELSE 0 END) AS "matureNewFans",
        SUM(CASE WHEN batch."sourceDate" <= ${matureThrough} AND events."occurredOn" >= batch."sourceDate" AND events."occurredOn" <= ${batchMaturityEnd} AND events."kind" = 'ORDER' THEN COALESCE(events."quantity", 0) ELSE 0 END) AS "matureOrders"
      FROM "SourceBatch" batch
      INNER JOIN "MetricEvent" events ON events."batchId" = batch."id"
      INNER JOIN "User" actor ON actor."id" = events."enteredById"
      WHERE batch."groupId" IN (${groupIds})
        ${channelCondition}
        AND batch."sourceDate" >= ${input.sourceDateFrom}
        AND batch."sourceDate" <= ${input.sourceDateTo}
        AND events."occurredOn" <= ${input.today}
        AND events."voidedAt" IS NULL
        AND events."derivedFromLedger" = ${false}
      GROUP BY batch."groupId"
    ),
    approved_invalid_rollup AS (
      SELECT
        batch."groupId" AS "groupId",
        SUM(
          COALESCE(reports."approvedNoWsCount", reports."noWsCount", 0)
          + COALESCE(reports."approvedLowAmountCount", reports."lowAmountCount", 0)
          + COALESCE(reports."approvedCollisionCount", reports."collisionCount", 0)
        ) AS "newFans",
        SUM(COALESCE(reports."approvedNoWsCount", reports."noWsCount", 0)) AS "noNumber",
        SUM(COALESCE(reports."approvedCollisionCount", reports."collisionCount", 0)) AS "duplicateFans",
        SUM(CASE WHEN batch."sourceDate" <= ${matureThrough} THEN
          COALESCE(reports."approvedNoWsCount", reports."noWsCount", 0)
          + COALESCE(reports."approvedLowAmountCount", reports."lowAmountCount", 0)
          + COALESCE(reports."approvedCollisionCount", reports."collisionCount", 0)
          ELSE 0 END) AS "matureNewFans"
      FROM "SourceBatch" batch
      INNER JOIN "InvalidFanReport" reports ON reports."batchId" = batch."id" AND reports."status" = 'APPROVED'
      WHERE batch."groupId" IN (${groupIds})
        ${channelCondition}
        AND batch."sourceDate" >= ${input.sourceDateFrom}
        AND batch."sourceDate" <= ${input.sourceDateTo}
        AND batch."sourceDate" <= ${input.today}
      GROUP BY batch."groupId"
    ),
    contacted_rollup AS (
      SELECT batch."groupId" AS "groupId", COUNT(*) AS "expertContacted"
      FROM "SourceBatch" batch
      INNER JOIN "LeadCustomer" lc ON lc."batchId" = batch."id"
      WHERE batch."groupId" IN (${groupIds})
        ${channelCondition}
        AND batch."sourceDate" >= ${input.sourceDateFrom}
        AND batch."sourceDate" <= ${input.sourceDateTo}
        AND batch."isHistoricalRecord" = ${false}
        AND lc."isHistoricalRecord" = ${false}
        AND lc."invalid" = ${false}
        AND lc."expertContactedOn" IS NOT NULL
        AND lc."expertContactedOn" <= ${input.today}
      GROUP BY batch."groupId"
    )
    SELECT
      groups."id" AS "groupId",
      groups."name" AS "groupName",
      departments."id" AS "departmentId",
      departments."name" AS "departmentName",
      COALESCE(NULLIF(groups."countryCode", ''), departments."countryCode") AS "countryCode",
      COALESCE(leads."orders", 0) + COALESCE(legacy."orders", 0) AS "orders",
      COALESCE(finance."rechargeCents", 0) AS "rechargeCents",
      COALESCE(finance."withdrawalCents", 0) AS "withdrawalCents",
      COALESCE(leads."newFans", 0) + COALESCE(legacy."newFans", 0) + COALESCE(invalid."newFans", 0) AS "newFans",
      COALESCE(leads."effectiveFans", 0) + COALESCE(legacy."effectiveFans", 0) AS "effectiveFans",
      COALESCE(leads."replies", 0) + COALESCE(legacy."replies", 0) AS "replies",
      COALESCE(leads."groupJoin", 0) + COALESCE(legacy."groupJoin", 0) AS "groupJoin",
      COALESCE(leads."groupLeave", 0) + COALESCE(legacy."groupLeave", 0) AS "groupLeave",
      COALESCE(leads."abnormalGroupLeave", 0) + COALESCE(legacy."abnormalGroupLeave", 0) AS "abnormalGroupLeave",
      COALESCE(leads."expertIntro", 0) + COALESCE(legacy."expertIntro", 0) AS "expertIntro",
      COALESCE(contacted."expertContacted", 0) AS "expertContacted",
      COALESCE(leads."registration", 0) + COALESCE(legacy."registration", 0) AS "registration",
      COALESCE(legacy."noNumber", 0) + COALESCE(invalid."noNumber", 0) AS "noNumber",
      COALESCE(legacy."duplicateFans", 0) + COALESCE(invalid."duplicateFans", 0) AS "duplicateFans",
      COALESCE(leads."matureNewFans", 0) + COALESCE(legacy."matureNewFans", 0) + COALESCE(invalid."matureNewFans", 0) AS "matureNewFans",
      COALESCE(leads."matureOrders", 0) + COALESCE(legacy."matureOrders", 0) AS "matureOrders"
    FROM "TeamGroup" groups
    INNER JOIN "Department" departments ON departments."id" = groups."departmentId"
    LEFT JOIN lead_rollup leads ON leads."groupId" = groups."id"
    LEFT JOIN finance_rollup finance ON finance."groupId" = groups."id"
    LEFT JOIN legacy_rollup legacy ON legacy."groupId" = groups."id"
    LEFT JOIN approved_invalid_rollup invalid ON invalid."groupId" = groups."id"
    LEFT JOIN contacted_rollup contacted ON contacted."groupId" = groups."id"
    WHERE groups."id" IN (${groupIds})
    ORDER BY departments."name" ASC, groups."name" ASC
  `);

  return rows.map((row) => {
    const rechargeCents = number(row.rechargeCents);
    const withdrawalCents = number(row.withdrawalCents);
    const netPerformanceCents = rechargeCents - withdrawalCents;
    const matureNewFans = number(row.matureNewFans);
    const matureOrders = number(row.matureOrders);
    const matureOrderRate = matureNewFans ? matureOrders / matureNewFans : null;
    return {
      groupId: row.groupId,
      groupName: row.groupName,
      departmentId: row.departmentId,
      departmentName: row.departmentName,
      countryCode: row.countryCode ? String(row.countryCode) : null,
      orders: number(row.orders),
      rechargeCents,
      withdrawalCents,
      netPerformanceCents,
      newFans: number(row.newFans),
      effectiveFans: number(row.effectiveFans),
      replies: number(row.replies),
      groupJoin: number(row.groupJoin),
      groupLeave: number(row.groupLeave),
      abnormalGroupLeave: number(row.abnormalGroupLeave),
      expertIntro: number(row.expertIntro),
      expertContacted: number(row.expertContacted),
      registration: number(row.registration),
      noNumber: number(row.noNumber),
      duplicateFans: number(row.duplicateFans),
      matureNewFans,
      matureOrders,
      matureOrderRate,
      confirmedPeople: 0,
      activePeople: 0,
      risk: netPerformanceCents < 0
        ? "HIGH"
        : matureOrderRate !== null && matureOrderRate < 0.08 ? "MEDIUM" : "LOW",
    };
  });
}

const loadCachedPerformanceLeaderboard = unstable_cache(
  queryPerformanceLeaderboard,
  ["performance-leaderboard-summary-v1"],
  { revalidate: 45 },
);

export async function loadPerformanceLeaderboard(input: LeaderboardQueryInput) {
  return loadCachedPerformanceLeaderboard({
    ...input,
    groupIds: [...new Set(input.groupIds)].sort(),
    ...(input.channelIds ? { channelIds: [...new Set(input.channelIds)].sort() } : {}),
  });
}
