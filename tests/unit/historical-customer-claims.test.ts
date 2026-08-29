import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { hashPassword } from "../../src/lib/auth";
import { GET as loadClaimContext, POST as claimHistoricalCustomer } from "../../src/app/api/historical-claims/route";
import { GET as listClaims, POST as reviewClaim } from "../../src/app/api/historical-claims/review/route";
import { loadCanonicalMetricEvents } from "../../src/lib/analytics/canonical-events";
import { executeCustomerWorkflow } from "../../src/lib/customer-workflow/service";
import { db } from "../../src/lib/db";

const prefix = "historical-claim-test-";

afterEach(async () => {
  vi.restoreAllMocks();
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: prefix } }, { actorId: { startsWith: prefix } }] } });
  await db.metricEvent.deleteMany({ where: { batch: { groupId: { startsWith: prefix } } } });
  await db.leadActivity.deleteMany({ where: { lead: { batch: { groupId: { startsWith: prefix } } } } });
  await db.leadCustomer.deleteMany({ where: { batch: { groupId: { startsWith: prefix } } } });
  await db.device.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.sourceBatch.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.channel.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.department.deleteMany({ where: { id: { startsWith: prefix } } });
});

async function fixture() {
  const suffix = randomUUID();
  const departmentId = `${prefix}department-${suffix}`;
  const groupId = `${prefix}group-${suffix}`;
  const channelId = `${prefix}channel-${suffix}`;
  await db.department.create({ data: { id: departmentId, name: `${prefix}部门-${suffix}`, timezone: "America/Los_Angeles" } });
  await db.teamGroup.create({ data: { id: groupId, name: `${prefix}小组-${suffix}`, departmentId } });
  const user = (role: "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT") => db.user.create({ data: {
    id: `${prefix}${role}-${suffix}`, username: `${prefix}${role}-${suffix}`, name: role, role, groupId,
    passwordHash: hashPassword("Historical@56790"),
  } });
  const [lead, reception, groupOperator, expert] = await Promise.all([user("LEAD"), user("RECEPTION"), user("GROUP_OPERATOR"), user("EXPERT")]);
  await db.channel.create({ data: { id: channelId, groupId, name: "历史渠道", normalizedName: `history-${suffix}` } });
  return { groupId, channelId, lead, reception, groupOperator, expert };
}

function claimRequest(input: Record<string, unknown>) {
  return new Request("http://localhost/api/historical-claims", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  });
}

describe.sequential("historical customer claim review", () => {
  it("returns role-scoped v2 form options and the actor's recent claims", async () => {
    const data = await fixture();
    vi.spyOn(auth, "requireUser").mockResolvedValue(data.groupOperator);
    const context = await loadClaimContext(new Request("http://localhost/api/historical-claims?baselineOn=2026-08-20"));
    expect(context.status).toBe(200);
    await expect(context.json()).resolves.toMatchObject({
      baselineOn: "2026-08-20",
      actor: { id: data.groupOperator.id },
      allowedStages: ["JOINED"],
      channels: [{ id: data.channelId, name: "历史渠道" }],
      members: {
        reception: [expect.objectContaining({ id: data.reception.id })],
        groupOperator: [expect.objectContaining({ id: data.groupOperator.id })],
        expert: [expect.objectContaining({ id: data.expert.id })],
      },
      claims: [],
    });
  });

  it("enforces stage ownership and keeps a valid claim locked until its own lead approves it", async () => {
    const data = await fixture();
    vi.spyOn(auth, "requireUser").mockResolvedValue(data.reception);
    const base = {
      channelId: data.channelId,
      receptionOwnerId: data.reception.id,
      groupOperatorOwnerId: data.groupOperator.id,
      baselineOn: "2026-08-20",
    };

    const forbidden = await claimHistoricalCustomer(claimRequest({ ...base, phone: `17${Date.now()}`, baselineStage: "JOINED" }));
    expect(forbidden.status).toBe(403);

    const phone = `16${String(Date.now()).slice(-9)}`;
    const created = await claimHistoricalCustomer(claimRequest({ ...base, phone, baselineStage: "NOT_REPLIED", notes: "旧系统待回复" }));
    expect(created.status).toBe(201);
    const { leadId } = await created.json() as { leadId: string };
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: leadId } })).resolves.toMatchObject({
      invalid: true,
      historicalReviewStatus: "PENDING",
      historicalBaselineStage: "NOT_REPLIED",
      repliedOn: null,
      joinedOn: null,
      expertIntroducedOn: null,
      registeredOn: null,
    });
    await expect(loadCanonicalMetricEvents({ groupIds: [data.groupId] })).resolves.toHaveLength(0);

    vi.mocked(auth.requireUser).mockResolvedValue(data.lead);
    const pending = await listClaims();
    expect(pending.status).toBe(200);
    expect((await pending.json()).claims).toEqual(expect.arrayContaining([expect.objectContaining({ id: leadId, phone })]));
    const approved = await reviewClaim(new Request("http://localhost/api/historical-claims/review", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId, decision: "APPROVE" }),
    }));
    expect(approved.status).toBe(200);
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: leadId } })).resolves.toMatchObject({
      invalid: false,
      historicalReviewStatus: "APPROVED",
      historicalReplyCounted: false,
      historicalJoinCounted: false,
      historicalExpertIntroCounted: false,
      historicalRegistrationCounted: false,
    });
    await expect(loadCanonicalMetricEvents({ groupIds: [data.groupId] })).resolves.toHaveLength(0);

    const device = await db.device.create({ data: { code: `history-device-${leadId}`, groupId: data.groupId, memberId: data.reception.id } });
    await db.leadCustomer.update({ where: { id: leadId }, data: { deviceId: device.id } });
    const progressed = await executeCustomerWorkflow(data.reception, leadId, { action: "reply" }, "2026-08-29");
    expect(progressed.status).toBe(200);
    const facts = await loadCanonicalMetricEvents({ groupIds: [data.groupId] });
    expect(facts.filter((fact) => fact.kind === "REPLIES")).toHaveLength(1);
    expect(facts.filter((fact) => fact.kind === "NEW_FANS" || fact.kind === "EFFECTIVE_FANS")).toHaveLength(0);
  });

  it("lets an expert claim only an expert-stage customer and prevents another group's lead from reviewing it", async () => {
    const data = await fixture();
    const other = await fixture();
    vi.spyOn(auth, "requireUser").mockResolvedValue(data.expert);
    const phone = `15${String(Date.now()).slice(-9)}`;
    const created = await claimHistoricalCustomer(claimRequest({
      phone,
      channelId: data.channelId,
      baselineStage: "REGISTERED",
      baselineOn: "2026-08-18",
      receptionOwnerId: data.reception.id,
      groupOperatorOwnerId: data.groupOperator.id,
      expertOwnerId: data.expert.id,
    }));
    expect(created.status).toBe(201);
    const { leadId } = await created.json() as { leadId: string };

    vi.mocked(auth.requireUser).mockResolvedValue(other.lead);
    const crossGroup = await reviewClaim(new Request("http://localhost/api/historical-claims/review", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId, decision: "APPROVE" }),
    }));
    expect(crossGroup.status).toBe(404);

    vi.mocked(auth.requireUser).mockResolvedValue(data.lead);
    const approved = await reviewClaim(new Request("http://localhost/api/historical-claims/review", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId, decision: "APPROVE" }),
    }));
    expect(approved.status).toBe(200);
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: leadId } })).resolves.toMatchObject({
      invalid: false,
      replyStatus: "REPLIED",
      groupStatus: "JOINED",
      expertWorkflowStage: "PENDING_ORDER",
      registeredOn: "2026-08-18",
      historicalRegistrationCounted: false,
    });
    await expect(loadCanonicalMetricEvents({ groupIds: [data.groupId] })).resolves.toHaveLength(0);
  });

  it("allows an owner who belonged to the group on the historical date even after a later transfer", async () => {
    const data = await fixture();
    const currentGroup = await fixture();
    await db.userPosition.create({ data: {
      userId: currentGroup.reception.id,
      position: "RECEPTION",
      groupId: data.groupId,
      effectiveFrom: "2026-08-01",
      effectiveTo: "2026-08-20",
      reason: "历史归属测试",
    } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(data.expert);
    const response = await claimHistoricalCustomer(claimRequest({
      phone: `14${String(Date.now()).slice(-9)}`,
      channelId: data.channelId,
      baselineStage: "INTRODUCED",
      baselineOn: "2026-08-18",
      receptionOwnerId: currentGroup.reception.id,
      groupOperatorOwnerId: data.groupOperator.id,
      expertOwnerId: data.expert.id,
    }));
    expect(response.status).toBe(201);
  });
});
