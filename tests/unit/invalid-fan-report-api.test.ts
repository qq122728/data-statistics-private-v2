import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { POST } from "../../src/app/api/invalid-fan-reports/route";
import { PATCH } from "../../src/app/api/invalid-fan-reports/[reportId]/route";

const prefix = "invalid-fan-report-api-";
const ids = {
  group: `${prefix}group`,
  channel: `${prefix}channel`,
  batch: `${prefix}batch`,
  receptionist: `${prefix}receptionist`,
  lead: `${prefix}lead`,
};

let receptionist: Awaited<ReturnType<typeof db.user.create>>;
let lead: Awaited<ReturnType<typeof db.user.create>>;

async function seed() {
  await db.teamGroup.create({ data: { id: ids.group, name: `${prefix}${randomUUID()}` } });
  receptionist = await db.user.create({ data: { id: ids.receptionist, username: ids.receptionist, name: "接粉员", passwordHash: "test", role: "RECEPTION", groupId: ids.group } });
  lead = await db.user.create({ data: { id: ids.lead, username: ids.lead, name: "组长", passwordHash: "test", role: "LEAD", groupId: ids.group } });
  await db.channel.create({ data: { id: ids.channel, groupId: ids.group, name: `${prefix}渠道`, normalizedName: `${prefix}渠道` } });
  await db.sourceBatch.create({ data: { id: ids.batch, groupId: ids.group, channelId: ids.channel, sourceDate: "2026-08-20" } });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await db.invalidFanReportAudit.deleteMany({ where: { actorId: { startsWith: prefix } } });
  await db.invalidFanReport.deleteMany({ where: { reporterId: { startsWith: prefix } } });
  await db.sourceBatch.deleteMany({ where: { groupId: ids.group } });
  await db.channel.deleteMany({ where: { id: ids.channel, groupId: ids.group } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: ids.group } });
});

describe.sequential("invalid fan report API", () => {
  it("audits a forbidden POST once with the signed-in actor and writes nothing", async () => {
    await seed();
    vi.spyOn(auth, "requireUser").mockResolvedValue(lead);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await POST(new Request("http://localhost/api/invalid-fan-reports", {
      method: "POST",
      body: JSON.stringify({ batchId: ids.batch, noWsCount: 2, lowAmountCount: 1, collisionCount: 3 }),
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("X-Security-Audit")).toBe("app");
    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
      event: "AUTHORIZATION_DENIED",
      userId: ids.lead,
      teamId: ids.group,
      result: "denied",
    });
    expect(await db.invalidFanReport.count({ where: { batchId: ids.batch } })).toBe(0);
    expect(await db.invalidFanReportAudit.count({ where: { actorId: ids.lead } })).toBe(0);
  });

  it("audits a forbidden PATCH once with the signed-in actor and leaves the report untouched", async () => {
    await seed();
    const report = await db.invalidFanReport.create({
      data: {
        batchId: ids.batch,
        reporterId: ids.receptionist,
        noWsCount: 2,
        lowAmountCount: 1,
        collisionCount: 3,
      },
    });
    const before = await db.invalidFanReport.findUniqueOrThrow({ where: { id: report.id } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(receptionist);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await PATCH(new Request(`http://localhost/api/invalid-fan-reports/${report.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "approve", noWsCount: 9, lowAmountCount: 9, collisionCount: 9 }),
    }), { params: Promise.resolve({ reportId: report.id }) });

    expect(response.status).toBe(403);
    expect(response.headers.get("X-Security-Audit")).toBe("app");
    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
      event: "AUTHORIZATION_DENIED",
      userId: ids.receptionist,
      teamId: ids.group,
      result: "denied",
    });
    expect(await db.invalidFanReport.findUniqueOrThrow({ where: { id: report.id } })).toEqual(before);
    expect(await db.invalidFanReportAudit.count({ where: { reportId: report.id } })).toBe(0);
  });

  it("keeps receptionist input pending until the group lead approves it", async () => {
    await seed();
    vi.spyOn(auth, "requireUser").mockResolvedValue(receptionist);
    const created = await POST(new Request("http://localhost/api/invalid-fan-reports", {
      method: "POST",
      body: JSON.stringify({ batchId: ids.batch, noWsCount: 2, lowAmountCount: 1, collisionCount: 3 }),
    }));
    expect(created.status).toBe(201);
    const report = await created.json() as { id: string; status: string; approvedNoWsCount: number | null };
    expect(report).toMatchObject({ status: "PENDING", approvedNoWsCount: null });

    vi.spyOn(auth, "requireUser").mockResolvedValue(lead);
    const reviewed = await PATCH(new Request(`http://localhost/api/invalid-fan-reports/${report.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "approve", noWsCount: 2, lowAmountCount: 1, collisionCount: 3 }),
    }), { params: Promise.resolve({ reportId: report.id }) });
    expect(reviewed.status).toBe(200);
    await expect(reviewed.json()).resolves.toMatchObject({ status: "APPROVED", approvedCollisionCount: 3 });
  });

  it("creates a source batch for manual invalid data when the day has no valid customer", async () => {
    await seed();
    vi.spyOn(auth, "requireUser").mockResolvedValue(receptionist);
    const created = await POST(new Request("http://localhost/api/invalid-fan-reports", {
      method: "POST",
      body: JSON.stringify({ channelId: ids.channel, sourceDate: "2026-08-19", noWsCount: 1, lowAmountCount: 0, collisionCount: 2 }),
    }));
    expect(created.status).toBe(201);
    const report = await created.json() as { batchId: string };
    await expect(db.sourceBatch.findUnique({ where: { id: report.batchId }, select: { sourceDate: true, leads: { select: { id: true } } } })).resolves.toEqual({ sourceDate: "2026-08-19", leads: [] });
  });
});
