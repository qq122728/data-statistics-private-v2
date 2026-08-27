import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { defaultRiskSettings, riskSettingKeys, type RiskSettings } from "../../src/lib/risk-settings";
import { GET, PATCH } from "../../src/app/api/admin/risk-settings/route";

const isolatedDatabase = vi.hoisted(() => ({ directory: "", databaseUrl: "" }));

vi.mock("../../src/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { execFileSync } = await import("node:child_process");
  const { closeSync, mkdtempSync, openSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "admin-risk-settings-"));
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

const fixturePrefix = `admin-risk-settings-${randomUUID()}-`;
const adminId = `${fixturePrefix}admin`;

const request = (body: unknown) => new Request("http://localhost/api/admin/risk-settings", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const changedSettings: RiskSettings = {
  trainingDays: 6,
  observationDays: 28,
  coachingEfficiency: 0.82,
  coachingDays: 8,
  limitEfficiency: 0.72,
  limitDays: 16,
  eliminationEfficiency: 0.62,
  eliminationDays: 31,
  replyMinNewFans: 51,
  groupMinNewFans: 52,
  leaveMinGroupJoin: 31,
  expertMinGroupJoin: 32,
  registrationMinExpert: 21,
  orderMinNewFans: 101,
  efficiencyMinEffectiveFans: 102,
  priceComparisonMinOrders: 6,
};

async function signInAsAdmin() {
  const admin = await db.user.findUniqueOrThrow({ where: { id: adminId } });
  vi.spyOn(auth, "requireRole").mockResolvedValue(admin);
}

beforeAll(async () => {
  await db.user.create({ data: { id: adminId, username: adminId, name: "风险设置测试管理员", role: "ADMIN" } });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.auditLog.deleteMany({ where: { actorId: adminId, action: "RISK_SETTINGS_UPDATED" } });
  await db.systemSetting.deleteMany({ where: { key: { in: [...riskSettingKeys] } } });
});

afterAll(async () => {
  await db.$disconnect();
  if (isolatedDatabase.directory) {
    const { rm } = await import("node:fs/promises");
    await rm(isolatedDatabase.directory, { recursive: true, force: true });
  }
});

describe.sequential("administrator risk settings API", () => {
  it("runs against a test-owned migrated database instead of the caller database", () => {
    expect(isolatedDatabase.databaseUrl).toMatch(/^file:.+\/admin-risk-settings-[^/]+\/test\.db$/);
    expect(isolatedDatabase.databaseUrl).not.toBe(process.env.DATABASE_URL);
  });

  it("lets an administrator read defaults without exposing storage details", async () => {
    await signInAsAdmin();

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(defaultRiskSettings);
  });

  it("replaces the complete rule set and records a traceable audit", async () => {
    await signInAsAdmin();

    const response = await PATCH(request(changedSettings));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(changedSettings);
    const stored = await db.systemSetting.findMany({ where: { key: { in: [...riskSettingKeys] } } });
    expect(stored).toHaveLength(riskSettingKeys.length);
    expect(stored.every((setting) => setting.updatedById === adminId)).toBe(true);
    const audit = await db.auditLog.findFirst({
      where: { actorId: adminId, action: "RISK_SETTINGS_UPDATED" },
    });
    expect(audit).toMatchObject({
      entityType: "SystemSetting",
      entityId: "risk",
    });
    expect(JSON.parse(audit!.summary)).toEqual({
      changedKeys: Object.keys(changedSettings),
      before: defaultRiskSettings,
      after: changedSettings,
    });
  });

  it("rejects a partial replacement instead of silently defaulting missing rules", async () => {
    await signInAsAdmin();

    const response = await PATCH(request({ trainingDays: 8, observationDays: 31 }));

    expect(response.status).toBe(400);
    expect(await db.systemSetting.count({ where: { key: { in: [...riskSettingKeys] } } })).toBe(0);
  });

  it.each([
    ["equal stage endpoints", { trainingDays: 30, observationDays: 30 }],
    ["decreasing stage endpoints", { trainingDays: 31, observationDays: 30 }],
    ["fractional training endpoint", { trainingDays: 7.5 }],
    ["zero observation endpoint", { observationDays: 0 }],
  ])("rejects %s", async (_label, override) => {
    await signInAsAdmin();

    const response = await PATCH(request({ ...changedSettings, ...override }));

    expect(response.status).toBe(400);
  });

  it.each([
    ["coachingEfficiency", -0.01],
    ["coachingEfficiency", 1.01],
    ["limitEfficiency", -0.01],
    ["limitEfficiency", 1.01],
    ["eliminationEfficiency", -0.01],
    ["eliminationEfficiency", 1.01],
    ["limitEfficiency", "0.70"],
  ])("rejects an invalid %s efficiency threshold", async (field, value) => {
    await signInAsAdmin();

    const response = await PATCH(request({ ...changedSettings, [field]: value }));

    expect(response.status).toBe(400);
  });

  it.each(["coachingEfficiency", "limitEfficiency", "eliminationEfficiency"] as const)("rejects %s with more than four decimal places without persisting or auditing it", async (field) => {
    await signInAsAdmin();

    const response = await PATCH(request({ ...changedSettings, [field]: 0.12345 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "效率阈值最多保留 4 位小数" });
    expect(await db.systemSetting.count({ where: { key: { in: [...riskSettingKeys] } } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "RISK_SETTINGS_UPDATED" } })).toBe(0);
  });

  it("keeps a four-decimal efficiency identical in PATCH, GET, storage, and audit", async () => {
    await signInAsAdmin();
    const exactSettings = { ...changedSettings, coachingEfficiency: 0.0003, limitEfficiency: 0, eliminationEfficiency: 1 };

    const patchResponse = await PATCH(request(exactSettings));

    expect(patchResponse.status).toBe(200);
    await expect(patchResponse.json()).resolves.toEqual(exactSettings);
    await expect(GET().then((response) => response.json())).resolves.toEqual(exactSettings);
    await expect(db.systemSetting.findMany({
      where: { key: { in: ["risk.coachingEfficiencyBps", "risk.limitEfficiencyBps", "risk.eliminationEfficiencyBps"] } },
      orderBy: { key: "asc" },
      select: { key: true, value: true },
    })).resolves.toEqual([
      { key: "risk.coachingEfficiencyBps", value: "3" },
      { key: "risk.eliminationEfficiencyBps", value: "10000" },
      { key: "risk.limitEfficiencyBps", value: "0" },
    ]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "RISK_SETTINGS_UPDATED" } });
    expect(JSON.parse(audit.summary).after).toEqual(exactSettings);
  });

  it.each(["coachingDays", "limitDays", "eliminationDays"] as const)("requires positive integer %s", async (field) => {
    await signInAsAdmin();

    const zero = await PATCH(request({ ...changedSettings, [field]: 0 }));
    const fraction = await PATCH(request({ ...changedSettings, [field]: 1.5 }));

    expect(zero.status).toBe(400);
    expect(fraction.status).toBe(400);
  });

  it.each([
    "replyMinNewFans",
    "groupMinNewFans",
    "leaveMinGroupJoin",
    "expertMinGroupJoin",
    "registrationMinExpert",
    "orderMinNewFans",
    "efficiencyMinEffectiveFans",
    "priceComparisonMinOrders",
  ] as const)("requires a non-negative integer %s sample minimum", async (field) => {
    await signInAsAdmin();

    const negative = await PATCH(request({ ...changedSettings, [field]: -1 }));
    const fraction = await PATCH(request({ ...changedSettings, [field]: 1.5 }));

    expect(negative.status).toBe(400);
    expect(fraction.status).toBe(400);
  });

  it.each(["LEAD", "RECEPTION"])("returns 403 to a %s for both reads and writes", async () => {
    vi.spyOn(auth, "requireRole").mockRejectedValue(new auth.AuthorizationError(undefined, { id: "denied-user", groupId: "denied-team" } as never));

    const getResponse = await GET();
    const patchResponse = await PATCH(request(changedSettings));

    expect(getResponse.status).toBe(403);
    expect(await getResponse.json()).toEqual({ error: "没有权限执行此操作" });
    expect(patchResponse.status).toBe(403);
    expect(await db.systemSetting.count({ where: { key: { in: [...riskSettingKeys] } } })).toBe(0);
  });
});
