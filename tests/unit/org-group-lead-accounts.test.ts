import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as audit from "../../src/lib/audit";
import * as auth from "../../src/lib/auth";
import { verifyPassword } from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { POST as createGroupLeadAccount } from "../../src/app/api/org/group-leads/route";

const isolatedDatabase = vi.hoisted(() => ({ directory: "" }));
vi.mock("../../src/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { execFileSync } = await import("node:child_process");
  const { closeSync, mkdtempSync, openSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "org-group-lead-accounts-"));
  const databasePath = join(directory, "test.db");
  closeSync(openSync(databasePath, "w"));
  execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
  });
  isolatedDatabase.directory = directory;
  return { db: new PrismaClient({ datasourceUrl: `file:${databasePath}` }) };
});

const suffix = randomUUID();
const ids = {
  companyA: `group-lead-company-a-${suffix}`,
  companyB: `group-lead-company-b-${suffix}`,
  deptA1: `group-lead-dept-a1-${suffix}`,
  deptA2: `group-lead-dept-a2-${suffix}`,
  deptB1: `group-lead-dept-b1-${suffix}`,
  groupDeptOwn: `group-lead-dept-own-${suffix}`,
  groupCompanyOwn: `group-lead-company-own-${suffix}`,
  groupHq: `group-lead-hq-${suffix}`,
  groupAdmin: `group-lead-admin-${suffix}`,
  groupOccupied: `group-lead-occupied-${suffix}`,
  groupDuplicateFirst: `group-lead-duplicate-first-${suffix}`,
  groupDuplicateSecond: `group-lead-duplicate-second-${suffix}`,
  groupRollback: `group-lead-rollback-${suffix}`,
  groupFuture: `group-lead-future-${suffix}`,
  hq: `group-lead-hq-user-${suffix}`,
  companyAManager: `group-lead-company-a-manager-${suffix}`,
  deptA1Manager: `group-lead-dept-a1-manager-${suffix}`,
  admin: `group-lead-admin-user-${suffix}`,
  plainLead: `group-lead-plain-lead-${suffix}`,
  occupiedLead: `group-lead-existing-${suffix}`,
};

beforeAll(async () => {
  await db.company.createMany({ data: [
    { id: ids.companyA, name: `组长账号公司A-${suffix}` },
    { id: ids.companyB, name: `组长账号公司B-${suffix}` },
  ] });
  await db.department.createMany({ data: [
    { id: ids.deptA1, name: `组长账号A一部-${suffix}`, companyId: ids.companyA, countryCode: "CN", timezone: "Asia/Shanghai" },
    { id: ids.deptA2, name: `组长账号A二部-${suffix}`, companyId: ids.companyA, countryCode: "DE", timezone: "Europe/Berlin" },
    { id: ids.deptB1, name: `组长账号B一部-${suffix}`, companyId: ids.companyB, countryCode: "US", timezone: "America/New_York" },
  ] });
  await db.teamGroup.createMany({ data: [
    { id: ids.groupDeptOwn, name: `部门自建组长组-${suffix}`, departmentId: ids.deptA1, timezone: "Asia/Shanghai" },
    { id: ids.groupCompanyOwn, name: `公司自建组长组-${suffix}`, departmentId: ids.deptA2, timezone: "Europe/Berlin" },
    { id: ids.groupHq, name: `总公司自建组长组-${suffix}`, departmentId: ids.deptB1, timezone: "America/New_York" },
    { id: ids.groupAdmin, name: `系统自建组长组-${suffix}`, departmentId: ids.deptB1, timezone: "America/New_York" },
    { id: ids.groupOccupied, name: `已有组长组-${suffix}`, departmentId: ids.deptA1, timezone: "Asia/Shanghai" },
    { id: ids.groupDuplicateFirst, name: `重复账号一组-${suffix}`, departmentId: ids.deptA1, timezone: "Asia/Shanghai" },
    { id: ids.groupDuplicateSecond, name: `重复账号二组-${suffix}`, departmentId: ids.deptA1, timezone: "Asia/Shanghai" },
    { id: ids.groupRollback, name: `事务回滚组-${suffix}`, departmentId: ids.deptA1, timezone: "Asia/Shanghai" },
    { id: ids.groupFuture, name: `跨日校验组-${suffix}`, departmentId: ids.deptB1, timezone: "America/New_York" },
  ] });
  await db.user.createMany({ data: [
    { id: ids.hq, username: ids.hq, name: "总公司管理员", role: "COMPANY_MANAGER", duty: "HQ_MANAGER" },
    { id: ids.companyAManager, username: ids.companyAManager, name: "A公司管理员", role: "COMPANY_MANAGER", duty: "COMPANY_MANAGER", companyId: ids.companyA },
    { id: ids.deptA1Manager, username: ids.deptA1Manager, name: "A一部部门管理员", role: "COMPANY_MANAGER", duty: "DEPARTMENT_MANAGER", departmentId: ids.deptA1 },
    { id: ids.admin, username: ids.admin, name: "系统管理员", role: "ADMIN" },
    { id: ids.plainLead, username: ids.plainLead, name: "普通组长", role: "LEAD" },
    { id: ids.occupiedLead, username: ids.occupiedLead, name: "已存在组长", role: "LEAD", duty: "LEAD", groupId: ids.groupOccupied },
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
  const user = await db.user.findUniqueOrThrow({ where: { id } });
  vi.spyOn(auth, "requireUser").mockResolvedValue(user as auth.SessionUser);
}

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/org/group-leads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody(groupId: string, username = `new-group-lead-${randomUUID()}`) {
  return {
    groupId,
    username,
    name: "新建组长",
    password: "temporary-password-1",
    effectiveOn: "2026-08-20",
  };
}

describe.sequential("组织架构：给空缺小组开设全新组长账号", () => {
  it("lets a department manager create a lead in their own department and writes every linked record atomically", async () => {
    await signInAs(ids.deptA1Manager);
    const body = validBody(ids.groupDeptOwn);
    const response = await createGroupLeadAccount(request(body));
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created).toMatchObject({
      username: body.username,
      role: "LEAD",
      duty: "LEAD",
      groupId: ids.groupDeptOwn,
      hireDate: body.effectiveOn,
      active: true,
      mustChangePassword: true,
    });

    const stored = await db.user.findUniqueOrThrow({
      where: { id: created.id },
      include: { roleAssignments: true, membershipHistory: true },
    });
    expect(stored.passwordHash).not.toBe(body.password);
    expect(verifyPassword(body.password, stored.passwordHash)).toBe(true);
    expect(stored.roleAssignments.map((assignment) => assignment.role)).toContain("LEAD");
    expect(stored.membershipHistory).toEqual([
      expect.objectContaining({ groupId: ids.groupDeptOwn, role: "LEAD", effectiveFrom: body.effectiveOn, createdById: ids.deptA1Manager }),
    ]);
    await expect(db.auditLog.findMany({ where: { entityType: "User", entityId: created.id } })).resolves.toEqual([
      expect.objectContaining({ action: "ORG_GROUP_LEAD_ACCOUNT_CREATED", actorId: ids.deptA1Manager }),
    ]);
  });

  it("blocks a department manager from creating a lead outside their department", async () => {
    await signInAs(ids.deptA1Manager);
    const body = validBody(ids.groupHq);
    const response = await createGroupLeadAccount(request(body));
    expect(response.status).toBe(403);
    await expect(db.user.findUnique({ where: { username: body.username } })).resolves.toBeNull();
  });

  it("lets a company manager create a lead only inside their company", async () => {
    await signInAs(ids.companyAManager);
    const ownBody = validBody(ids.groupCompanyOwn);
    const ownResponse = await createGroupLeadAccount(request(ownBody));
    expect(ownResponse.status).toBe(201);

    const otherBody = validBody(ids.groupHq);
    const otherResponse = await createGroupLeadAccount(request(otherBody));
    expect(otherResponse.status).toBe(403);
    await expect(db.user.findUnique({ where: { username: otherBody.username } })).resolves.toBeNull();
  });

  it("lets the HQ manager and ADMIN create leads in unrestricted organization scope", async () => {
    await signInAs(ids.hq);
    expect((await createGroupLeadAccount(request(validBody(ids.groupHq)))).status).toBe(201);

    await signInAs(ids.admin);
    expect((await createGroupLeadAccount(request(validBody(ids.groupAdmin)))).status).toBe(201);
  });

  it("blocks a plain lead from opening another lead account", async () => {
    await signInAs(ids.plainLead);
    const body = validBody(ids.groupDuplicateFirst);
    const response = await createGroupLeadAccount(request(body));
    expect(response.status).toBe(403);
    await expect(db.user.findUnique({ where: { username: body.username } })).resolves.toBeNull();
  });

  it("does not overwrite a group that already has an active lead", async () => {
    await signInAs(ids.hq);
    const body = validBody(ids.groupOccupied);
    const response = await createGroupLeadAccount(request(body));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "该小组已经有一位启用中的组长，请使用任免或调动流程" });
    await expect(db.user.findUnique({ where: { username: body.username } })).resolves.toBeNull();
  });

  it("returns 409 for a duplicate username without leaving a second account", async () => {
    await signInAs(ids.hq);
    const username = `duplicate-group-lead-${randomUUID()}`;
    expect((await createGroupLeadAccount(request(validBody(ids.groupDuplicateFirst, username)))).status).toBe(201);
    const duplicate = await createGroupLeadAccount(request(validBody(ids.groupDuplicateSecond, username)));
    expect(duplicate.status).toBe(409);
    await expect(db.user.count({ where: { username } })).resolves.toBe(1);
  });

  it("uses the target group's local date when rejecting a future effective date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T03:30:00Z"));
    try {
      await signInAs(ids.hq);
      const body = { ...validBody(ids.groupFuture), effectiveOn: "2026-09-01" };
      const response = await createGroupLeadAccount(request(body));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "生效日期不能晚于目标小组当地今天 2026-08-31" });
      await expect(db.user.findUnique({ where: { username: body.username } })).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rolls back the account and membership if the audit write fails", async () => {
    await signInAs(ids.hq);
    const body = validBody(ids.groupRollback);
    vi.spyOn(audit, "recordAudit").mockRejectedValueOnce(new Error("forced audit failure"));
    await expect(createGroupLeadAccount(request(body))).rejects.toThrow("forced audit failure");
    await expect(db.user.findUnique({ where: { username: body.username } })).resolves.toBeNull();
    await expect(db.userGroupMembership.count({ where: { groupId: ids.groupRollback } })).resolves.toBe(0);
  });
});
