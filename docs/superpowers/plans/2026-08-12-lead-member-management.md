# Lead Member Management Implementation Plan

> **历史归档，停止执行。** 本文只用于追溯当时的设计或实施过程；涉及资源部确认、手填进群/注册/开单、岗位权限、统计日期或旧前端的内容均不是现行规则。当前口径请看 [当前业务规则](/Users/aaaa/Desktop/数据统计/docs/business/current-business-rules.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each active group lead a dedicated page to create and manage only ordinary members in that lead's own active group.

**Architecture:** Add an isolated lead-only API and page instead of widening the administrator center. Centralize lead-to-member scope validation in a small server helper, then use a dedicated member table and drawer that never expose role or group selectors. Every mutation rechecks the actor, group, and target inside the transaction and records the existing audit events.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, SQLite, React, Tailwind CSS, Phosphor Icons, Vitest, Playwright.

## Global Constraints

- A lead can manage only users with role `MEMBER` in the lead's own group.
- The lead's group must be active for creates and mutations.
- Created users are forced to `role=MEMBER` and the lead's `groupId` on the server.
- `role` and `groupId` fields in lead requests are rejected.
- Leads may edit name and username, reset password, disable, and re-enable.
- Leads cannot manage themselves, administrators, leads, or users from another group.
- All successful mutations create audit records; password resets revoke existing sessions.
- Administrators keep the existing administrator center; members never see this feature.
- Implementation is completed before the final test pass, per user instruction.

---

### Task 1: Lead authorization and mutation service

**Files:**
- Create: `src/lib/lead-members.ts`
- Create: `src/app/api/lead/members/route.ts`
- Reuse: `src/lib/auth.ts`, `src/lib/audit.ts`, `src/app/api/admin/users/validation.ts`

**Interfaces:**
- Produces: lead-only `GET`, `POST`, and `PATCH` handlers at `/api/lead/members`.
- Produces: safe member payload without `passwordHash`.

- [x] **Step 1: Add lead request authorization**
  - Require role `LEAD`.
  - Return 401 for no login and 403 for another role.
  - Require an active actor group.

- [x] **Step 2: Implement scoped member listing**
  - Query only `role=MEMBER` and `groupId=actor.groupId`.
  - Select safe member fields and group name only.

- [x] **Step 3: Implement member creation**
  - Accept only `username`, `name`, and `password`.
  - Reject request bodies containing `role` or `groupId`.
  - Force `role=MEMBER` and the actor's group.
  - Validate non-empty fields, password length, group status, and unique username.
  - Record `MEMBER_CREATED`.

- [x] **Step 4: Implement member update**
  - Accept `id` plus name, username, password, or active.
  - Reject role and group fields.
  - Recheck target role/group and actor group in one transaction.
  - Use generic `无权管理该组员` for nonexistent or out-of-scope targets.
  - Revoke sessions on password reset; record `MEMBER_PASSWORD_RESET` for password changes, `MEMBER_STATUS_CHANGED` for activation changes, and `MEMBER_UPDATED` for profile changes.

- [x] **Step 5: Commit**
  - Commit message: `feat: add lead member management API`.

### Task 2: Dedicated lead member page

**Files:**
- Create: `src/app/(app)/team-members/page.tsx`
- Create: `src/components/lead-members/LeadMemberManager.tsx`
- Create: `src/components/lead-members/LeadMemberTable.tsx`
- Create: `src/components/lead-members/LeadMemberDrawer.tsx`
- Modify: `src/components/shell/AppSidebar.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `/api/lead/members`.
- Produces: lead-only route `/team-members` and conditional navigation entry `组员管理`.

- [x] **Step 1: Add conditional navigation**
  - Show `组员管理` only for role `LEAD`.
  - Keep `管理员中心` only for role `ADMIN`.

- [x] **Step 2: Build the scoped page**
  - Require role `LEAD`.
  - Load only same-group ordinary members.
  - Show a clear disabled message if the lead's group is unavailable or inactive.

- [x] **Step 3: Build table and filters**
  - Columns: member, username, status, last login, action.
  - Filters: name/username search and active status.
  - Keep existing desktop table and narrow-screen horizontal scrolling patterns.

- [x] **Step 4: Build create/edit drawer**
  - Create fields: name, username, initial password.
  - Show role as read-only `组员` and group as the current group.
  - Edit supports name and username.
  - Separate confirmations support password reset and status change.
  - Keep entered values when the API returns an error.

- [x] **Step 5: Commit**
  - Commit message: `feat: add lead member management page`.

### Task 3: Post-development verification

**Files:**
- Create: `tests/e2e/lead-member-management.spec.ts`
- Create or modify: `tests/unit/lead-members.test.ts`
- Modify: `tests/unit/navigation.test.ts`
- Modify: `docs/superpowers/plans/2026-08-12-lead-member-management.md`

**Interfaces:**
- Verifies the API, browser flow, audit effects, authentication behavior, and unchanged existing workflows.

- [x] **Step 1: Add service and permission checks**
  - Verify role/group fields are rejected.
  - Verify cross-group users, leads, administrators, and nonexistent IDs receive the generic denial.
  - Verify safe payloads never contain `passwordHash`.

- [x] **Step 2: Add browser acceptance flow**
  - Lead creates a member and the new account logs in.
  - Lead edits name and username.
  - Lead resets password; old password and old session fail, new password succeeds.
  - Lead disables and re-enables the member.
  - Member has no navigation entry and no API/page access.
  - Administrator can see lead actions in the audit log.

- [x] **Step 3: Run focused checks**
  - Run `npm test -- --run tests/unit/lead-members.test.ts tests/unit/navigation.test.ts`.
  - Run `CI=1 npm run test:e2e -- --reporter=line tests/e2e/lead-member-management.spec.ts`.

- [x] **Step 4: Run full verification**
  - Run `npm test -- --run`.
  - Run `CI=1 npm run test:e2e -- --reporter=line`.
  - Run `npm run build`.
  - Run `git diff --check`.

- [x] **Step 5: Browser review and commit**
  - Open the lead page in the in-app browser at the normal desktop viewport.
  - Confirm search, status filter, create drawer, edit drawer, password reset, and status confirmation.
  - Commit message: `test: verify lead member management`.
