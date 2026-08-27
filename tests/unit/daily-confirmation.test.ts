import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { newFansPayload } from "./helpers/new-fans-payload";

const databaseDirectory = await mkdtemp(join(tmpdir(), "daily-confirmation-test-"));
const databaseUrl = `file:${join(databaseDirectory, "test.db")}`;
const originalDatabaseUrl = process.env.DATABASE_URL;
const execFile = promisify(execFileCallback);
const fixtureId = randomUUID();
const groupA = `daily-confirmation-group-a-${fixtureId}`;
const groupB = `daily-confirmation-group-b-${fixtureId}`;

let db: any;
let auth: typeof import("../../src/lib/auth");
let GET: typeof import("../../src/app/api/daily-confirmations/route").GET;
let POST: typeof import("../../src/app/api/daily-confirmations/route").POST;
let postEvents: typeof import("../../src/app/api/events/route").POST;
let postBatches: typeof import("../../src/app/api/batches/route").POST;
let lead: any;
let admin: any;
let channelId = "";
let batchId = "";

const confirmRequest = (body: object) => new Request("http://localhost/api/daily-confirmations", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
});
const statusRequest = (businessDate: string, groupId?: string, includeInactive = false) => new Request(
  `http://localhost/api/daily-confirmations?businessDate=${businessDate}${groupId ? `&groupId=${groupId}` : ""}${includeInactive ? "&includeInactive=1" : ""}`,
);

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  await execFile("npx", ["prisma", "migrate", "deploy"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl } });
  delete (globalThis as { prisma?: unknown }).prisma;
  vi.resetModules();
  ({ db } = await import("../../src/lib/db"));
  auth = await import("../../src/lib/auth");
  ({ GET, POST } = await import("../../src/app/api/daily-confirmations/route"));
  ({ POST: postEvents } = await import("../../src/app/api/events/route"));
  ({ POST: postBatches } = await import("../../src/app/api/batches/route"));

  await db.teamGroup.createMany({ data: [{ id: groupA, name: "一组" }, { id: groupB, name: "二组" }] });
  lead = await db.user.create({ data: { id: `reception-a-${fixtureId}`, username: `reception-a-${fixtureId}`, name: "前台接粉", passwordHash: "test", role: "RECEPTION", groupId: groupA } });
  await db.user.create({ data: { id: `member-a-${fixtureId}`, username: `member-a-${fixtureId}`, name: "组员", passwordHash: "test", role: "RECEPTION", groupId: groupA } });
  await db.user.create({ data: { id: `inactive-a-${fixtureId}`, username: `inactive-a-${fixtureId}`, name: "停用组员", passwordHash: "test", role: "RECEPTION", groupId: groupA, active: false } });
  admin = await db.user.create({ data: { id: `admin-a-${fixtureId}`, username: `admin-a-${fixtureId}`, name: "管理员", passwordHash: "test", role: "ADMIN" } });
  const channel = await db.channel.create({ data: { id: `daily-confirmation-channel-${fixtureId}`, groupId: groupA, name: "确认审计渠道", normalizedName: `确认审计渠道-${fixtureId}` } });
  channelId = channel.id;
  const batch = await db.sourceBatch.create({ data: { groupId: groupA, channelId, sourceDate: "2026-08-12" } });
  batchId = batch.id;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-12T04:00:00.000Z"));
});

afterAll(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await db?.$disconnect();
  delete (globalThis as { prisma?: unknown }).prisma;
  process.env.DATABASE_URL = originalDatabaseUrl;
  await rm(databaseDirectory, { recursive: true, force: true });
});

describe.sequential("daily entry confirmations API", () => {
  it("is idempotent for reception and refuses a forged cross-group status request", async () => {
    vi.spyOn(auth, "requireUser").mockResolvedValue(lead);

    const first = await POST(confirmRequest({ businessDate: "2026-08-12" }));
    const second = await POST(confirmRequest({ businessDate: "2026-08-12" }));
    expect(first.status).toBe(200);
    expect(await second.json()).toMatchObject({ alreadyConfirmed: true });

    const rows = await GET(statusRequest("2026-08-12", groupB));
    expect(rows.status).toBe(403);
  });

  it("shows group business users to an admin and includes inactive users only when requested", async () => {
    vi.spyOn(auth, "requireUser").mockResolvedValue(admin);

    const adminRows = await GET(statusRequest("2026-08-12", groupA));
    expect(adminRows.status).toBe(200);
    const adminBody = await adminRows.json();
    expect(adminBody.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: lead.id, confirmed: true }),
      expect.objectContaining({ userId: `member-a-${fixtureId}`, confirmed: false }),
    ]));

    const withInactive = await GET(statusRequest("2026-08-12", groupA, true));
    expect((await withInactive.json()).members).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: `inactive-a-${fixtureId}`, confirmed: false }),
    ]));
  });

  it("does not let administrators submit a business confirmation", async () => {
    vi.spyOn(auth, "requireUser").mockResolvedValue(admin);
    expect((await POST(confirmRequest({ businessDate: "2026-08-12" }))).status).toBe(403);
  });

  it("allows only the member group's local today and preserves an existing confirmation across refreshes", async () => {
    vi.spyOn(auth, "requireUser").mockResolvedValue(lead);

    const future = await POST(confirmRequest({ businessDate: "2026-08-13" }));
    expect(future.status).toBe(400);
    expect(await future.json()).toMatchObject({ error: "只能确认所在小组当地时间的今天" });

    const current = await POST(confirmRequest({ businessDate: "2026-08-12" }));
    expect(current.status).toBe(200);
    expect(await db.dailyEntryConfirmation.count({ where: { userId: lead.id, businessDate: "2026-08-12" } })).toBe(1);
  });

  it("keeps confirmedAt but touches updatedAt for both kinds of today's event writes", async () => {
    vi.spyOn(auth, "requireUser").mockResolvedValue(lead);
    const originalTime = new Date("2026-08-12T01:00:00.000Z");
    await db.dailyEntryConfirmation.upsert({
      where: { userId_businessDate: { userId: lead.id, businessDate: "2026-08-12" } },
      update: { confirmedAt: originalTime, updatedAt: originalTime },
      create: { userId: lead.id, businessDate: "2026-08-12", confirmedAt: originalTime, updatedAt: originalTime },
    });

    const eventResponse = await postEvents(new Request("http://localhost/api/events", {
      method: "POST",
      body: JSON.stringify({ batchId, occurredOn: "2026-08-12", kind: "REPLIES", quantity: 1 }),
    }));
    expect(eventResponse.status).toBe(201);
    let confirmation = await db.dailyEntryConfirmation.findUniqueOrThrow({ where: { userId_businessDate: { userId: lead.id, businessDate: "2026-08-12" } } });
    expect(confirmation.confirmedAt).toEqual(originalTime);
    expect(confirmation.updatedAt.getTime()).toBeGreaterThan(originalTime.getTime());

    await db.dailyEntryConfirmation.update({
      where: { userId_businessDate: { userId: lead.id, businessDate: "2026-08-12" } },
      data: { updatedAt: originalTime },
    });
    const batchResponse = await postBatches(new Request("http://localhost/api/batches", {
      method: "POST",
      body: JSON.stringify(newFansPayload({ channelId, sourceDate: "2026-08-12" })),
    }));
    expect(batchResponse.status).toBe(201);
    confirmation = await db.dailyEntryConfirmation.findUniqueOrThrow({ where: { userId_businessDate: { userId: lead.id, businessDate: "2026-08-12" } } });
    expect(confirmation.confirmedAt).toEqual(originalTime);
    expect(confirmation.updatedAt.getTime()).toBeGreaterThan(originalTime.getTime());
  });
});
