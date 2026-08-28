import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../src/lib/db";
import { calculateBatchTotals } from "../../src/lib/metrics";
import { loadCanonicalMetricEvents } from "../../src/lib/analytics/canonical-events";
import { loadRoleRankings } from "../../src/lib/analytics/role-rankings";

const isolatedDatabase = vi.hoisted(() => ({ directory: "" }));

vi.mock("../../src/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { execFileSync } = await import("node:child_process");
  const { closeSync, mkdtempSync, openSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "canonical-ledger-"));
  const databasePath = join(directory, "test.db");
  closeSync(openSync(databasePath, "w"));
  const databaseUrl = `file:${databasePath}`;
  execFileSync(
    process.execPath,
    [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl } },
  );
  isolatedDatabase.directory = directory;
  return { db: new PrismaClient({ datasourceUrl: databaseUrl }) };
});

const ids = {
  group: "canonical-group",
  channel: "canonical-channel",
  reception: "canonical-reception",
  attribution: "canonical-attribution",
  batch: "canonical-batch",
};

beforeAll(async () => {
  await db.teamGroup.create({ data: { id: ids.group, name: "统一口径组" } });
  await db.channel.create({
    data: {
      id: ids.channel,
      groupId: ids.group,
      name: "统一口径渠道",
      normalizedName: "统一口径渠道",
    },
  });
  await db.user.create({
    data: {
      id: ids.reception,
      username: ids.reception,
      name: "前台接粉",
      role: "RECEPTION",
      groupId: ids.group,
    },
  });
  await db.user.create({
    data: {
      id: ids.attribution,
      username: ids.attribution,
      name: "代理线归属人",
      role: "GROUP_OPERATOR",
      groupId: ids.group,
    },
  });
  await db.sourceBatch.create({
    data: {
      id: ids.batch,
      groupId: ids.group,
      channelId: ids.channel,
      sourceDate: "2026-08-01",
    },
  });

  const validLead = await db.leadCustomer.create({
    data: {
      phone: "13800001001",
      batchId: ids.batch,
      ownerId: ids.reception,
      attributionOwnerId: ids.attribution,
      repliedOn: "2026-08-02",
      replyStatus: "REPLIED",
      joinedOn: "2026-08-03",
      groupStatus: "JOINED",
      expertIntroducedOn: "2026-08-04",
      registeredOn: "2026-08-05",
    },
  });
  await db.leadCustomer.create({
    data: {
      phone: "13800001002",
      batchId: ids.batch,
      ownerId: ids.reception,
      invalid: true,
      invalidReason: "号码错误",
      repliedOn: "2026-08-02",
      replyStatus: "REPLIED",
      joinedOn: "2026-08-03",
      groupStatus: "JOINED",
    },
  });
  const order = await db.customerOrder.create({
    data: {
      phone: validLead.phone,
      batchId: ids.batch,
      enteredById: ids.reception,
      leadId: validLead.id,
      openedOn: "2026-08-06",
      initialDepositCents: 50_000,
    },
  });
  await db.metricEvent.createMany({
    data: [
      {
        batchId: ids.batch,
        enteredById: ids.reception,
        occurredOn: "2026-08-02",
        kind: "REPLIES",
        quantity: 99,
        derivedFromLedger: true,
      },
      {
        batchId: ids.batch,
        enteredById: ids.reception,
        occurredOn: "2026-08-07",
        kind: "RECHARGE",
        amountCents: 20_000,
        customerOrderId: order.id,
        continuationNumber: 1,
        derivedFromLedger: true,
      },
      {
        batchId: ids.batch,
        enteredById: ids.reception,
        occurredOn: "2026-08-08",
        kind: "WITHDRAWAL",
        amountCents: 10_000,
        customerOrderId: order.id,
        derivedFromLedger: true,
      },
    ],
  });
});

afterAll(async () => {
  await db.$disconnect();
  if (isolatedDatabase.directory) {
    const { rm } = await import("node:fs/promises");
    await rm(isolatedDatabase.directory, { recursive: true, force: true });
  }
});

describe("canonical customer ledger", () => {
  it("attributes every later funnel and finance event to the selected fan owner, not the intake operator", async () => {
    const events = await loadCanonicalMetricEvents({
      groupIds: [ids.group],
      memberId: ids.attribution,
      sourceDateFrom: "2026-08-01",
      sourceDateTo: "2026-08-01",
      occurredOnTo: "2026-08-14",
    });

    expect(events.map((event) => event.kind)).toEqual(expect.arrayContaining([
      "NEW_FANS", "EFFECTIVE_FANS", "REPLIES", "GROUP_JOIN", "EXPERT_INTRO",
      "REGISTRATION", "ORDER", "RECHARGE", "WITHDRAWAL",
    ]));
    expect(events.every((event) => event.enteredById === ids.attribution)).toBe(true);
  });

  it("keeps the finance attribution line on the selected fan owner even when another member actually received the customer", async () => {
    const result = await loadRoleRankings({
      groupIds: [ids.group],
      sourceDateFrom: "2026-08-01",
      sourceDateTo: "2026-08-01",
      today: "2026-08-14",
    });

    expect(result.reception.find((row) => row.id === ids.reception)).toMatchObject({ valid: 1, orders: 1 });
    expect(result.fanOwners?.find((row) => row.id === ids.attribution)).toMatchObject({
      valid: 1,
      replied: 1,
      joined: 1,
      registered: 1,
      orders: 1,
      depositCents: 70_000,
      withdrawalCents: 10_000,
    });
    expect(result.fanOwners?.find((row) => row.id === ids.reception)?.valid ?? 0).toBe(0);
  });

  it("derives funnel and finance totals from phone-level customer state", async () => {
    const events = await loadCanonicalMetricEvents({
      groupIds: [ids.group],
      sourceDateFrom: "2026-08-01",
      sourceDateTo: "2026-08-01",
      occurredOnTo: "2026-08-14",
    });
    const totals = calculateBatchTotals(events);

    expect(totals).toMatchObject({
      newFans: 2,
      effectiveFans: 1,
      replies: 1,
      groupJoin: 1,
      expertIntro: 1,
      registration: 1,
      orders: 1,
      rechargeCents: 70_000,
      withdrawalCents: 10_000,
    });
    expect(events.some((event) => event.kind === "REPLIES" && event.quantity === 99)).toBe(false);
  });

  it("keeps every leave in stock totals but uses only day 1–8 leaves for the leave rate", async () => {
    const batchId = "canonical-leave-rate";
    await db.sourceBatch.create({ data: { id: batchId, groupId: ids.group, channelId: ids.channel, sourceDate: "2026-08-10" } });
    await db.leadCustomer.createMany({ data: [
      { phone: "13800001801", batchId, ownerId: ids.reception, joinedOn: "2026-08-10", leftOn: "2026-08-14", groupStatus: "LEFT" },
      { phone: "13800001802", batchId, ownerId: ids.reception, joinedOn: "2026-08-10", leftOn: "2026-08-23", groupStatus: "LEFT" },
    ] });

    const totals = calculateBatchTotals(await loadCanonicalMetricEvents({ groupIds: [ids.group], batchId, occurredOnTo: "2026-08-31" }));
    expect(totals).toMatchObject({ groupJoin: 2, groupLeave: 2, abnormalGroupLeave: 1, inGroup: 0 });
    expect(totals.abnormalGroupLeave! / totals.groupJoin).toBe(0.5);
  });

  it("does not resurrect compatibility totals after the last customer is deleted", async () => {
    const batchId = "canonical-deleted-last-lead";
    await db.sourceBatch.create({
      data: {
        id: batchId,
        groupId: ids.group,
        channelId: ids.channel,
        sourceDate: "2026-08-09",
      },
    });
    const lead = await db.leadCustomer.create({
      data: {
        phone: "13800001999",
        batchId,
        ownerId: ids.reception,
      },
    });
    await db.metricEvent.create({
      data: {
        batchId,
        enteredById: ids.reception,
        occurredOn: "2026-08-09",
        kind: "NEW_FANS",
        quantity: 1,
        derivedFromLedger: true,
      },
    });

    const before = calculateBatchTotals(await loadCanonicalMetricEvents({
      groupIds: [ids.group],
      batchId,
      occurredOnTo: "2026-08-14",
    }));
    expect(before.newFans).toBe(1);

    await db.leadCustomer.delete({ where: { id: lead.id } });
    const after = calculateBatchTotals(await loadCanonicalMetricEvents({
      groupIds: [ids.group],
      batchId,
      occurredOnTo: "2026-08-14",
    }));
    expect(after.newFans).toBe(0);
  });

  it("keeps genuine historical aggregate events after the owner changes role", async () => {
    const batchId = "canonical-transferred-history-batch";
    await db.sourceBatch.create({
      data: {
        id: batchId,
        groupId: ids.group,
        channelId: ids.channel,
        sourceDate: "2026-07-25",
        isHistoricalRecord: true,
      },
    });
    await db.metricEvent.createMany({
      data: [
        { batchId, enteredById: ids.attribution, occurredOn: "2026-07-25", kind: "NEW_FANS", quantity: 47 },
        { batchId, enteredById: ids.attribution, occurredOn: "2026-07-25", kind: "EFFECTIVE_FANS", quantity: 44 },
        { batchId, enteredById: ids.attribution, occurredOn: "2026-07-25", kind: "REPLIES", quantity: 12 },
        { batchId, enteredById: ids.attribution, occurredOn: "2026-07-25", kind: "EXPERT_INTRO", quantity: 2 },
      ],
    });

    const totals = calculateBatchTotals(await loadCanonicalMetricEvents({
      groupIds: [ids.group],
      batchId,
      occurredOnTo: "2026-08-14",
    }));

    expect(totals).toMatchObject({ newFans: 47, effectiveFans: 44, replies: 12, expertIntro: 2 });
  });

  it("keeps genuine legacy order events that have no phone-ledger customer", async () => {
    const batchId = "canonical-legacy-order-batch";
    await db.sourceBatch.create({
      data: {
        id: batchId,
        groupId: ids.group,
        channelId: ids.channel,
        sourceDate: "2026-07-01",
      },
    });
    const order = await db.customerOrder.create({
      data: {
        phone: "13800001888",
        batchId,
        enteredById: ids.reception,
        openedOn: "2026-07-02",
        initialDepositCents: 12_300,
      },
    });
    await db.metricEvent.createMany({
      data: [
        {
          batchId,
          enteredById: ids.reception,
          occurredOn: "2026-07-02",
          kind: "ORDER",
          quantity: 1,
          customerOrderId: order.id,
        },
        {
          batchId,
          enteredById: ids.reception,
          occurredOn: "2026-07-02",
          kind: "RECHARGE",
          amountCents: 12_300,
          customerOrderId: order.id,
        },
      ],
    });

    const totals = calculateBatchTotals(await loadCanonicalMetricEvents({
      groupIds: [ids.group],
      batchId,
      occurredOnTo: "2026-08-14",
    }));
    expect(totals.orders).toBe(1);
    expect(totals.rechargeCents).toBe(12_300);
  });
});
