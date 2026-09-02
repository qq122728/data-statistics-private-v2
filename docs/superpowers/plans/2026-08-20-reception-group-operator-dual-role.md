# 接粉与炒群兼任 Implementation Plan

> **历史归档，停止执行。** 本文只用于追溯当时的设计或实施过程；涉及资源部确认、手填进群/注册/开单、岗位权限、统计日期或旧前端的内容均不是现行规则。当前口径请看 [当前业务规则](/Users/aaaa/Desktop/数据统计/docs/business/current-business-rules.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一个账号安全支持接粉与炒群兼任，并同时显示两个工作入口。

**Architecture:** `User.role` 继续是历史兼容的主岗位；新建岗位分配表表示可用岗位。权限判断通过统一的“是否拥有岗位”助手完成，客户责任字段和统计来源不变。菜单根据岗位集合取并集并去重。

**Tech Stack:** Next.js App Router、TypeScript、Prisma（SQLite/PostgreSQL）、Vitest。

**Spec:** `docs/superpowers/specs/2026-08-20-reception-group-operator-dual-role-design.md`

## Global Constraints

- 仅允许 `RECEPTION` 与 `GROUP_OPERATOR` 作为本次兼任岗位。
- 所有写入 API 必须在服务端验证岗位和客户归属。
- 既有单岗位账号的可见菜单、数据范围和报表口径不能改变。
- 不删除、不重写既有用户、客户、订单或事件数据。

---

### Task 1: 岗位分配数据与读取助手

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_user_role_assignments/migration.sql`
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/role-access.ts`
- Test: `tests/unit/role-access.test.ts`

**Interfaces:**
- Produces `SessionUser`：主岗位和 `roleAssignments`。
- Produces `hasAssignedRole(user, role)`：主岗位或兼任岗位存在时返回 `true`。

- [ ] **Step 1: Write the failing test**

```ts
it("recognizes a reception account assigned to group operator", () => {
  expect(hasAssignedRole({ role: "RECEPTION", active: true, roleAssignments: [{ role: "GROUP_OPERATOR" }] }, "GROUP_OPERATOR")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/role-access.test.ts`

- [ ] **Step 3: Add the model, migration and helper**

```prisma
model UserRoleAssignment {
  id String @id @default(cuid())
  userId String
  role Role
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, role])
}
```

The migration inserts every existing `(userId, role)` pair before any UI uses the table.

- [ ] **Step 4: Run test and Prisma type generation**

Run: `npx vitest run tests/unit/role-access.test.ts && npx prisma generate && npx tsc --noEmit`

### Task 2: 账户配置与配合关系

**Files:**
- Modify: `src/app/api/admin/users/route.ts`
- Modify: `src/app/api/lead/members/route.ts`
- Modify: `src/app/api/lead/collaborations/route.ts`
- Modify: `src/components/admin/MemberDrawer.tsx`
- Modify: `src/components/lead-members/LeadMemberDrawer.tsx`
- Test: `tests/unit/admin-user-boundaries.test.ts`
- Test: `tests/unit/lead-collaboration.test.ts`

**Interfaces:**
- Consumes `secondaryRoles?: Role[]` in member write bodies.
- Produces one primary role plus zero or one allowed secondary frontline role.

- [ ] **Step 1: Write failing API tests**

```ts
expect(await updateMember({ role: "RECEPTION", secondaryRoles: ["GROUP_OPERATOR"] })).toMatchObject({ status: 200 });
expect(await updateMember({ role: "RECEPTION", secondaryRoles: ["EXPERT"] })).toMatchObject({ status: 400 });
```

- [ ] **Step 2: Run focused tests to verify failure**

Run: `npx vitest run tests/unit/admin-user-boundaries.test.ts tests/unit/lead-collaboration.test.ts`

- [ ] **Step 3: Implement validated writes and UI checkbox**

Only accept the opposite reception/group-operator role. Write assignment changes in the same transaction as the user edit. Update collaboration lookup to accept users with that assigned role, including a self-to-self pairing.

- [ ] **Step 4: Verify focused tests pass**

Run: `npx vitest run tests/unit/admin-user-boundaries.test.ts tests/unit/lead-collaboration.test.ts`

### Task 3: 双入口与页面/API guards

**Files:**
- Modify: `src/lib/app-navigation.ts`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/app/(app)/entry/page.tsx`
- Modify: `src/app/(app)/group-customers/page.tsx`
- Modify: `src/app/api/leads/route.ts`
- Modify: `src/app/api/leads/check/route.ts`
- Modify: `src/app/api/leads/[leadId]/downstream-progress/route.ts`
- Modify: `src/lib/customer-workflow/access.ts`
- Test: `tests/unit/navigation.test.ts`
- Test: `tests/unit/frontline-role-boundaries.test.ts`

**Interfaces:**
- Consumes `roleAssignments` from `SessionUser`.
- `getVisibleAppNavigationSections(roles)` returns the deduplicated union of each allowed frontline menu.

- [ ] **Step 1: Write failing navigation and access tests**

```ts
expect(getVisibleAppNavigation(["RECEPTION", "GROUP_OPERATOR"]).map(x => x.label)).toContain("接粉工作台");
expect(getVisibleAppNavigation(["RECEPTION", "GROUP_OPERATOR"]).map(x => x.label)).toContain("群内客户");
```

- [ ] **Step 2: Run focused tests to verify failure**

Run: `npx vitest run tests/unit/navigation.test.ts tests/unit/frontline-role-boundaries.test.ts`

- [ ] **Step 3: Implement centralized guards**

Use `hasAssignedRole` in reception and group actions. Preserve customer ownership checks: the same account can use either workflow, but only for its own reception customers or its configured group-operator customers.

- [ ] **Step 4: Verify focused tests pass**

Run: `npx vitest run tests/unit/navigation.test.ts tests/unit/frontline-role-boundaries.test.ts`

### Task 4: Regression verification

**Files:**
- Test: `tests/e2e/current-release-smoke.spec.ts`
- Test: `tests/e2e/admin-management.spec.ts`

- [ ] **Step 1: Add a dual-role smoke scenario**

Create one reception-primary account with group-operator assignment and a self collaboration; import a customer, reply, join group, then assert the same account can view and advance that customer in the group workspace.

- [ ] **Step 2: Run focused verification**

Run: `npx vitest run tests/unit/role-access.test.ts tests/unit/admin-user-boundaries.test.ts tests/unit/lead-collaboration.test.ts tests/unit/navigation.test.ts tests/unit/frontline-role-boundaries.test.ts && npx tsc --noEmit && git diff --check`

- [ ] **Step 3: Run release smoke when local server and DB are ready**

Run: `npx playwright test tests/e2e/current-release-smoke.spec.ts`
