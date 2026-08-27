import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { POST as createDepartment } from "../../src/app/api/admin/departments/route";
import { POST as createGroup } from "../../src/app/api/admin/groups/route";
import { resolveAnalysisScope } from "../../src/lib/analytics/scope";

const isolatedDatabase = vi.hoisted(() => ({ directory: "" }));
vi.mock("../../src/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { execFileSync } = await import("node:child_process");
  const { closeSync, mkdtempSync, openSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "departments-"));
  const databasePath = join(directory, "test.db");
  closeSync(openSync(databasePath, "w"));
  execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: `file:${databasePath}` } });
  isolatedDatabase.directory = directory;
  return { db: new PrismaClient({ datasourceUrl: `file:${databasePath}` }) };
});

const suffix = randomUUID();
const ids = { admin: `department-admin-${suffix}`, resource: `department-resource-${suffix}` };

beforeAll(async () => {
  await db.user.createMany({ data: [
    { id: ids.admin, username: ids.admin, name: "管理员", role: "ADMIN" },
    { id: ids.resource, username: ids.resource, name: "资源部管理员", role: "RESOURCE_MANAGER" },
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
    vi.spyOn(auth, "requireRole").mockImplementation(async (...roles) => {
      if (!roles.includes(user.role)) throw new auth.AuthorizationError(undefined, user);
      return user;
    });
  });
}

describe.sequential("department and resource manager permissions", () => {
  it("lets an administrator create a department and place a group inside it", async () => {
    await signInAs(ids.admin);
    const departmentResponse = await createDepartment(new Request("http://localhost/api/admin/departments", { method: "POST", body: JSON.stringify({ name: "A 部门" }) }));
    expect(departmentResponse.status).toBe(201);
    const department = await departmentResponse.json();
    const groupResponse = await createGroup(new Request("http://localhost/api/admin/groups", { method: "POST", body: JSON.stringify({ name: "A 一组", departmentId: department.id }) }));
    expect(groupResponse.status).toBe(201);
    await expect(db.teamGroup.findFirstOrThrow({ where: { name: "A 一组" }, include: { department: true } })).resolves.toMatchObject({ department: { name: "A 部门" } });
  });

  it("keeps the resource manager out of administration but lets it read every report group", async () => {
    await signInAs(ids.resource);
    expect((await createDepartment(new Request("http://localhost/api/admin/departments", { method: "POST", body: JSON.stringify({ name: "越权部门" }) }))).status).toBe(403);
    const groups = await db.teamGroup.findMany({ select: { id: true } });
    const scope = resolveAnalysisScope(await db.user.findUniqueOrThrow({ where: { id: ids.resource } }), {}, "2026-08-15", groups.map((group) => group.id));
    expect(scope.role).toBe("RESOURCE_MANAGER");
    expect(scope.groupIds).toEqual(groups.map((group) => group.id));
  });
});
