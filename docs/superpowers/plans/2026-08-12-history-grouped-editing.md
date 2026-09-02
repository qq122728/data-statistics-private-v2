# Grouped Editable History Implementation Plan

> **历史归档，停止执行。** 本文只用于追溯当时的设计或实施过程；涉及资源部确认、手填进群/注册/开单、岗位权限、统计日期或旧前端的内容均不是现行规则。当前口径请看 [当前业务规则](/Users/aaaa/Desktop/数据统计/docs/business/current-business-rules.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the metric-per-row history table with date-grouped business records and let each active user safely edit only the groups they originally entered.

**Architecture:** Keep `MetricEvent` as the reporting source of truth, but introduce a pure grouping module that converts events into one UI record per entered-by/date/batch tuple. Add a transactional PATCH operation to `/api/history` that rechecks ownership, active actor status, target batch access, collision state, and a content fingerprint before normalizing each metric to the requested total and writing one audit log. The client renders date sections with compact group rows and uses a dedicated right-side drawer for edits.

**Tech Stack:** Next.js App Router, TypeScript, React, Prisma, SQLite, Zod, Tailwind CSS, Phosphor Icons, Vitest, Playwright.

## Global Constraints

- A group key is `enteredById + occurredOn + batchId`.
- Each logged-in user may edit only groups whose `enteredById` equals their current user ID.
- Members still read only their own data; leads read their group; administrators read all data.
- Leads and administrators cannot edit another person's group.
- Inactive users cannot edit.
- Existing report formulas and conversion definitions must not change.
- Every edit is atomic and records `HISTORY_GROUP_UPDATED` with old/new dates, batches, and metric totals.
- The browser submits a version fingerprint and stale edits return `409` without writing.
- Historical inactive channel/member names remain visible.
- The member selector is hidden for ordinary members.
- Existing source data is never physically deleted; surplus events are normalized to zero.

---

### Task 1: Pure history grouping and edit validation

**Files:**
- Create: `src/lib/history-groups.ts`
- Modify: `src/lib/validation.ts`
- Create: `tests/unit/history-groups.test.ts`

**Interfaces:**
- Consumes: raw history events with event IDs, batch ID/source/channel/group, entered-by identity, dates, and metric values.
- Produces: `groupHistoryEvents(events): HistoryGroup[]`, `buildHistoryGroupFingerprint(events): string`, `historyGroupUpdateSchema`, and `parseHistoryGroupUpdate(input): HistoryGroupUpdateInput`.

- [x] **Step 1: Write failing grouping tests**

Create fixtures containing two `REPLIES` events and one `GROUP_JOIN` event for the same actor/date/batch plus one event for another date. Assert:

```ts
const groups = groupHistoryEvents(events);
expect(groups).toHaveLength(2);
expect(groups[0].metrics).toMatchObject({ replies: 5, groupJoin: 4 });
expect(groups[0].eventIds).toEqual(["event-a", "event-b", "event-c"]);
expect(groups[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
expect(groups[0].key).toBe("member-a::2026-08-12::batch-a");
```

Also assert recharge cents are summed separately, zero-valued events stay in the fingerprint, order is newest occurrence first, and two actors never merge.

- [x] **Step 2: Run the grouping tests and confirm failure**

Run: `npm test -- --run tests/unit/history-groups.test.ts`

Expected: FAIL because `src/lib/history-groups.ts` does not exist.

- [x] **Step 3: Implement focused grouping types and helpers**

Define these exact public types:

```ts
export const historyMetricFields = [
  "newFans", "replies", "groupJoin", "groupLeave",
  "expertIntro", "registration", "order", "rechargeCents",
] as const;

export type HistoryMetricTotals = Record<(typeof historyMetricFields)[number], number>;

export type HistoryGroup = {
  key: string;
  occurredOn: string;
  batchId: string;
  sourceDate: string;
  fingerprint: string;
  eventIds: string[];
  metrics: HistoryMetricTotals;
  batch: { id: string; group: { id: string; name: string; active: boolean }; channel: { id: string; name: string; active: boolean } };
  enteredBy: { id: string; name: string; active: boolean };
};
```

Map Prisma kinds to fields, sum all quantity values and `amountCents`, sort event IDs before hashing stable event tuples, and return groups sorted by `occurredOn DESC`, then source date/channel.

- [x] **Step 4: Add strict PATCH payload validation**

Extend `src/lib/validation.ts` with a strict Zod object that accepts only:

```ts
{
  eventIds: string[];          // nonempty, unique
  fingerprint: string;         // 64 lowercase hex characters
  occurredOn: string;          // existing real-date validation
  batchId: string;             // nonempty
  metrics: {
    newFans: number;
    replies: number;
    groupJoin: number;
    groupLeave: number;
    expertIntro: number;
    registration: number;
    order: number;
    rechargeCents: number;
  };
}
```

All metric values use the existing nonnegative Prisma integer constraint. Export `HistoryGroupUpdateInput` and `parseHistoryGroupUpdate`.

- [x] **Step 5: Add validation tests and run focused tests**

Assert invalid dates, negative/fractional/overflow values, duplicate event IDs, missing metrics, unknown properties, and malformed fingerprints fail; assert a complete payload passes.

Run: `npm test -- --run tests/unit/history-groups.test.ts tests/unit/validation.test.ts`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/lib/history-groups.ts src/lib/validation.ts tests/unit/history-groups.test.ts tests/unit/validation.test.ts
git commit -m "feat: group history metrics into editable records"
```

### Task 2: Secure transactional history update API

**Files:**
- Modify: `src/app/api/history/route.ts`
- Modify: `src/lib/audit.ts` only if a shared audit summary type is needed
- Create: `tests/unit/history-update.test.ts`

**Interfaces:**
- Consumes: `parseHistoryGroupUpdate`, `buildHistoryGroupFingerprint`, the eight metric field/kind mapping, current session user, and `/api/history` PATCH JSON.
- Produces: `PATCH /api/history` returning `{ group: HistoryGroup }` on success; errors use `{ error: string, fields?: Record<string, string[]> }`.

- [x] **Step 1: Write failing API permission and atomicity tests**

Create temp-database fixtures for one member-owned group, another member's group, an inactive member, an active target batch, an inactive target batch, and a cross-group batch. Call `PATCH` directly while mocking `requireUser` and assert:

```ts
expect(ownResponse.status).toBe(200);
expect(otherOwnerResponse.status).toBe(403);
expect(await otherOwnerResponse.json()).toEqual({ error: "无权修改该记录" });
expect(inactiveActorResponse.status).toBe(403);
expect(crossGroupBatchResponse.status).toBe(403);
expect(inactiveBatchResponse.status).toBe(400);
```

Also assert no database row changes after every rejected request.

- [x] **Step 2: Run API tests and confirm failure**

Run: `npm test -- --run tests/unit/history-update.test.ts`

Expected: FAIL because `/api/history` does not export `PATCH`.

- [x] **Step 3: Implement PATCH authentication and group resolution**

In one `Serializable` transaction:

1. Reload the current actor by session ID and require `active=true`.
2. Load all `eventIds` including batch and entered-by fields.
3. Require every requested event to exist and share one original `enteredById + occurredOn + batchId` group.
4. Require original `enteredById === currentActor.id`; otherwise return the same `403 无权修改该记录` used for missing/mixed/foreign groups.
5. Reload every event belonging to that original group, not only the submitted IDs.
6. Recompute and compare the fingerprint; return `409 这组数据已被更新，请刷新后再修改` on mismatch.

- [x] **Step 4: Validate the target batch and collision state**

Load the requested target batch with group/channel state. Allow the unchanged original inactive batch for value-only edits. If `batchId` changes, require active batch, active channel, active group, and:

- administrator: any active group;
- lead/member: target group equals the actor's current non-null group.

Before moving date/batch, query for any event by the same actor already at the requested `occurredOn + batchId` outside the original event IDs. If present, return `409 目标日期和来源批次已有记录，请打开已有记录修改`.

- [x] **Step 5: Normalize all eight metrics atomically**

Use this behavior for each Prisma kind. Implement a small helper that receives `valueField: "quantity" | "amountCents"`; construct updates with `{ [valueField]: nextTotal }` so count values never enter `amountCents` and recharge never enters `quantity`:

```ts
const existing = originalEvents.filter((event) => event.kind === kind)
  .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

if (existing[0]) {
  await tx.metricEvent.update({
    where: { id: existing[0].id },
    data: { batchId: input.batchId, occurredOn: input.occurredOn, [valueField]: nextTotal },
  });
  await tx.metricEvent.updateMany({
    where: { id: { in: existing.slice(1).map(({ id }) => id) } },
    data: { batchId: input.batchId, occurredOn: input.occurredOn, [valueField]: 0 },
  });
} else if (nextTotal > 0) {
  await tx.metricEvent.create({ data: { batchId: input.batchId, enteredById: actor.id, occurredOn: input.occurredOn, kind, [valueField]: nextTotal } });
}
```

Implement `quantity` for seven count kinds and `amountCents` for recharge; keep the other column null.

- [x] **Step 6: Record one safe audit entry and return the regrouped result**

Write `HISTORY_GROUP_UPDATED` with entity type `HistoryGroup`, a stable original group key, old/new dates, old/new batch IDs, and only changed metric totals. Do not store raw request bodies. Reload the normalized group, call `groupHistoryEvents`, and return the single group.

- [x] **Step 7: Cover conflict, normalization, audit, and report-facing totals**

Add tests that assert:

- a stale fingerprint returns 409 and writes nothing;
- moving onto an existing group returns 409;
- two old reply events `2 + 3` become `4 + 0`;
- a missing kind with requested total 2 creates one event;
- a requested zero preserves rows but makes their total zero;
- recharge uses cents;
- date/batch moves affect all old rows;
- audit summary contains `5 → 4` but no unrelated secrets;
- a subsequent `calculateBatchTotals` or report query reads the new totals.

Run: `npm test -- --run tests/unit/history-update.test.ts tests/unit/report-query.test.ts`

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add src/app/api/history/route.ts src/lib/audit.ts tests/unit/history-update.test.ts
git commit -m "feat: let users safely edit own history groups"
```

### Task 3: Date-grouped history page and filters

**Files:**
- Modify: `src/app/(app)/history/page.tsx`
- Replace: `src/components/history/EventHistoryTable.tsx`
- Create: `src/components/history/HistoryGroupList.tsx`
- Create: `src/components/history/HistoryGroupRow.tsx`
- Create: `src/components/history/history-display.ts`
- Modify: `tests/unit/history-channel-filter.test.ts`

**Interfaces:**
- Consumes: `groupHistoryEvents`, `HistoryGroup`, `currentUserId`, `currentUserRole`, and visible raw events.
- Produces: grouped date sections, role-aware filters, expandable rows, and `onEdit(group)` callbacks for the drawer task.

- [x] **Step 1: Write failing component behavior tests**

Render seven events from the screenshot for one member/date/batch and assert:

```ts
expect(markup).toContain("共 1 组");
expect(markup).toContain("2026-08-12");
expect(markup).toContain("获粉");
expect(markup).toContain("111");
expect(markup).toContain("回复");
expect(markup).toContain("20");
expect(markup.match(/底料 · 一组/g)).toHaveLength(1);
```

Render as `MEMBER` and assert the member filter is absent; render as `LEAD` and assert it exists. Assert only a group whose `enteredBy.id === currentUserId` has an edit button. Keep the existing same-channel-ID/different-group filter test.

- [x] **Step 2: Run UI unit tests and confirm failure**

Run: `npm test -- --run tests/unit/history-channel-filter.test.ts`

Expected: FAIL because the current component still renders one row per metric.

- [x] **Step 3: Load group-ready server data**

Update `history/page.tsx` to select `batch.id`, group `active`, event `createdAt`, and all fields required by `groupHistoryEvents`. Group on the server before passing serializable data to the client. Load selectable source batches scoped like the entry page: all active batches for admins, current active group batches for leads/members. Pass `currentUser={{ id, role }}` and batches to the client.

- [x] **Step 4: Implement role-aware filters and date sections**

`HistoryGroupList` owns the four filters and drawer selection. Hide the member selector when `currentUserRole === "MEMBER"`. Count filtered groups, group them by `occurredOn`, and render section headings such as `2026-08-12 · 1 组`.

- [x] **Step 5: Implement compact expandable rows**

`HistoryGroupRow` shows source date, `channel · group`, entered-by name, nonzero metric chips in business order, inactive badges, and:

- `编辑` when `group.enteredBy.id === currentUserId`;
- `查看详情` otherwise.

Clicking the row expands all eight totals. Keep buttons at least 36px high, preserve keyboard focus, and do not make the row itself impersonate a button.

- [x] **Step 6: Run focused UI tests and commit**

Run: `npm test -- --run tests/unit/history-groups.test.ts tests/unit/history-channel-filter.test.ts`

Expected: PASS.

```bash
git add src/app/'(app)'/history/page.tsx src/components/history tests/unit/history-channel-filter.test.ts
git commit -m "feat: redesign history as grouped daily records"
```

### Task 4: History edit drawer and browser workflow

**Files:**
- Create: `src/components/history/HistoryEditDrawer.tsx`
- Modify: `src/components/history/HistoryGroupList.tsx`
- Modify: `src/app/globals.css` only for scoped history layout styles not expressible with existing utilities
- Modify: `tests/e2e/history-permissions.spec.ts`

**Interfaces:**
- Consumes: a selected `HistoryGroup`, writable batch options, and `PATCH /api/history`.
- Produces: preserved form state, change preview, save/error feedback, and in-place replacement of the returned group.

- [x] **Step 1: Write a failing end-to-end member edit flow**

Using a unique temp batch, save multiple events for the member, visit `/history`, and assert one grouped row. Open `编辑`, change replies and group join, continue to the confirmation state, and assert `回复：5 → 4`. Confirm and verify:

- success status is visible;
- the grouped row updates without a full navigation;
- `/api/history` returns the changed totals;
- the report/dashboard query reflects the changed totals;
- the administrator audit log contains `HISTORY_GROUP_UPDATED`.

- [x] **Step 2: Add forbidden browser/API cases**

Assert a lead sees a member's group but only `查看详情`; direct lead PATCH of that member's IDs returns 403. Assert an administrator also cannot PATCH another actor's group. Assert a stale second browser submission receives 409 and retains its input values.

- [x] **Step 3: Run the browser spec and confirm failure**

Run: `CI=1 npm run test:e2e -- --reporter=line tests/e2e/history-permissions.spec.ts`

Expected: FAIL because no edit drawer exists.

- [x] **Step 4: Implement the right-side drawer**

The drawer contains:

- editable occurrence date;
- searchable/selectable source batch;
- read-only entered-by name;
- three sections matching the entry flow;
- seven nonnegative integer count inputs;
- recharge amount in yuan, converted to integer cents before submit;
- close button and backdrop behavior;
- sticky footer with `检查修改`.

Maintain a local draft until successful save. Map server field errors to the relevant input and keep the drawer open on every error.

- [x] **Step 5: Implement explicit change confirmation**

Compare the draft with the original group and show only changed fields. Disable confirmation for no changes. `确认保存` sends the original `eventIds` and `fingerprint`; while saving, disable both confirmation and destructive navigation. On success replace that group in client state, close the drawer, and announce `历史数据已更新` with `role=status`.

- [x] **Step 6: Run focused browser and unit verification**

Run:

```bash
npm test -- --run tests/unit/history-groups.test.ts tests/unit/history-update.test.ts tests/unit/history-channel-filter.test.ts
CI=1 npm run test:e2e -- --reporter=line tests/e2e/history-permissions.spec.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/components/history/HistoryEditDrawer.tsx src/components/history/HistoryGroupList.tsx src/app/globals.css tests/e2e/history-permissions.spec.ts
git commit -m "feat: add own-history edit drawer"
```

### Task 5: Full verification, visual review, and handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-08-12-history-grouped-editing.md`
- Save QA evidence under ignored `.superpowers/sdd/2026-08-12-history-grouped-editing/`

**Interfaces:**
- Consumes: the completed grouped history and edit workflow.
- Produces: verified build, browser preview, review evidence, and a clean feature branch.

- [x] **Step 1: Run the complete automated suite**

Run:

```bash
npm run db:generate
npm test -- --run
CI=1 npm run test:e2e -- --reporter=line
npm run build
git diff --check
```

Expected: all commands pass; warnings already present in the repository are recorded but do not count as success failures.

- [x] **Step 2: Perform desktop visual and interaction review**

At the normal desktop viewport, log in as `member`, open `/history`, and capture:

1. grouped history default view;
2. one expanded row;
3. edit drawer;
4. change-confirmation state.

Confirm the screenshot's seven metrics render as one group, the member filter is absent, the drawer is not clipped, metric labels align, inactive badges remain visible, and the list stays readable without horizontal scrolling.

- [x] **Step 3: Perform permission spot checks**

Log in as lead and admin. Confirm they can filter broader records but cannot see `编辑` on another user's records. Send one direct foreign-owner PATCH per role and confirm 403.

- [x] **Step 4: Request independent final review**

Review the full branch diff against `docs/superpowers/specs/2026-08-12-history-grouped-editing-design.md`, focusing on ownership, stale-write prevention, transaction boundaries, report correctness, audit safety, and accessibility. Fix every Critical or Important finding and rerun affected checks.

- [x] **Step 5: Mark the plan complete and commit tracking changes**

Check completed boxes only after the commands actually pass.

```bash
git add docs/superpowers/plans/2026-08-12-history-grouped-editing.md
git commit -m "docs: record grouped history verification"
```
