import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { GET, POST } from "../../src/app/api/legacy-customers/route";
import { hashPassword } from "../../src/lib/auth";
import { loadCanonicalMetricEvents } from "../../src/lib/analytics/canonical-events";
import { buildBasicCustomerMutation } from "../../src/lib/customer-workflow/mutations";
import { normalizeCustomerPhone } from "../../src/lib/entry-ledger";

const prefix = "legacy-customer-test-";

afterEach(async () => {
  vi.restoreAllMocks();
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: prefix } }, { actorId: { startsWith: prefix } }] } });
  await db.dailyStatRevision.deleteMany({ where: { entry: { groupId: { startsWith: prefix } } } });
  await db.dailyStatEntry.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.metricEvent.deleteMany({ where: { batch: { groupId: { startsWith: prefix } } } });
  await db.customerOrder.deleteMany({ where: { batch: { groupId: { startsWith: prefix } } } });
  await db.leadCustomer.deleteMany({ where: { batch: { groupId: { startsWith: prefix } } } });
  await db.sourceBatch.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.channel.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.device.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.department.deleteMany({ where: { id: { startsWith: prefix } } });
});

describe.sequential("legacy customer entry", () => {
  it("does not let correction actions erase the imported historical baseline", () => {
    const lead = {
      invalid: false, isHistoricalRecord: true, historicalBaselineStage: "JOINED", deviceId: null,
      repliedOn: "2026-08-20", followUpCount: 0, groupStatus: "JOINED" as const, joinedOn: "2026-08-20",
      expertIntroducedOn: null, expertContactedOn: null, registeredOn: null, customerOrder: null,
    };
    expect(buildBasicCustomerMutation({ action: "undoReply", reason: "误点" }, lead, "2026-08-26")).toMatchObject({ status: 400, error: expect.stringContaining("历史底账") });
    expect(buildBasicCustomerMutation({ action: "undoJoinGroup", reason: "误点" }, lead, "2026-08-26")).toMatchObject({ status: 400, error: expect.stringContaining("历史底账") });
  });

  it("opens the unified endpoint to frontline roles but validates the request body", async () => {
    const suffix = randomUUID();
    const departmentId = `${prefix}department-${suffix}`;
    const groupId = `${prefix}group-${suffix}`;
    await db.department.create({ data: { id: departmentId, name: `${prefix}公司-${suffix}` } });
    await db.teamGroup.create({ data: { id: groupId, name: `${prefix}小组-${suffix}`, departmentId } });
    const createUser = (role: "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT", name: string) => db.user.create({ data: { id: `${prefix}${role}-${suffix}`, username: `${prefix}${role}-${suffix}`, name, role, groupId, passwordHash: hashPassword("Legacy@56790") } });
    const [lead, reception, expert] = await Promise.all([
      createUser("LEAD", "组长"), createUser("RECEPTION", "接粉员"), createUser("EXPERT", "专家"),
    ]);
    vi.spyOn(auth, "requireUser").mockResolvedValue(lead);

    const response = await POST(new Request("http://localhost/api/legacy-customers", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toHaveProperty("error");
    await expect(db.leadCustomer.count({ where: { batch: { groupId } } })).resolves.toBe(0);
  });

  it("records post-cutover customer progress without changing the daily-stat ledger", async () => {
    const suffix = randomUUID();
    const departmentId = `${prefix}department-${suffix}`;
    const groupId = `${prefix}group-${suffix}`;
    const channelId = `${prefix}channel-${suffix}`;
    await db.department.create({ data: { id: departmentId, name: `${prefix}公司-${suffix}`, timezone: "America/Los_Angeles" } });
    await db.teamGroup.create({ data: { id: groupId, name: `${prefix}小组-${suffix}`, departmentId } });
    const createUser = (role: "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT", name: string) => db.user.create({ data: { id: `${prefix}${role}-${suffix}`, username: `${prefix}${role}-${suffix}`, name, role, groupId, passwordHash: hashPassword("Legacy@56790") } });
    const [lead, reception, operator, expert] = await Promise.all([
      createUser("LEAD", "组长"), createUser("RECEPTION", "接粉员"), createUser("GROUP_OPERATOR", "炒群员"), createUser("EXPERT", "专家"),
    ]);
    await db.channel.create({ data: { id: channelId, groupId, name: "历史渠道", normalizedName: `history-${suffix}` } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(reception);

    const phone = `19${suffix.replace(/\D/g, "").padEnd(9, "0").slice(0, 9)}`;
    const response = await POST(new Request("http://localhost/api/legacy-customers", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        phone, channelId, receptionOwnerId: reception.id, groupOperatorOwnerId: operator.id,
        sourceDate: "2026-08-18", baselineStage: "NOT_REPLIED", baselineOn: "2026-08-20", currentEvent: "JOINED", occurredOn: "2026-08-26",
      }),
    }));
    expect(response.status).toBe(201);
    const saved = await db.leadCustomer.findUniqueOrThrow({ where: { phone: normalizeCustomerPhone(phone) }, include: { activities: true } });
    expect(saved).toMatchObject({
      isHistoricalRecord: true, historicalBaselineStage: "NOT_REPLIED",
      historicalReplyCounted: true, historicalJoinCounted: true,
      historicalExpertIntroCounted: false, replyStatus: "REPLIED", groupStatus: "JOINED",
    });
    expect(saved.activities.map((activity) => activity.kind).sort()).toEqual(["JOINED_GROUP", "REPLIED"]);

    const facts = await loadCanonicalMetricEvents({ groupIds: [groupId] });
    expect(facts.filter((fact) => fact.kind === "NEW_FANS" || fact.kind === "EFFECTIVE_FANS")).toHaveLength(0);
    expect(facts.filter((fact) => fact.kind === "REPLIES")).toHaveLength(1);
    expect(facts.filter((fact) => fact.kind === "GROUP_JOIN")).toHaveLength(1);
    await expect(db.dailyStatEntry.count({ where: { groupId } })).resolves.toBe(0);
    await expect(db.sourceBatch.findFirstOrThrow({ where: { groupId } })).resolves.toMatchObject({ sourceDate: "2026-08-18" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: saved.id } });
    expect(audit.summary).not.toContain(phone);
    expect(lead.id).toBeTruthy();
    expect(expert.id).toBeTruthy();
  });

  it("records an old customer's order today without backfilling its earlier funnel", async () => {
    const suffix = randomUUID();
    const departmentId = `${prefix}department-${suffix}`;
    const groupId = `${prefix}group-${suffix}`;
    const channelId = `${prefix}channel-${suffix}`;
    await db.department.create({ data: { id: departmentId, name: `${prefix}公司-${suffix}`, timezone: "America/Los_Angeles" } });
    await db.teamGroup.create({ data: { id: groupId, name: `${prefix}小组-${suffix}`, departmentId } });
    const createUser = (role: "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT", name: string) => db.user.create({ data: { id: `${prefix}${role}-${suffix}`, username: `${prefix}${role}-${suffix}`, name, role, groupId, passwordHash: hashPassword("Legacy@56790") } });
    const [reception, operator, expert] = await Promise.all([
      createUser("RECEPTION", "接粉员"), createUser("GROUP_OPERATOR", "炒群员"), createUser("EXPERT", "专家"),
    ]);
    await db.channel.create({ data: { id: channelId, groupId, name: "历史渠道", normalizedName: `history-order-${suffix}` } });
    const authSpy = vi.spyOn(auth, "requireUser").mockResolvedValue(reception);

    const phone = `17${suffix.replace(/\D/g, "").padEnd(9, "0").slice(0, 9)}`;
    const requestBody = {
      phone, channelId, receptionOwnerId: reception.id, groupOperatorOwnerId: operator.id, expertOwnerId: expert.id,
      baselineStage: "REGISTERED", baselineOn: "2026-08-18", currentEvent: "ORDERED", occurredOn: "2026-08-26",
      initialDepositCents: 100_000, initialDepositMethod: "CRYPTO",
    };
    const denied = await POST(new Request("http://localhost/api/legacy-customers", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        ...requestBody,
      }),
    }));
    expect(denied.status).toBe(403);
    authSpy.mockResolvedValue(expert);
    const response = await POST(new Request("http://localhost/api/legacy-customers", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestBody),
    }));
    expect(response.status).toBe(201);

    const facts = await loadCanonicalMetricEvents({ groupIds: [groupId] });
    expect(facts.filter((fact) => ["NEW_FANS", "EFFECTIVE_FANS", "REPLIES", "GROUP_JOIN", "EXPERT_INTRO", "REGISTRATION"].includes(fact.kind))).toHaveLength(0);
    expect(facts.filter((fact) => fact.kind === "ORDER")).toMatchObject([{ occurredOn: "2026-08-26", quantity: 1 }]);
    expect(facts.filter((fact) => fact.kind === "RECHARGE")).toMatchObject([{ occurredOn: "2026-08-26", amountCents: 100_000 }]);
    await expect(db.dailyStatEntry.count({ where: { groupId } })).resolves.toBe(0);
  });

  it("records only today's recharge for a customer who opened before the system", async () => {
    const suffix = randomUUID();
    const departmentId = `${prefix}department-${suffix}`;
    const groupId = `${prefix}group-${suffix}`;
    const channelId = `${prefix}channel-${suffix}`;
    await db.department.create({ data: { id: departmentId, name: `${prefix}公司-${suffix}` } });
    await db.teamGroup.create({ data: { id: groupId, name: `${prefix}小组-${suffix}`, departmentId } });
    const createUser = (role: "RECEPTION" | "GROUP_OPERATOR" | "EXPERT", name: string) => db.user.create({ data: { id: `${prefix}${role}-${suffix}`, username: `${prefix}${role}-${suffix}`, name, role, groupId, passwordHash: hashPassword("Legacy@56790") } });
    const [reception, operator, expert] = await Promise.all([createUser("RECEPTION", "接粉员"), createUser("GROUP_OPERATOR", "炒群员"), createUser("EXPERT", "专家")]);
    await db.channel.create({ data: { id: channelId, groupId, name: "历史渠道", normalizedName: `history-recharge-${suffix}` } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(expert);
    const phone = `16${suffix.replace(/\D/g, "").padEnd(9, "0").slice(0, 9)}`;
    const response = await POST(new Request("http://localhost/api/legacy-customers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      phone, channelId, receptionOwnerId: reception.id, groupOperatorOwnerId: operator.id, expertOwnerId: expert.id,
      sourceDate: "2026-07-10", baselineStage: "ORDERED", baselineOn: "2026-08-10", currentEvent: "RECHARGE", occurredOn: "2026-09-01",
      amountCents: 50_000, initialDepositMethod: "BANK",
    }) }));
    expect(response.status).toBe(201);
    const order = await db.customerOrder.findUniqueOrThrow({ where: { phone: normalizeCustomerPhone(phone) }, include: { events: true } });
    expect(order).toMatchObject({ isHistoricalBaseline: true, openedOn: "2026-08-10", initialDepositCents: 0 });
    expect(order.events).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "RECHARGE", occurredOn: "2026-09-01", amountCents: 50_000, continuationNumber: 1 })]));
    const facts = await loadCanonicalMetricEvents({ groupIds: [groupId] });
    expect(facts.filter((fact) => fact.kind === "ORDER")).toHaveLength(0);
    expect(facts.filter((fact) => fact.kind === "RECHARGE")).toMatchObject([{ occurredOn: "2026-09-01", amountCents: 50_000 }]);
    await expect(db.dailyStatEntry.count({ where: { groupId, businessDate: "2026-09-01", position: "EXPERT" } })).resolves.toBe(0);
  });

  it("simulates Aug 30 old-fan join, Aug 29 old-fan order, and a prior order recharging on Sep 1", async () => {
    const suffix = randomUUID();
    const departmentId = `${prefix}department-${suffix}`;
    const groupId = `${prefix}group-${suffix}`;
    const channelId = `${prefix}channel-${suffix}`;
    await db.department.create({ data: { id: departmentId, name: `${prefix}组合场景公司-${suffix}`, timezone: "Asia/Shanghai" } });
    await db.teamGroup.create({ data: { id: groupId, name: `${prefix}组合场景小组-${suffix}`, departmentId } });
    const createUser = (role: "RECEPTION" | "GROUP_OPERATOR" | "EXPERT", name: string) => db.user.create({ data: { id: `${prefix}${role}-${suffix}`, username: `${prefix}${role}-${suffix}`, name, role, groupId, passwordHash: hashPassword("Legacy@56790") } });
    const [reception, operator, expert] = await Promise.all([
      createUser("RECEPTION", "接粉员"), createUser("GROUP_OPERATOR", "炒群员"), createUser("EXPERT", "专家"),
    ]);
    await db.channel.create({ data: { id: channelId, groupId, name: "8月底历史渠道", normalizedName: `history-combined-${suffix}` } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(expert);
    const digits = suffix.replace(/\D/g, "").padEnd(9, "0").slice(0, 8);
    const phones = { joined: `15${digits}1`, ordered: `15${digits}2`, recharged: `15${digits}3` };
    const common = { channelId, receptionOwnerId: reception.id, groupOperatorOwnerId: operator.id, expertOwnerId: expert.id };
    const post = (body: Record<string, unknown>) => POST(new Request("http://localhost/api/legacy-customers", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));

    const joined = await post({
      ...common, phone: phones.joined, sourceDate: "2026-08-30", baselineStage: "REPLIED", baselineOn: "2026-08-30",
      currentEvent: "JOINED", occurredOn: "2026-09-01", deviceCode: "TEST-WA-01",
    });
    const ordered = await post({
      ...common, phone: phones.ordered, sourceDate: "2026-08-29", baselineStage: "REGISTERED", baselineOn: "2026-08-31",
      currentEvent: "ORDERED", occurredOn: "2026-09-01", initialDepositCents: 123_400, initialDepositMethod: "CRYPTO",
    });
    const recharged = await post({
      ...common, phone: phones.recharged, sourceDate: "2026-07-15", baselineStage: "ORDERED", baselineOn: "2026-08-29",
      currentEvent: "RECHARGE", occurredOn: "2026-09-01", amountCents: 50_000, initialDepositMethod: "BANK",
    });
    expect([joined.status, ordered.status, recharged.status]).toEqual([201, 201, 201]);

    const saved = await db.leadCustomer.findMany({
      where: { phone: { in: Object.values(phones).map(normalizeCustomerPhone) } },
      include: { batch: true, customerOrder: { include: { events: true } } },
      orderBy: { phone: "asc" },
    });
    expect(saved).toHaveLength(3);
    expect(saved.map((row) => row.batch.sourceDate).sort()).toEqual(["2026-07-15", "2026-08-29", "2026-08-30"]);
    expect(saved.find((row) => row.phone === normalizeCustomerPhone(phones.joined))).toMatchObject({ joinedOn: "2026-09-01", isHistoricalRecord: true });
    expect(saved.find((row) => row.phone === normalizeCustomerPhone(phones.ordered))?.customerOrder).toMatchObject({ openedOn: "2026-09-01", initialDepositCents: 123_400, isHistoricalBaseline: false });
    expect(saved.find((row) => row.phone === normalizeCustomerPhone(phones.recharged))?.customerOrder).toMatchObject({ openedOn: "2026-08-29", initialDepositCents: 0, isHistoricalBaseline: true });
    expect(saved.find((row) => row.phone === normalizeCustomerPhone(phones.recharged))?.customerOrder?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "RECHARGE", occurredOn: "2026-09-01", amountCents: 50_000, continuationNumber: 1 }),
    ]));

    await expect(db.dailyStatEntry.count({ where: { groupId } })).resolves.toBe(0);

    const facts = await loadCanonicalMetricEvents({ groupIds: [groupId] });
    expect(facts.filter((fact) => ["NEW_FANS", "EFFECTIVE_FANS"].includes(fact.kind))).toHaveLength(0);
    expect(facts.filter((fact) => fact.kind === "GROUP_JOIN" && fact.occurredOn === "2026-09-01")).toHaveLength(1);
    expect(facts.filter((fact) => fact.kind === "ORDER" && fact.occurredOn === "2026-09-01")).toHaveLength(1);
    expect(facts.filter((fact) => fact.kind === "RECHARGE" && fact.occurredOn === "2026-09-01")).toHaveLength(2);
  });

  it("keeps cross-team duplicate lookup generic", async () => {
    const suffix = randomUUID();
    const departmentId = `${prefix}department-${suffix}`;
    await db.department.create({ data: { id: departmentId, name: `${prefix}公司-${suffix}` } });
    const [ownGroup, otherGroup] = await Promise.all([
      db.teamGroup.create({ data: { id: `${prefix}own-${suffix}`, name: `甲组-${suffix}`, departmentId } }),
      db.teamGroup.create({ data: { id: `${prefix}other-${suffix}`, name: `乙组-${suffix}`, departmentId } }),
    ]);
    const actor = await db.user.create({ data: { id: `${prefix}actor-${suffix}`, username: `${prefix}actor-${suffix}`, name: "甲组接粉", role: "RECEPTION", groupId: ownGroup.id, passwordHash: hashPassword("Legacy@56790") } });
    const otherOwner = await db.user.create({ data: { id: `${prefix}other-owner-${suffix}`, username: `${prefix}other-owner-${suffix}`, name: "绝不能泄露的乙组姓名", role: "RECEPTION", groupId: otherGroup.id, passwordHash: hashPassword("Legacy@56790") } });
    const channel = await db.channel.create({ data: { id: `${prefix}other-channel-${suffix}`, groupId: otherGroup.id, name: "绝不能泄露的渠道", normalizedName: `other-${suffix}` } });
    const batch = await db.sourceBatch.create({ data: { groupId: otherGroup.id, channelId: channel.id, sourceDate: "2026-08-20" } });
    const phone = `18${suffix.replace(/\D/g, "").padEnd(9, "0").slice(0, 9)}`;
    await db.leadCustomer.create({ data: { phone: normalizeCustomerPhone(phone), batchId: batch.id, ownerId: otherOwner.id, customerName: "绝不能泄露的客户姓名" } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);

    const response = await GET(new Request(`http://localhost/api/legacy-customers?phone=${phone}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ exists: true, sameGroup: false, message: "该号码已存在" });
    expect(JSON.stringify(body)).not.toContain("绝不能泄露");
  });
});
