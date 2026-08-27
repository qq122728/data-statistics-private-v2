import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../../src/lib/db";
import {
  InvalidFanReportError,
  createInvalidFanReport,
  createLeaderInvalidFanSupplement,
  getApprovedInvalidFanTotals,
  reviewInvalidFanReport,
} from "../../src/lib/invalid-fan-reports";

const prefix = "invalid-fan-report-service-";
const ids = {
  group: `${prefix}group`,
  channel: `${prefix}channel`,
  batch: `${prefix}batch`,
  receptionist: `${prefix}receptionist`,
  lead: `${prefix}lead`,
  otherLead: `${prefix}other-lead`,
  otherGroup: `${prefix}other-group`,
};

const receptionActor = { id: ids.receptionist, role: "RECEPTION" as const, groupId: ids.group, active: true };
const leadActor = { id: ids.lead, role: "LEAD" as const, groupId: ids.group, active: true };
const otherLeadActor = { id: ids.otherLead, role: "LEAD" as const, groupId: ids.otherGroup, active: true };

async function seed() {
  await db.teamGroup.createMany({ data: [
    { id: ids.group, name: `${prefix}一组-${randomUUID()}` },
    { id: ids.otherGroup, name: `${prefix}二组-${randomUUID()}` },
  ] });
  await db.user.createMany({ data: [
    { id: ids.receptionist, username: ids.receptionist, name: "接粉员", passwordHash: "test", role: "RECEPTION", groupId: ids.group },
    { id: ids.lead, username: ids.lead, name: "本组组长", passwordHash: "test", role: "LEAD", groupId: ids.group },
    { id: ids.otherLead, username: ids.otherLead, name: "跨组组长", passwordHash: "test", role: "LEAD", groupId: ids.otherGroup },
  ] });
  await db.channel.create({ data: { id: ids.channel, groupId: ids.group, name: `${prefix}渠道`, normalizedName: `${prefix}渠道` } });
  await db.sourceBatch.create({ data: { id: ids.batch, groupId: ids.group, channelId: ids.channel, sourceDate: "2026-08-20" } });
}

afterEach(async () => {
  await db.invalidFanReportAudit.deleteMany({ where: { actorId: { startsWith: prefix } } });
  await db.invalidFanReport.deleteMany({ where: { reporterId: { startsWith: prefix } } });
  await db.sourceBatch.deleteMany({ where: { id: ids.batch } });
  await db.channel.deleteMany({ where: { id: ids.channel, groupId: ids.group } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
});

describe.sequential("invalid fan report approval workflow", () => {
  it("excludes a receptionist report until the group lead approves final counts", async () => {
    await seed();
    const report = await createInvalidFanReport({
      actor: receptionActor,
      batchId: ids.batch,
      counts: { noWsCount: 2, lowAmountCount: 3, collisionCount: 1 },
    });
    expect(report.status).toBe("PENDING");
    expect(report.approvedNoWsCount).toBeNull();

    const approved = await reviewInvalidFanReport({
      actor: leadActor,
      reportId: report.id,
      action: "approve",
      approvedCounts: { noWsCount: 2, lowAmountCount: 4, collisionCount: 1 },
      reason: "核对原始名单后，低金额多 1 位",
    });
    expect(approved).toMatchObject({
      status: "APPROVED",
      approvedNoWsCount: 2,
      approvedLowAmountCount: 4,
      approvedCollisionCount: 1,
      reviewedById: ids.lead,
    });
    await expect(db.invalidFanReportAudit.findMany({ where: { reportId: report.id }, orderBy: { createdAt: "asc" } })).resolves.toMatchObject([
      { action: "REPORTED", actorId: ids.receptionist },
      { action: "CORRECTED", actorId: ids.lead, reason: "核对原始名单后，低金额多 1 位" },
    ]);
  });

  it("blocks a different group lead from approving the report", async () => {
    await seed();
    const report = await createInvalidFanReport({
      actor: receptionActor,
      batchId: ids.batch,
      counts: { noWsCount: 1, lowAmountCount: 0, collisionCount: 0 },
    });
    await expect(reviewInvalidFanReport({
      actor: otherLeadActor,
      reportId: report.id,
      action: "approve",
      approvedCounts: { noWsCount: 1, lowAmountCount: 0, collisionCount: 0 },
    })).rejects.toMatchObject({ status: 403 } satisfies Partial<InvalidFanReportError>);
  });

  it("returns only approved reports to the official statistics query", async () => {
    await seed();
    const report = await createInvalidFanReport({ actor: receptionActor, batchId: ids.batch, counts: { noWsCount: 1, lowAmountCount: 2, collisionCount: 3 } });
    await expect(getApprovedInvalidFanTotals({ batchIds: [ids.batch] })).resolves.toEqual([]);
    await reviewInvalidFanReport({ actor: leadActor, reportId: report.id, action: "approve", approvedCounts: { noWsCount: 1, lowAmountCount: 2, collisionCount: 3 } });
    await expect(getApprovedInvalidFanTotals({ batchIds: [ids.batch] })).resolves.toMatchObject([
      { batchId: ids.batch, reporterId: ids.receptionist, groupId: ids.group, sourceDate: "2026-08-20", noWsCount: 1, lowAmountCount: 2, collisionCount: 3, total: 6 },
    ]);
  });

  it("allows a lead to correct their own prior supplement with a mandatory audit reason", async () => {
    await seed();
    const first = await createLeaderInvalidFanSupplement({
      actor: leadActor,
      batchId: ids.batch,
      counts: { noWsCount: 1, lowAmountCount: 0, collisionCount: 0 },
      reason: "补上漏报的无 WS",
    });
    const corrected = await createLeaderInvalidFanSupplement({
      actor: leadActor,
      batchId: ids.batch,
      counts: { noWsCount: 1, lowAmountCount: 2, collisionCount: 0 },
      reason: "复核后发现还有两位低金额",
    });
    expect(corrected).toMatchObject({ id: first.id, approvedLowAmountCount: 2 });
    await expect(db.invalidFanReportAudit.findMany({ where: { reportId: first.id }, orderBy: { createdAt: "asc" } })).resolves.toMatchObject([
      { action: "SUPPLEMENTED", reason: "补上漏报的无 WS" },
      { action: "CORRECTED", reason: "复核后发现还有两位低金额" },
    ]);
  });
});
