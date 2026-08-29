import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { POST as createCompany } from "../../src/app/api/org/companies/route";
import { POST as createDepartment } from "../../src/app/api/org/departments/route";
import { POST as createGroup } from "../../src/app/api/org/groups/route";
import { POST as appointLead } from "../../src/app/api/org/groups/[groupId]/lead/route";
import { GET as getOrgStructure } from "../../src/app/api/org/structure/route";

const isolatedDatabase = vi.hoisted(() => ({ directory: "" }));
vi.mock("../../src/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { execFileSync } = await import("node:child_process");
  const { closeSync, mkdtempSync, openSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "org-routes-"));
  const databasePath = join(directory, "test.db");
  closeSync(openSync(databasePath, "w"));
  execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: `file:${databasePath}` } });
  isolatedDatabase.directory = directory;
  return { db: new PrismaClient({ datasourceUrl: `file:${databasePath}` }) };
});

const suffix = randomUUID();
const ids = {
  companyA: `company-a-${suffix}`,
  companyB: `company-b-${suffix}`,
  deptA1: `dept-a1-${suffix}`,
  deptA2: `dept-a2-${suffix}`,
  deptB1: `dept-b1-${suffix}`,
  groupA1: `group-a1-${suffix}`,
  groupA2: `group-a2-${suffix}`,
  groupB1: `group-b1-${suffix}`,
  hq: `hq-${suffix}`,
  companyAManager: `company-a-manager-${suffix}`,
  companyBManager: `company-b-manager-${suffix}`,
  deptA1Manager: `dept-a1-manager-${suffix}`,
  candidateA1: `candidate-a1-${suffix}`,
  candidateB1: `candidate-b1-${suffix}`,
  plainLead: `plain-lead-${suffix}`,
};

beforeAll(async () => {
  await db.company.createMany({ data: [
    { id: ids.companyA, name: `公司A-${suffix}` },
    { id: ids.companyB, name: `公司B-${suffix}` },
  ] });
  await db.department.createMany({ data: [
    { id: ids.deptA1, name: `A公司一部-${suffix}`, companyId: ids.companyA, countryCode: "CN", timezone: "Asia/Shanghai" },
    { id: ids.deptA2, name: `A公司二部-${suffix}`, companyId: ids.companyA, countryCode: "CN", timezone: "Asia/Shanghai" },
    { id: ids.deptB1, name: `B公司一部-${suffix}`, companyId: ids.companyB, countryCode: "US", timezone: "America/New_York" },
  ] });
  await db.teamGroup.createMany({ data: [
    { id: ids.groupA1, name: `A1组-${suffix}`, departmentId: ids.deptA1 },
    { id: ids.groupA2, name: `A2组-${suffix}`, departmentId: ids.deptA2 },
    { id: ids.groupB1, name: `B1组-${suffix}`, departmentId: ids.deptB1 },
  ] });
  await db.user.createMany({ data: [
    { id: ids.hq, username: ids.hq, name: "总公司管理员", role: "COMPANY_MANAGER", duty: "HQ_MANAGER" },
    { id: ids.companyAManager, username: ids.companyAManager, name: "A公司管理员", role: "COMPANY_MANAGER", duty: "COMPANY_MANAGER", companyId: ids.companyA },
    { id: ids.companyBManager, username: ids.companyBManager, name: "B公司管理员", role: "COMPANY_MANAGER", duty: "COMPANY_MANAGER", companyId: ids.companyB },
    { id: ids.deptA1Manager, username: ids.deptA1Manager, name: "A一部部门管理员", role: "COMPANY_MANAGER", duty: "DEPARTMENT_MANAGER", departmentId: ids.deptA1 },
    { id: ids.candidateA1, username: ids.candidateA1, name: "A1组待任命组长", role: "RECEPTION", groupId: ids.groupA1 },
    { id: ids.candidateB1, username: ids.candidateB1, name: "B1组待任命组长", role: "RECEPTION", groupId: ids.groupB1 },
    // 故意不挂 groupId：这个账号只用来测"没有管理职务的人连权限入口都进不去"，
    // 挂上 groupId 反而会占掉 groupA1 的"唯一在职组长"名额，干扰后面的任命测试。
    { id: ids.plainLead, username: ids.plainLead, name: "普通组长", role: "LEAD" },
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

function signInAs(id: string) {
  vi.restoreAllMocks();
  return db.user.findUniqueOrThrow({ where: { id } }).then((user) => {
    vi.spyOn(auth, "requireUser").mockResolvedValue(user as auth.SessionUser);
  });
}

function jsonRequest(url: string, body: unknown) {
  return new Request(url, { method: "POST", body: JSON.stringify(body) });
}

describe.sequential("阶段5a组织架构路由：新公司/新部门 (总公司管理员专属)", () => {
  it("lets the HQ manager create a company", async () => {
    await signInAs(ids.hq);
    const response = await createCompany(jsonRequest("http://localhost/api/org/companies", { name: `新建公司-${suffix}` }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.name).toBe(`新建公司-${suffix}`);
  });

  it("blocks a company manager from creating a company", async () => {
    await signInAs(ids.companyAManager);
    const response = await createCompany(jsonRequest("http://localhost/api/org/companies", { name: `越权公司-${suffix}` }));
    expect(response.status).toBe(403);
  });

  it("blocks a department manager from creating a company", async () => {
    await signInAs(ids.deptA1Manager);
    const response = await createCompany(jsonRequest("http://localhost/api/org/companies", { name: `越权公司2-${suffix}` }));
    expect(response.status).toBe(403);
  });

  it("blocks a plain lead (no management duty at all) from even reaching the permission check", async () => {
    await signInAs(ids.plainLead);
    const response = await createCompany(jsonRequest("http://localhost/api/org/companies", { name: `组长建公司-${suffix}` }));
    expect(response.status).toBe(403);
  });

  it("lets the HQ manager create a department under an existing company", async () => {
    await signInAs(ids.hq);
    const response = await createDepartment(jsonRequest("http://localhost/api/org/departments", { companyId: ids.companyA, name: `新部门-${suffix}`, timezone: "Asia/Shanghai" }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.companyId).toBe(ids.companyA);
  });

  it("blocks a company manager from creating a department, even in their own company", async () => {
    await signInAs(ids.companyAManager);
    const response = await createDepartment(jsonRequest("http://localhost/api/org/departments", { companyId: ids.companyA, name: `越权部门-${suffix}`, timezone: "Asia/Shanghai" }));
    expect(response.status).toBe(403);
  });
});

describe.sequential("阶段5a组织架构路由：新建小组 (部门管理员及以上，按层级限定范围)", () => {
  it("lets a department manager create a group in their own department", async () => {
    await signInAs(ids.deptA1Manager);
    const response = await createGroup(jsonRequest("http://localhost/api/org/groups", { departmentId: ids.deptA1, name: `A1新组-${suffix}` }));
    expect(response.status).toBe(201);
  });

  it("blocks a department manager from creating a group in a different department", async () => {
    await signInAs(ids.deptA1Manager);
    const response = await createGroup(jsonRequest("http://localhost/api/org/groups", { departmentId: ids.deptA2, name: `越权组-${suffix}` }));
    expect(response.status).toBe(403);
  });

  it("lets a company manager create a group under any of their own company's departments", async () => {
    await signInAs(ids.companyAManager);
    const response = await createGroup(jsonRequest("http://localhost/api/org/groups", { departmentId: ids.deptA2, name: `A2新组-${suffix}` }));
    expect(response.status).toBe(201);
  });

  it("blocks a company manager from creating a group under a different company's department", async () => {
    await signInAs(ids.companyAManager);
    const response = await createGroup(jsonRequest("http://localhost/api/org/groups", { departmentId: ids.deptB1, name: `越权组2-${suffix}` }));
    expect(response.status).toBe(403);
  });

  it("lets the HQ manager create a group under any department in any company", async () => {
    await signInAs(ids.hq);
    const response = await createGroup(jsonRequest("http://localhost/api/org/groups", { departmentId: ids.deptB1, name: `B1新组-${suffix}` }));
    expect(response.status).toBe(201);
  });
});

describe.sequential("阶段5a组织架构路由：任免/调动组长 (calls transferUserPosition, tier-scoped)", () => {
  it("lets a department manager promote an existing frontline member to lead within their own department", async () => {
    await signInAs(ids.deptA1Manager);
    const response = await appointLead(
      jsonRequest(`http://localhost/api/org/groups/${ids.groupA1}/lead`, { userId: ids.candidateA1, effectiveOn: "2026-08-20", reason: "本部门内部提拔" }),
      { params: Promise.resolve({ groupId: ids.groupA1 }) },
    );
    expect(response.status).toBe(200);
    const updated = await db.user.findUniqueOrThrow({ where: { id: ids.candidateA1 } });
    expect(updated.role).toBe("LEAD");
    expect(updated.duty).toBe("LEAD");
  });

  it("blocks a department manager from appointing a lead in a different department", async () => {
    await signInAs(ids.deptA1Manager);
    const response = await appointLead(
      jsonRequest(`http://localhost/api/org/groups/${ids.groupB1}/lead`, { userId: ids.candidateB1, effectiveOn: "2026-08-20", reason: "越权任命组长" }),
      { params: Promise.resolve({ groupId: ids.groupB1 }) },
    );
    expect(response.status).toBe(403);
  });

  it("lets a company manager appoint a lead across two of their own company's groups (cross-department, same company)", async () => {
    await signInAs(ids.companyAManager);
    // candidateA1 是刚才在上一条用例里被提拔成 A1 组组长的人，这里公司管理员把他跨部门调到 A2 组继续当组长。
    const response = await appointLead(
      jsonRequest(`http://localhost/api/org/groups/${ids.groupA2}/lead`, { userId: ids.candidateA1, effectiveOn: "2026-08-21", reason: "公司内部跨部门调组" }),
      { params: Promise.resolve({ groupId: ids.groupA2 }) },
    );
    expect(response.status).toBe(200);
    const updated = await db.user.findUniqueOrThrow({ where: { id: ids.candidateA1 } });
    expect(updated.groupId).toBe(ids.groupA2);
  });

  it("blocks a company manager from pulling a lead in from a different company's group (source-side check)", async () => {
    await signInAs(ids.companyAManager);
    // candidateB1 属于 B 公司的 B1 组，A 公司管理员不能把他调进自己公司——即便目标组在自己公司内，
    // 调出的原小组不在管辖范围内，两端都要过 canAppointOrTransferLead 才放行。
    const response = await appointLead(
      jsonRequest(`http://localhost/api/org/groups/${ids.groupA1}/lead`, { userId: ids.candidateB1, effectiveOn: "2026-08-21", reason: "跨公司挖人" }),
      { params: Promise.resolve({ groupId: ids.groupA1 }) },
    );
    expect(response.status).toBe(403);
  });

  it("blocks a company manager from appointing a lead in a different company's group entirely", async () => {
    await signInAs(ids.companyBManager);
    const response = await appointLead(
      jsonRequest(`http://localhost/api/org/groups/${ids.groupA1}/lead`, { userId: ids.candidateB1, effectiveOn: "2026-08-21", reason: "跨公司任命" }),
      { params: Promise.resolve({ groupId: ids.groupA1 }) },
    );
    expect(response.status).toBe(403);
  });

  it("lets the HQ manager appoint a lead across companies without restriction", async () => {
    await signInAs(ids.hq);
    const response = await appointLead(
      jsonRequest(`http://localhost/api/org/groups/${ids.groupB1}/lead`, { userId: ids.candidateB1, effectiveOn: "2026-08-22", reason: "总公司统一调配" }),
      { params: Promise.resolve({ groupId: ids.groupB1 }) },
    );
    expect(response.status).toBe(200);
  });
});

describe.sequential("阶段5a组织架构路由：只读组织结构树 (5.2/5.5 可见范围)", () => {
  it("gives the HQ manager every company, laid out separately (not merged, per 5.5)", async () => {
    await signInAs(ids.hq);
    const response = await getOrgStructure();
    expect(response.status).toBe(200);
    const body = await response.json();
    const companyIds = body.companies.map((company: { id: string }) => company.id);
    expect(companyIds).toEqual(expect.arrayContaining([ids.companyA, ids.companyB]));
  });

  it("scopes the company manager to only their own company's departments", async () => {
    await signInAs(ids.companyAManager);
    const response = await getOrgStructure();
    const body = await response.json();
    expect(body.company.id).toBe(ids.companyA);
    const departmentIds = body.company.departments.map((department: { id: string }) => department.id);
    expect(departmentIds).toEqual(expect.arrayContaining([ids.deptA1, ids.deptA2]));
    expect(departmentIds).not.toContain(ids.deptB1);
  });

  it("scopes the department manager to only their own department's groups", async () => {
    await signInAs(ids.deptA1Manager);
    const response = await getOrgStructure();
    const body = await response.json();
    expect(body.department.id).toBe(ids.deptA1);
    const groupIds = body.department.groups.map((group: { id: string }) => group.id);
    expect(groupIds).toContain(ids.groupA1);
    expect(groupIds).not.toContain(ids.deptA2);
  });

  it("blocks a plain lead with no management duty from reading the org structure endpoint", async () => {
    await signInAs(ids.plainLead);
    const response = await getOrgStructure();
    expect(response.status).toBe(403);
  });
});
