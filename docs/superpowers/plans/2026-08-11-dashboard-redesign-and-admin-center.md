# Dashboard Redesign And Admin Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the existing data-statistics app around the selected black/white/blue dashboard design and deliver the complete admin, group-shared custom-channel, audit-log, settings, and reporting behavior defined in the approved spec.

**Architecture:** Extend the existing Prisma/SQLite model with audit and settings records, keep all authorization in route handlers, and make new-fan row saves transactionally resolve or create group-scoped channels. Build the visual system as reusable shell, table, drawer, field, badge, and chart components, then migrate each existing route without replacing the current domain logic.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS 4, Prisma 6 with SQLite, Zod 4, Vitest, Playwright, Phosphor Icons, Recharts.

## Global Constraints

- Preserve existing logins, permissions, history, source-batch attribution, conversion formulas, and stored data.
- Use the approved visual reference at `docs/superpowers/specs/assets/team-dashboard-direction-2.png`.
- Keep the UI copy in Chinese and desktop-first; narrow screens must remain operable.
- Members and leads create channels only inside their own active group; admins explicitly choose a group.
- Normalize channel names by trimming, collapsing whitespace, and lowercasing before group-level duplicate checks.
- Newly created channels are immediately shared with the same group and automatically included in report filters and aggregation.
- Recharge remains an amount; orders remain a count; order rate remains orders divided by new fans.
- Never expose an existing password. A reset replaces it with a newly supplied temporary password.
- Use Phosphor Icons for UI icons and Recharts for data charts; do not draw substitute icons or charts with CSS shapes.
- Every task follows red-green-refactor testing and ends in a focused commit.

---

### Task 1: Persistence Foundation And Audit Service

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260811160000_admin_center_foundation/migration.sql`
- Modify: `prisma/seed.ts`
- Create: `src/lib/channel-names.ts`
- Create: `src/lib/audit.ts`
- Create: `src/lib/settings.ts`
- Create: `tests/unit/channel-names.test.ts`
- Create: `tests/unit/settings.test.ts`

**Interfaces:**
- Produces: `normalizeChannelName(name: string): string`.
- Produces: `recordAudit(client, input): Promise<void>` where `input` has `actorId`, `action`, `entityType`, `entityId`, and `summary`.
- Produces: `getSystemSettings()` and `updateSystemSettings(input, actorId)` using keys `appName`, `timezone`, `defaultReportMode`, and `allowMemberChannelCreation`.

- [x] **Step 1: Write failing normalization and settings tests**

```ts
expect(normalizeChannelName("  抖音   直播 ")).toBe("抖音 直播");
expect(normalizeChannelName("TELEGRAM")).toBe("telegram");
expect(parseSystemSettings({ defaultReportMode: "bad" })).toEqual({
  success: false,
  error: "默认报表模式不正确",
});
```

- [x] **Step 2: Run the focused tests and confirm they fail for missing modules**

Run: `npm test -- tests/unit/channel-names.test.ts tests/unit/settings.test.ts --run`

- [x] **Step 3: Add persistence fields and migration**

Add `User.lastLoginAt`, `User.createdChannels`, `User.auditLogs`, `Channel.normalizedName`, `Channel.createdById`, `Channel.createdBy`, and:

```prisma
model AuditLog {
  id         String   @id @default(cuid())
  actorId    String
  action     String
  entityType String
  entityId   String
  summary    String
  actor      User     @relation(fields: [actorId], references: [id])
  createdAt  DateTime @default(now())
}

model SystemSetting {
  key         String   @id
  value       String
  updatedById String?
  updatedAt   DateTime @updatedAt
}
```

Add `@@unique([groupId, normalizedName])` to `Channel`. The migration must backfill every existing channel's normalized name before creating the unique index. Seed the four settings keys without overwriting user-edited values.

- [x] **Step 4: Implement the normalization, audit, and settings helpers**

`normalizeChannelName` returns `name.trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN")`. `recordAudit` JSON-stringifies a stable summary object. Settings parsing accepts only `cumulative | incremental`, a non-empty display name, an IANA timezone string already supported by `Intl.DateTimeFormat`, and a boolean channel-creation flag.

- [x] **Step 5: Generate Prisma client, migrate the isolated test database, and run tests**

Run: `npm run db:generate && npm test -- tests/unit/channel-names.test.ts tests/unit/settings.test.ts --run`

- [x] **Step 6: Commit**

```bash
git add prisma src/lib tests/unit
git commit -m "feat: add admin audit and settings foundation"
```

### Task 2: Group-Shared Channels From New-Fan Rows

**Files:**
- Modify: `src/lib/validation.ts`
- Create: `src/lib/channels.ts`
- Modify: `src/app/api/batches/route.ts`
- Modify: `src/app/api/admin/channels/route.ts`
- Modify: `src/app/(app)/entry/page.tsx`
- Modify: `src/components/entry/EntryTabs.tsx`
- Modify: `src/components/entry/NewFansForm.tsx`
- Create: `src/components/entry/ChannelCombobox.tsx`
- Modify: `tests/unit/validation.test.ts`
- Modify: `tests/e2e/data-entry.spec.ts`
- Modify: `tests/e2e/role-workflow.spec.ts`

**Interfaces:**
- Consumes: `normalizeChannelName` and `recordAudit` from Task 1.
- Produces: `resolveOrCreateChannel(transaction, { actor, groupId, channelId?, channelName? })` returning an active `Channel`.
- Changes new-fan rows to `{ sourceDate, quantity, groupId?, channelId?, channelName? }`, requiring exactly one of `channelId` or `channelName`.

- [x] **Step 1: Add failing request and browser tests**

```ts
expect(parseNewFansInput({ sourceDate: "2026-08-11", quantity: 4, channelName: "抖音直播" })).toMatchObject({
  channelName: "抖音直播",
});
```

The Playwright test logs in as `member`, opens 获粉, adds a row, types a new channel name, saves quantity `4`, adds another row, and confirms the same channel appears as an existing choice without a duplicate.

- [x] **Step 2: Run focused tests and confirm the missing custom-channel behavior fails**

Run: `npm test -- tests/unit/validation.test.ts --run && CI=1 npx playwright test tests/e2e/data-entry.spec.ts tests/e2e/role-workflow.spec.ts --reporter=line`

- [x] **Step 3: Implement transactional channel resolution**

`resolveOrCreateChannel` must:

1. Reject inactive users and groups.
2. Force members and leads to `actor.groupId`.
3. Require admins to supply `groupId` for new names.
4. Reuse an active channel found by `[groupId, normalizedName]`.
5. Reject a disabled matching channel with “该渠道已停用，请联系管理员重新启用”.
6. Read `allowMemberChannelCreation` and reject non-admin creation when the setting is disabled.
7. Create the channel with `createdById` and add a `CHANNEL_CREATED` audit entry.

Call it inside the same transaction that creates `SourceBatch` and `MetricEvent` so partial saves cannot remain.

- [x] **Step 4: Build the searchable creatable channel control**

`ChannelCombobox` owns `query`, `open`, and keyboard/selection state. It displays filtered group-allowed choices and exactly one create action labeled `创建渠道：{trimmedName}` when no normalized match exists. `NewFansForm` submits `channelId` for a choice or `channelName` for a new value and preserves rows on failure.

- [x] **Step 5: Run focused tests and confirm group sharing, isolation, and report ingestion**

Run: `npm test -- tests/unit/validation.test.ts tests/unit/channel-names.test.ts --run && CI=1 npx playwright test tests/e2e/data-entry.spec.ts tests/e2e/role-workflow.spec.ts tests/e2e/reports.spec.ts --reporter=line`

- [x] **Step 6: Commit**

```bash
git add src tests
git commit -m "feat: create shared channels from new fan rows"
```

### Task 3: Complete Member Lifecycle And Password Reset

**Files:**
- Modify: `src/app/api/auth/login/route.ts`
- Modify: `src/app/api/admin/users/route.ts`
- Create: `src/components/admin/AdminSectionNav.tsx`
- Create: `src/components/admin/MemberTable.tsx`
- Create: `src/components/admin/MemberDrawer.tsx`
- Refactor: `src/components/admin/MemberManager.tsx`
- Modify: `src/app/(app)/admin/page.tsx`
- Modify: `tests/unit/admin-auth-errors.test.ts`
- Modify: `tests/e2e/admin-management.spec.ts`
- Modify: `tests/e2e/auth-landing.spec.ts`

**Interfaces:**
- Consumes: `recordAudit` from Task 1.
- Produces: `PATCH /api/admin/users` accepting `name`, `username`, `password`, `role`, `groupId`, and `active`.
- Produces member list data including `lastLoginAt` and group details.

- [x] **Step 1: Write failing route and browser tests**

Cover editing name/username, changing role/group, disabling and re-enabling, resetting a password, rejecting a duplicate username, rejecting self-disable, and rejecting disable of the last active admin. Verify the old password fails and the new temporary password succeeds.

- [x] **Step 2: Run the focused tests and confirm lifecycle operations are unavailable**

Run: `npm test -- tests/unit/admin-auth-errors.test.ts --run && CI=1 npx playwright test tests/e2e/admin-management.spec.ts tests/e2e/auth-landing.spec.ts --reporter=line`

- [x] **Step 3: Extend login and member routes**

After successful authentication, update `lastLoginAt`. In member PATCH, trim editable identity fields, hash a supplied temporary password, invalidate the target user's existing sessions after a password reset, enforce role/group rules, and write one audit entry summarizing changed field names without writing password content. Return Prisma unique conflicts as `登录账号已存在`.

- [x] **Step 4: Implement table, filters, and right-side drawer**

Match the selected design: searchable member table, group/role/status selects, role and state badges, a unique row action menu, and one drawer used for add/edit. The drawer exposes 保存修改, 重置密码, 启用账号 or 停用账号 and uses an explicit confirmation state before risky actions.

- [x] **Step 5: Run focused tests**

Run: `npm test -- tests/unit/admin-auth-errors.test.ts tests/unit/auth.test.ts --run && CI=1 npx playwright test tests/e2e/admin-management.spec.ts tests/e2e/auth-landing.spec.ts --reporter=line`

- [x] **Step 6: Commit**

```bash
git add src tests
git commit -m "feat: complete administrator member lifecycle"
```

### Task 4: Complete Group And Channel Lifecycle

**Files:**
- Modify: `src/app/api/admin/groups/route.ts`
- Modify: `src/app/api/admin/channels/route.ts`
- Refactor: `src/components/admin/GroupManager.tsx`
- Refactor: `src/components/admin/ChannelManager.tsx`
- Create: `src/components/admin/GroupTable.tsx`
- Create: `src/components/admin/ChannelTable.tsx`
- Create: `tests/unit/admin-validation.test.ts`
- Modify: `tests/e2e/admin-management.spec.ts`

**Interfaces:**
- Consumes: `normalizeChannelName` and `recordAudit` from Task 1.
- Produces PATCH behavior for `name` and `active` on both groups and channels.
- Produces searchable/filterable group and channel tables with edit drawers.

- [x] **Step 1: Write failing tests for rename and re-enable operations**

Test group create/rename/disable/re-enable and channel create/rename/disable/re-enable. Assert duplicate normalized channel names in one group fail while the same display name in another group succeeds.

- [x] **Step 2: Run tests and confirm the existing APIs cannot meet the lifecycle contract**

Run: `npm test -- tests/unit/admin-validation.test.ts --run && CI=1 npx playwright test tests/e2e/admin-management.spec.ts --reporter=line`

- [x] **Step 3: Extend route handlers and audit every mutation**

Groups accept a trimmed `name` and/or `active`. Channels accept `name`, recompute `normalizedName`, and/or accept `active`. Map uniqueness errors to `该小组已有同名渠道`. Record action names `GROUP_CREATED`, `GROUP_UPDATED`, `GROUP_STATUS_CHANGED`, `CHANNEL_CREATED`, `CHANNEL_UPDATED`, and `CHANNEL_STATUS_CHANGED`.

- [x] **Step 4: Replace stacked cards with section tables and drawers**

Group rows show name, member count, channel count, status, and actions. Channel rows show name, group, creator, created time, source-batch count, status, and actions. Both sections provide search and status filters; channels add a group filter.

- [x] **Step 5: Run focused tests**

Run: `npm test -- tests/unit/admin-validation.test.ts tests/unit/channel-names.test.ts --run && CI=1 npx playwright test tests/e2e/admin-management.spec.ts --reporter=line`

- [x] **Step 6: Commit**

```bash
git add src tests
git commit -m "feat: complete group and channel administration"
```

### Task 5: Audit Log And System Settings

**Files:**
- Create: `src/app/api/admin/audit-logs/route.ts`
- Create: `src/app/api/admin/settings/route.ts`
- Create: `src/components/admin/AuditLogTable.tsx`
- Create: `src/components/admin/SystemSettingsForm.tsx`
- Modify: `src/app/(app)/admin/page.tsx`
- Create: `tests/unit/admin-settings-auth.test.ts`
- Modify: `tests/e2e/admin-management.spec.ts`

**Interfaces:**
- Consumes: `getSystemSettings`, `updateSystemSettings`, and audit records from Task 1.
- Produces: admin-only GET for logs and GET/PATCH for settings.

- [x] **Step 1: Write failing permission, filtering, persistence, and UI tests**

Assert non-admin users receive `403`; admins can filter logs by date, actor, and action; settings retain values after refresh; and changing settings appends `SYSTEM_SETTINGS_UPDATED` without logging sensitive values.

- [x] **Step 2: Run focused tests and confirm routes and tabs are absent**

Run: `npm test -- tests/unit/admin-settings-auth.test.ts --run && CI=1 npx playwright test tests/e2e/admin-management.spec.ts --reporter=line`

- [x] **Step 3: Implement admin-only routes**

Audit GET accepts `from`, `to`, `actorId`, and `action`, orders newest first, and returns actor name. Settings PATCH validates all four values, writes them transactionally, and records the changed keys.

- [x] **Step 4: Implement the two admin sections**

Audit log uses a compact read-only table with the planned filters. Settings uses labeled fields for system name, timezone, default report mode, and member channel creation, plus a single 保存设置 button and inline status feedback.

- [x] **Step 5: Run focused tests**

Run: `npm test -- tests/unit/settings.test.ts tests/unit/admin-settings-auth.test.ts --run && CI=1 npx playwright test tests/e2e/admin-management.spec.ts --reporter=line`

- [x] **Step 6: Commit**

```bash
git add src tests
git commit -m "feat: add audit log and system settings"
```

### Task 6: Shared Visual System And Application Shell

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/app/globals.css`
- Modify: `src/app/(app)/layout.tsx`
- Create: `src/components/shell/AppSidebar.tsx`
- Create: `src/components/shell/AppHeader.tsx`
- Create: `src/components/ui/Button.tsx`
- Create: `src/components/ui/Badge.tsx`
- Create: `src/components/ui/Drawer.tsx`
- Create: `src/components/ui/Field.tsx`
- Create: `src/components/ui/SectionHeader.tsx`
- Create: `src/components/ui/DataTable.tsx`
- Modify: `tests/e2e/auth-landing.spec.ts`

**Interfaces:**
- Produces reusable UI primitives with `className` passthrough and semantic HTML.
- Produces the selected design's global sidebar and header for every authenticated route.

- [x] **Step 1: Add failing shell checks**

The browser test verifies the navigation items 工作台, 数据录入, 历史记录, 转化报表, and 管理员中心; an active-link state; current user/role; and a working 退出登录 action.

- [x] **Step 2: Run the shell test and confirm the missing workbench and logout behavior fail**

Run: `CI=1 npx playwright test tests/e2e/auth-landing.spec.ts --reporter=line`

- [x] **Step 3: Install visual dependencies**

Run: `npm install @phosphor-icons/react recharts`

- [x] **Step 4: Define tokens and primitives**

Use CSS variables for `--navy-950: #0b111b`, `--blue-600: #0b66ff`, neutral borders, status colors, 8/12px radii, and a 14-16px body scale. Primitives must preserve native focus states, labels, and keyboard behavior.

- [x] **Step 5: Rebuild the authenticated shell**

The global sidebar is 224px on desktop with icon + label links and user information pinned at the bottom. The header contains breadcrumb/title context, date, user role, and logout. Below 900px, navigation becomes a compact top area and content keeps full-width controls.

- [x] **Step 6: Run shell tests and build**

Run: `CI=1 npx playwright test tests/e2e/auth-landing.spec.ts --reporter=line && npm run build`

- [x] **Step 7: Commit**

```bash
git add package.json package-lock.json src tests/e2e/auth-landing.spec.ts
git commit -m "feat: add selected dashboard visual system"
```

### Task 7: Data Report Workbench

**Files:**
- Create: `src/app/(app)/dashboard/page.tsx`
- Create: `src/components/dashboard/DashboardFilters.tsx`
- Create: `src/components/dashboard/DashboardMetricGrid.tsx`
- Create: `src/components/dashboard/ConversionTrendChart.tsx`
- Create: `src/components/dashboard/RecentActivity.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/lib/navigation.ts`
- Modify: `src/app/api/auth/login/route.ts`
- Modify: `tests/unit/navigation.test.ts`
- Create: `tests/e2e/dashboard.spec.ts`
- Modify: `tests/e2e/auth-landing.spec.ts`

**Interfaces:**
- Consumes: existing report builder, `calculateConversionRates`, and Recharts.
- Produces `/dashboard` as the post-login landing page.
- Produces channel comparison rows that merge equal normalized channel names only when the selected group scope contains more than one group, while retaining per-group detail in the detailed report table.

- [x] **Step 1: Write failing navigation and dashboard tests**

Assert no `next` parameter returns `/dashboard`; successful login lands there; metric cards render all nine totals; rates render all five formulas; filters update the URL; the trend chart and recent activity sections render.

- [x] **Step 2: Run tests and confirm `/dashboard` is missing**

Run: `npm test -- tests/unit/navigation.test.ts --run && CI=1 npx playwright test tests/e2e/dashboard.spec.ts tests/e2e/auth-landing.spec.ts --reporter=line`

- [x] **Step 3: Build the server page and filters**

Reuse the permissions and query mapping from the reports page. Default to the saved report mode and render current readable groups, members, and channels. Filters submit query parameters so refresh and sharing preserve the selected view.

- [x] **Step 4: Build metric, trend, and activity sections**

Use compact cards for totals, a Recharts responsive line/bar combination for daily conversion stages, existing conversion formulas for rates, and a recent activity table sourced from newest events. Add an anomaly list for batches that have replies but zero new-fan events in the selected period. Show a clear empty state when no data matches.

- [x] **Step 5: Run dashboard tests and build**

Run: `npm test -- tests/unit/navigation.test.ts tests/unit/metrics.test.ts --run && CI=1 npx playwright test tests/e2e/dashboard.spec.ts tests/e2e/auth-landing.spec.ts --reporter=line && npm run build`

- [x] **Step 6: Commit**

```bash
git add src tests
git commit -m "feat: add data report workbench"
```

### Task 8: Restyle Entry, History, Reports, Login, And Admin Surfaces

**Files:**
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/(app)/entry/page.tsx`
- Modify: `src/app/(app)/history/page.tsx`
- Modify: `src/app/(app)/reports/page.tsx`
- Modify: `src/app/(app)/admin/page.tsx`
- Modify: `src/components/entry/EntryTabs.tsx`
- Modify: `src/components/entry/NewFansForm.tsx`
- Modify: `src/components/entry/RepliesForm.tsx`
- Modify: `src/components/entry/GroupChangesForm.tsx`
- Modify: `src/components/entry/ConversionForm.tsx`
- Modify: `src/components/history/EventHistoryTable.tsx`
- Modify: `src/components/reports/ReportFilters.tsx`
- Modify: `src/components/reports/MetricCards.tsx`
- Modify: `src/components/reports/FunnelChart.tsx`
- Modify: `src/components/reports/ChannelComparison.tsx`
- Modify: `src/components/reports/BatchReportTable.tsx`
- Modify: `tests/e2e/data-entry.spec.ts`
- Modify: `tests/e2e/history-permissions.spec.ts`
- Modify: `tests/e2e/reports.spec.ts`

**Interfaces:**
- Consumes: Task 6 UI primitives and the selected visual reference.
- Produces a consistent visual language across all routes without changing domain formulas.

- [x] **Step 1: Add failing page-structure and interaction assertions**

Assert the entry step rail has four steps and only one visible panel; each form supports add/remove/save; history and reports have compact filter toolbars and table containers; admin has two-level navigation and a right-side drawer.

- [x] **Step 2: Run focused browser tests and capture the expected failures**

Run: `CI=1 npx playwright test tests/e2e/data-entry.spec.ts tests/e2e/history-permissions.spec.ts tests/e2e/reports.spec.ts tests/e2e/admin-management.spec.ts --reporter=line`

- [x] **Step 3: Apply the selected form-flow layout to data entry**

Use the white contextual step rail, dark active step, single primary blue save button, grouped fields, fixed action hierarchy, and responsive stacking. Preserve every existing input and API payload.

- [x] **Step 4: Apply the shared tables and toolbars to history, reports, and admin**

Use compact header rows, consistent filter heights, restrained badges, aligned numeric cells, horizontal overflow on narrow widths, and readable zero/empty states. Replace the old three-card admin grid with section navigation and one main surface.

- [x] **Step 5: Align login with the same brand language**

Keep the accessible card and demo credentials while switching the mark, typography, field styles, button, and background to the selected system.

- [x] **Step 6: Run focused and full browser tests**

Run: `CI=1 npx playwright test tests/e2e/data-entry.spec.ts tests/e2e/history-permissions.spec.ts tests/e2e/reports.spec.ts tests/e2e/admin-management.spec.ts tests/e2e/auth-landing.spec.ts --reporter=line`

- [x] **Step 7: Commit**

```bash
git add src tests
git commit -m "feat: apply dashboard design across all workflows"
```

### Task 9: Full Regression, Visual QA, Documentation, And Handoff

**Files:**
- Create: `design-qa.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-11-dashboard-redesign-and-admin-center.md`

**Interfaces:**
- Consumes: all prior tasks and `docs/superpowers/specs/assets/team-dashboard-direction-2.png`.
- Produces: a verified, documented, running local application and a passing visual-QA report.

- [x] **Step 1: Run database, unit, browser, and production checks**

Run:

```bash
npm run db:generate
npm test -- --run
CI=1 npm run test:e2e -- --reporter=line
npm run build
git diff --check
```

- [x] **Step 2: Start the app and capture matching states in the in-app browser**

Capture `/dashboard`, `/entry` with one new-fan row, `/reports`, and `/admin` with the member drawer open at the same desktop viewport used for the reference comparison. Verify primary navigation, filters, step switching, add/remove row, drawer open/close, member update, password reset, group/channel enable state, settings save, and log filtering.

- [x] **Step 3: Run the Product Design design-QA gate**

Open the selected reference and each captured implementation state together. Record P0-P3 findings in `design-qa.md`; fix every P0, P1, and P2; repeat capture and comparison until the file ends with `final result: passed`.

- [x] **Step 4: Update README for nontechnical operation**

Document one-command startup, the exact local URL, demo accounts, the five main areas, how members create shared channels, how administrators reset passwords, and how to stop/restart the local service.

- [x] **Step 5: Re-run the complete verification after visual fixes**

Run:

```bash
npm test -- --run
CI=1 npm run test:e2e -- --reporter=line
npm run build
git diff --check
git status --short
```

- [x] **Step 6: Commit**

```bash
git add README.md design-qa.md docs/superpowers/plans/2026-08-11-dashboard-redesign-and-admin-center.md src tests prisma package.json package-lock.json
git commit -m "chore: verify and document dashboard redesign"
```
