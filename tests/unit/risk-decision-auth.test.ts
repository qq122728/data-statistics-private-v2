import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { POST } from "../../src/app/api/admin/risk-decisions/route";

const isolatedDatabase = vi.hoisted(() => ({ directory: "", databaseUrl: "" }));

vi.mock("../../src/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { execFileSync } = await import("node:child_process");
  const { closeSync, mkdtempSync, openSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "risk-decision-auth-"));
  const databasePath = join(directory, "test.db");
  closeSync(openSync(databasePath, "w"));
  const databaseUrl = `file:${databasePath}`;
  execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  isolatedDatabase.directory = directory;
  isolatedDatabase.databaseUrl = databaseUrl;
  return { db: new PrismaClient({ datasourceUrl: databaseUrl }) };
});

const fixturePrefix = `risk-decision-auth-${randomUUID()}-`;
const fixtureIds = {
  group: `${fixturePrefix}group`,
  channel: `${fixturePrefix}channel`,
  batch: `${fixturePrefix}batch`,
  event: `${fixturePrefix}event`,
  admin: `${fixturePrefix}admin`,
  member: `${fixturePrefix}member`,
  lead: `${fixturePrefix}lead`,
};

const decisionRequest = (body: unknown) => new Request("http://localhost/api/admin/risk-decisions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const validDecision = {
  memberId: fixtureIds.member,
  level: "LIMIT_WATCH",
  evidenceThrough: "2026-08-13",
  reason: "连续低效需要人工复核",
} as const;

async function signInAsAdmin() {
  const admin = await db.user.findUniqueOrThrow({ where: { id: fixtureIds.admin } });
  vi.spyOn(auth, "requireRole").mockResolvedValue(admin);
  return admin;
}

beforeAll(async () => {
  await db.teamGroup.create({ data: { id: fixtureIds.group, name: "人工决定测试组" } });
  await db.user.createMany({ data: [
    { id: fixtureIds.admin, username: fixtureIds.admin, name: "人工决定测试管理员", role: "ADMIN" },
    { id: fixtureIds.member, username: fixtureIds.member, name: "人工决定测试成员", role: "RECEPTION", groupId: fixtureIds.group },
    { id: fixtureIds.lead, username: fixtureIds.lead, name: "人工决定测试组长", role: "LEAD", groupId: fixtureIds.group },
  ] });
  await db.channel.create({ data: { id: fixtureIds.channel, groupId: fixtureIds.group, name: "人工决定测试渠道", normalizedName: "人工决定测试渠道" } });
  await db.sourceBatch.create({ data: { id: fixtureIds.batch, groupId: fixtureIds.group, channelId: fixtureIds.channel, sourceDate: "2026-08-01" } });
  await db.metricEvent.create({ data: { id: fixtureIds.event, batchId: fixtureIds.batch, enteredById: fixtureIds.member, occurredOn: "2026-08-01", kind: "NEW_FANS", quantity: 1 } });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.auditLog.deleteMany({ where: { actorId: fixtureIds.admin, action: "RISK_DECISION_CREATED" } });
  await db.riskDecision.deleteMany({ where: { actorId: fixtureIds.admin } });
});

afterAll(async () => {
  await db.$disconnect();
  if (isolatedDatabase.directory) {
    const { rm } = await import("node:fs/promises");
    await rm(isolatedDatabase.directory, { recursive: true, force: true });
  }
});

describe.sequential("administrator risk decisions API", () => {
  it("runs against a test-owned migrated database instead of the caller database", () => {
    expect(isolatedDatabase.databaseUrl).toMatch(/^file:.+\/risk-decision-auth-[^/]+\/test\.db$/);
    expect(isolatedDatabase.databaseUrl).not.toBe(process.env.DATABASE_URL);
  });

  it("appends a decision and audit without changing the member or any metric event", async () => {
    await signInAsAdmin();
    const memberBefore = await db.user.findUniqueOrThrow({
      where: { id: validDecision.memberId },
      select: { active: true, groupId: true, role: true, updatedAt: true },
    });
    const eventsBefore = await db.metricEvent.findMany({ orderBy: { id: "asc" } });

    const response = await POST(decisionRequest({ ...validDecision, reason: `  ${validDecision.reason}  ` }));

    expect(response.status).toBe(201);
    const body = await response.json() as { latestDecision: { id: string; reason: string } };
    expect(body.latestDecision).toMatchObject({
      memberId: validDecision.memberId,
      actorId: fixtureIds.admin,
      level: "LIMIT_WATCH",
      evidenceThrough: "2026-08-13",
      reason: validDecision.reason,
    });
    await expect(db.riskDecision.findUnique({ where: { id: body.latestDecision.id } })).resolves.toMatchObject({
      memberId: validDecision.memberId,
      actorId: fixtureIds.admin,
    });
    await expect(db.auditLog.findFirst({ where: { action: "RISK_DECISION_CREATED", entityId: body.latestDecision.id } })).resolves.toMatchObject({
      actorId: fixtureIds.admin,
      entityType: "RiskDecision",
    });
    await expect(db.user.findUniqueOrThrow({
      where: { id: validDecision.memberId },
      select: { active: true, groupId: true, role: true, updatedAt: true },
    })).resolves.toEqual(memberBefore);
    await expect(db.metricEvent.findMany({ orderBy: { id: "asc" } })).resolves.toEqual(eventsBefore);
  });

  it("allows repeated confirmations and returns the newly appended decision", async () => {
    await signInAsAdmin();
    const first = await POST(decisionRequest(validDecision));
    const firstBody = await first.json() as { latestDecision: { id: string } };

    const second = await POST(decisionRequest({
      ...validDecision,
      level: "ELIMINATION_WATCH",
      evidenceThrough: "2026-08-14",
      reason: "延长观察后仍需人工复核",
    }));

    expect(second.status).toBe(201);
    const secondBody = await second.json() as { latestDecision: { id: string; level: string; evidenceThrough: string } };
    expect(secondBody.latestDecision).toMatchObject({ level: "ELIMINATION_WATCH", evidenceThrough: "2026-08-14" });
    expect(secondBody.latestDecision.id).not.toBe(firstBody.latestDecision.id);
    expect(await db.riskDecision.count({ where: { memberId: validDecision.memberId } })).toBe(2);
  });

  it("accepts a lead as the target of a management decision", async () => {
    await signInAsAdmin();

    const response = await POST(decisionRequest({ ...validDecision, memberId: fixtureIds.lead }));

    expect(response.status).toBe(201);
  });

  it.each([
    ["administrator target", { memberId: fixtureIds.admin }],
    ["missing target", { memberId: "missing-member" }],
    ["unsupported level", { level: "COACHING_WATCH" }],
    ["three-character trimmed reason", { reason: "  abc  " }],
    ["invalid evidence date", { evidenceThrough: "2026-02-30" }],
  ])("rejects an %s", async (_label, override) => {
    await signInAsAdmin();

    const response = await POST(decisionRequest({ ...validDecision, ...override }));

    expect(response.status).toBe(400);
    expect(await db.riskDecision.count()).toBe(0);
  });

  it.each(["LEAD", "RECEPTION"])("returns 403 when a %s forges a management decision", async () => {
    vi.spyOn(auth, "requireRole").mockRejectedValue(new auth.AuthorizationError(undefined, { id: "denied-user", groupId: "denied-team" } as never));

    const response = await POST(decisionRequest(validDecision));

    expect(response.status).toBe(403);
    expect(await db.riskDecision.count()).toBe(0);
  });
});
