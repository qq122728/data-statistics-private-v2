import { describe, expect, it, vi } from "vitest";
import {
  applyDepartmentManagerDutyBackfill,
  planDepartmentManagerDutyBackfill,
} from "../../scripts/backfill-department-manager-duty-lib.mjs";

type FakeUser = { id: string; username: string; name: string; duty: string | null; departmentId: string | null; active: boolean };

// findMany 里真正的 where 逻辑（role: "COMPANY_MANAGER"）在 lib 里是写死的字面量，
// 这里的假 db 只需要照抄 lib 传进来的 role 值本身做筛选即可，不用重新实现 Prisma。
function fakeDbWithRoleFilter(users: (FakeUser & { role: string })[]) {
  return {
    user: {
      findMany: vi.fn(async ({ where }: { where: { role: string } }) => users.filter((user) => user.role === where.role)),
      updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] }; role: string; duty: null }; data: { duty: string } }) => {
        const matched = users.filter((user) => where.id.in.includes(user.id) && user.role === where.role && user.duty === null);
        for (const user of matched) user.duty = data.duty;
        return { count: matched.length };
      }),
    },
  };
}

describe("阶段5a: Role.COMPANY_MANAGER -> Duty.DEPARTMENT_MANAGER 一次性回填", () => {
  it("only plans to backfill accounts whose duty is currently null", async () => {
    const users = [
      { id: "dm-1", username: "dm-1", name: "部门经理1", role: "COMPANY_MANAGER", duty: null, departmentId: "department-a", active: true },
      { id: "dm-2", username: "dm-2", name: "部门经理2", role: "COMPANY_MANAGER", duty: "COMPANY_MANAGER", departmentId: "department-b", active: true },
      { id: "other-1", username: "other-1", name: "非部门经理", role: "LEAD", duty: null, departmentId: null, active: true },
    ];
    const db = fakeDbWithRoleFilter(users);

    const plan = await planDepartmentManagerDutyBackfill(db);

    expect(plan.roleAccounts.map((user: FakeUser) => user.id)).toEqual(["dm-1", "dm-2"]);
    expect(plan.toBackfill.map((user: FakeUser) => user.id)).toEqual(["dm-1"]);
    expect(plan.alreadySet.map((user: FakeUser) => user.id)).toEqual(["dm-2"]);
  });

  it("does not overwrite an account whose duty is already set to something else", async () => {
    const users = [
      { id: "dm-2", username: "dm-2", name: "部门经理2", role: "COMPANY_MANAGER", duty: "COMPANY_MANAGER", departmentId: "department-b", active: true },
    ];
    const db = fakeDbWithRoleFilter(users);

    const plan = await planDepartmentManagerDutyBackfill(db);
    const result = await applyDepartmentManagerDutyBackfill(db, plan.toBackfill);

    expect(result.count).toBe(0);
    expect(users[0].duty).toBe("COMPANY_MANAGER");
  });

  it("backfills every null-duty account exactly once", async () => {
    const users = [
      { id: "dm-1", username: "dm-1", name: "部门经理1", role: "COMPANY_MANAGER", duty: null, departmentId: "department-a", active: true },
      { id: "dm-3", username: "dm-3", name: "部门经理3", role: "COMPANY_MANAGER", duty: null, departmentId: "department-c", active: true },
    ];
    const db = fakeDbWithRoleFilter(users);

    const plan = await planDepartmentManagerDutyBackfill(db);
    const result = await applyDepartmentManagerDutyBackfill(db, plan.toBackfill);

    expect(result.count).toBe(2);
    expect(users.every((user) => user.duty === "DEPARTMENT_MANAGER")).toBe(true);
  });

  it("is idempotent: running it a second time touches zero rows", async () => {
    const users = [
      { id: "dm-1", username: "dm-1", name: "部门经理1", role: "COMPANY_MANAGER", duty: null, departmentId: "department-a", active: true },
    ];
    const db = fakeDbWithRoleFilter(users);

    const firstPlan = await planDepartmentManagerDutyBackfill(db);
    const firstResult = await applyDepartmentManagerDutyBackfill(db, firstPlan.toBackfill);
    expect(firstResult.count).toBe(1);

    const secondPlan = await planDepartmentManagerDutyBackfill(db);
    const secondResult = await applyDepartmentManagerDutyBackfill(db, secondPlan.toBackfill);
    expect(secondPlan.toBackfill).toEqual([]);
    expect(secondResult.count).toBe(0);
    expect(users[0].duty).toBe("DEPARTMENT_MANAGER");
  });

  it("applying an empty plan short-circuits without calling updateMany", async () => {
    const db = fakeDbWithRoleFilter([]);
    const result = await applyDepartmentManagerDutyBackfill(db, []);
    expect(result).toEqual({ count: 0 });
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });
});
