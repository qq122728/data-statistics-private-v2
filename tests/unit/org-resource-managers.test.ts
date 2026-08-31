import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { GET as getAccounts } from "../../src/app/api/org/accounts/route";
import { POST as createResourceManager } from "../../src/app/api/org/resource-managers/route";

const isolatedDatabase = vi.hoisted(() => ({ directory: "" }));

vi.mock("../../src/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { execFileSync } = await import("node:child_process");
  const { closeSync, mkdtempSync, openSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "org-resource-managers-"));
  const databasePath = join(directory, "test.db");
  closeSync(openSync(databasePath, "w"));
  execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
  });
  isolatedDatabase.directory = directory;
  return { db: new PrismaClient({ datasourceUrl: `file:${databasePath}` }) };
});

const suffix = randomUUID();
const ids = {
  company: `resource-company-${suffix}`,
  department: `resource-department-${suffix}`,
  group: `resource-group-${suffix}`,
  hq: `resource-hq-${suffix}`,
  companyManager: `resource-company-manager-${suffix}`,
  ads: `resource-ads-${suffix}`,
  sms: `resource-sms-${suffix}`,
};

beforeAll(async () => {
  await db.company.create({ data: { id: ids.company, name: "资源测试公司" } });
  await db.department.create({ data: { id: ids.department, name: "资源测试部门", companyId: ids.company } });
  await db.teamGroup.create({ data: { id: ids.group, name: "资源测试小组", departmentId: ids.department } });
  await db.channel.createMany({ data: [
    { id: ids.ads, groupId: ids.group, name: "投流渠道", normalizedName: ids.ads, channelType: "ADS" },
    { id: ids.sms, groupId: ids.group, name: "短信渠道", normalizedName: ids.sms, channelType: "SMS" },
  ] });
  await db.user.createMany({ data: [
    { id: ids.hq, username: ids.hq, name: "总公司管理员", role: "COMPANY_MANAGER", duty: "HQ_MANAGER" },
    { id: ids.companyManager, username: ids.companyManager, name: "公司管理员", role: "COMPANY_MANAGER", duty: "COMPANY_MANAGER", companyId: ids.company },
  ] });
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
  vi.spyOn(auth, "requireUser").mockResolvedValue(await db.user.findUniqueOrThrow({ where: { id }, include: { resourceChannelAccess: true } }));
}

function request(body: unknown) {
  return new Request("http://localhost/api/org/resource-managers", { method: "POST", body: JSON.stringify(body) });
}

describe.sequential("总公司资源账号开设流程", () => {
  it("先有渠道后，总公司可以创建只绑定单一类型渠道的资源账号", async () => {
    await signInAs(ids.hq);
    const username = `ads-resource-${suffix}`;
    const response = await createResourceManager(request({ username, name: "投流资源账号", password: "temporary-password-1", resourceChannelIds: [ids.ads] }));
    expect(response.status).toBe(201);
    await expect(db.user.findUniqueOrThrow({ where: { username }, select: { role: true, duty: true, groupId: true, departmentId: true, resourceChannelAccess: { select: { channelId: true } } } })).resolves.toEqual({
      role: "RESOURCE_MANAGER", duty: "RESOURCE_MANAGER", groupId: null, departmentId: null, resourceChannelAccess: [{ channelId: ids.ads }],
    });

    const accounts = await getAccounts();
    expect(accounts.status).toBe(200);
    await expect(accounts.json()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ username, role: "RESOURCE_MANAGER", resourceChannelIds: [ids.ads] }),
    ]));
  });

  it("拒绝没有渠道、混合投流短信以及公司管理员越权开设", async () => {
    await signInAs(ids.hq);
    expect((await createResourceManager(request({ username: `empty-${suffix}`, name: "空资源", password: "temporary-password-1", resourceChannelIds: [] }))).status).toBe(400);
    expect((await createResourceManager(request({ username: `mixed-${suffix}`, name: "混合资源", password: "temporary-password-1", resourceChannelIds: [ids.ads, ids.sms] }))).status).toBe(400);

    await signInAs(ids.companyManager);
    expect((await createResourceManager(request({ username: `forged-${suffix}`, name: "越权资源", password: "temporary-password-1", resourceChannelIds: [ids.ads] }))).status).toBe(403);
  });
});
