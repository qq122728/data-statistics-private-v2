import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import {
  DELETE,
  GET,
  PATCH,
  POST,
} from "../../src/app/api/device-accounts/route";

const isolatedDatabase = vi.hoisted(() => ({ directory: "" }));

vi.mock("../../src/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { execFileSync } = await import("node:child_process");
  const { closeSync, mkdtempSync, openSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "device-accounts-"));
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

const suffix = randomUUID();
const ids = {
  groupA: `device-group-a-${suffix}`,
  groupB: `device-group-b-${suffix}`,
  leadA: `device-lead-a-${suffix}`,
  receptionA: `device-reception-a-${suffix}`,
  receptionB: `device-reception-b-${suffix}`,
  operatorA: `device-operator-a-${suffix}`,
  expertA: `device-expert-a-${suffix}`,
  admin: `device-admin-${suffix}`,
};

beforeAll(async () => {
  await db.teamGroup.createMany({
    data: [
      { id: ids.groupA, name: "设备一组" },
      { id: ids.groupB, name: "设备二组" },
    ],
  });
  await db.user.createMany({
    data: [
      { id: ids.leadA, username: ids.leadA, name: "组长", role: "LEAD", groupId: ids.groupA },
      { id: ids.receptionA, username: ids.receptionA, name: "接粉 A", role: "RECEPTION", groupId: ids.groupA },
      { id: ids.receptionB, username: ids.receptionB, name: "接粉 B", role: "RECEPTION", groupId: ids.groupB },
      { id: ids.operatorA, username: ids.operatorA, name: "炒群", role: "GROUP_OPERATOR", groupId: ids.groupA },
      { id: ids.expertA, username: ids.expertA, name: "专家", role: "EXPERT", groupId: ids.groupA },
      { id: ids.admin, username: ids.admin, name: "管理员", role: "ADMIN" },
    ],
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await db.$disconnect();
  if (isolatedDatabase.directory) {
    const { rm } = await import("node:fs/promises");
    await rm(isolatedDatabase.directory, { recursive: true, force: true });
  }
});

async function signInAs(id: string) {
  vi.restoreAllMocks();
  vi.spyOn(auth, "requireUser").mockResolvedValue(
    await db.user.findUniqueOrThrow({ where: { id } }),
  );
}

function request(method: string, body?: Record<string, unknown>) {
  return new Request("http://localhost/api/device-accounts", {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function accountInput(overrides: Record<string, unknown> = {}) {
  return {
    accountType: "NORMAL_WS",
    provider: "号商一",
    accountNumber: `ws-${randomUUID()}`,
    renewalDate: "2026-09-01",
    purpose: "联系客户",
    situation: "正常",
    phoneCode: "W1",
    followUp: "下周检查",
    ...overrides,
  };
}

describe.sequential("device account permissions", () => {
  it("lets administrators view every group but keeps the page read-only", async () => {
    await signInAs(ids.admin);
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).readOnly).toBe(true);
    expect((await POST(request("POST", accountInput()))).status).toBe(403);
  });

  it.each([
    ["reception", ids.receptionA],
    ["group operator", ids.operatorA],
    ["expert", ids.expertA],
  ])("lets %s maintain only their own account", async (_label, actorId) => {
    await signInAs(actorId);
    const created = await POST(request("POST", accountInput()));
    expect(created.status).toBe(201);
    const payload = await created.json();
    expect(payload.account.ownerId).toBe(actorId);

    expect(
      (
        await POST(
          request("POST", accountInput({ ownerId: ids.receptionB })),
        )
      ).status,
    ).toBe(403);
  });

  it("lets a lead manage the group but blocks cross-group owners and records", async () => {
    await signInAs(ids.leadA);
    const own = await POST(request("POST", accountInput()));
    expect(own.status).toBe(201);
    expect((await own.json()).account.ownerId).toBe(ids.leadA);
    const created = await POST(
      request("POST", accountInput({ ownerId: ids.receptionA })),
    );
    expect(created.status).toBe(201);
    const payload = await created.json();
    expect(payload.account.ownerId).toBe(ids.receptionA);

    expect(
      (
        await POST(
          request("POST", accountInput({ ownerId: ids.receptionB })),
        )
      ).status,
    ).toBe(400);

    const foreign = await db.deviceAccount.create({
      data: {
        groupId: ids.groupB,
        ownerId: ids.receptionB,
        accountType: "RCS",
        provider: "外组号商",
        accountNumber: `foreign-${suffix}`,
      },
    });
    expect(
      (
        await PATCH(
          request("PATCH", accountInput({ id: foreign.id, ownerId: ids.receptionA })),
        )
      ).status,
    ).toBe(404);
    expect((await DELETE(request("DELETE", { id: foreign.id }))).status).toBe(404);
  });

  it("rejects duplicate numbers inside one group", async () => {
    await signInAs(ids.receptionA);
    const accountNumber = `duplicate-${suffix}`;
    expect(
      (await POST(request("POST", accountInput({ accountNumber })))).status,
    ).toBe(201);
    expect(
      (await POST(request("POST", accountInput({ accountNumber })))).status,
    ).toBe(409);
  });

  it("blocks an old session after the account is disabled", async () => {
    await signInAs(ids.expertA);
    await db.user.update({ where: { id: ids.expertA }, data: { active: false } });
    const response = await POST(request("POST", accountInput()));
    expect(response.status).toBe(403);
    await db.user.update({ where: { id: ids.expertA }, data: { active: true } });
  });
});
