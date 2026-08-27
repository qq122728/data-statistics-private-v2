# Team and Channel Complete Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show all nine requested business quantities in the team group, team member, and channel analysis tables without removing existing ranking and conversion information.

**Architecture:** Reuse each row's existing `BatchTotals`; no database or query changes are needed. Expand the two table components with grouped two-row headers, then add scoped wide-table CSS so the first identity column stays visible while the metrics scroll horizontally.

**Tech Stack:** Next.js 15, React 19, TypeScript, CSS, Vitest, Playwright

## Global Constraints

- Display: 获粉、回复、入群、退群、当前在群、专家介绍、注册、开单、充值总金额.
- Preserve existing permissions, filters, aggregation rules, D7 sample rules, drawers, conversions, sorting controls, empty states, and zero-denominator messages.
- `当前在群` remains the existing `BatchTotals.inGroup` value (`入群 - 退群`).
- Do not add database fields or change analytics queries.
- Keep all nine quantities in the primary table through horizontal scrolling（横向滚动）.

---

### Task 1: Render the complete metrics in all table modes

**Files:**
- Modify: `tests/unit/management-analysis-details-ui.test.ts`
- Modify: `src/components/analytics/team/TeamPerformanceTable.tsx`
- Modify: `src/components/analytics/channel/ChannelQualityTable.tsx`

**Interfaces:**
- Consumes: `row.totals: BatchTotals` on group, member, and channel rows.
- Produces: grouped headers, nine quantity cells per row, and the CSS hooks `analysis-metrics-table` and `analysis-sticky-column`.

- [ ] **Step 1: Write the failing component test**

Render all three table modes with these hand-checked totals:

```tsx
const totals = {
  newFans: 101, replies: 102, groupJoin: 103, groupLeave: 104,
  inGroup: -1, expertIntro: 105, registration: 106,
  orders: 107, rechargeCents: 108_09,
};
```

For each rendered table, assert the literal labels `获粉`, `回复`, `入群`, `退群`, `当前在群`, `专家介绍`, `注册`, `开单`, and `充值总金额`; assert values `101`, `102`, `103`, `104`, `-1`, `105`, `106`, `107`, and `¥108.09`; assert the table contains `analysis-metrics-table`. The group fixture uses `GroupPerformanceRow`, the member fixture uses `MemberPerformanceRow`, and the channel fixture uses `ChannelQualityRow` with the same `totals` object.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npm test -- --run tests/unit/management-analysis-details-ui.test.ts
```

Expected: FAIL because the current tables omit multiple quantity labels and values.

- [ ] **Step 3: Implement the minimal grouped columns**

Use this exact column order in both components:

```tsx
const quantityColumns = [
  ["newFans", "获粉"], ["replies", "回复"], ["groupJoin", "入群"],
  ["groupLeave", "退群"], ["inGroup", "当前在群"],
  ["expertIntro", "专家介绍"], ["registration", "注册"],
  ["orders", "开单"], ["rechargeCents", "充值总金额"],
] as const;
```

Render two header rows. Identity and D7 sample columns use `rowSpan={2}`; “数量指标” uses `colSpan={9}`; existing conversion or efficiency columns form the final group. Render the nine cells from `row.totals` in matching order, formatting only `rechargeCents` as currency. Preserve existing sort buttons for every previously sortable value.

- [ ] **Step 4: Run the focused test and verify GREEN**

```bash
npm test -- --run tests/unit/management-analysis-details-ui.test.ts
```

Expected: PASS, including the pre-existing empty-state, sorting, and sample-state cases.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/management-analysis-details-ui.test.ts src/components/analytics/team/TeamPerformanceTable.tsx src/components/analytics/channel/ChannelQualityTable.tsx
git commit -m "feat: show complete team and channel metrics"
```

---

### Task 2: Keep the expanded tables readable and verify the layout

**Files:**
- Modify: `src/app/globals.css`
- Modify: `tests/e2e/management-analysis.spec.ts`

**Interfaces:**
- Consumes: the CSS hooks produced by Task 1.
- Produces: a wide scrolling table with a sticky first identity column.

- [ ] **Step 1: Write the failing browser test**

Log in as `admin`, visit filtered `/team-performance` and `/channel-analysis`, locate `table.analysis-metrics-table`, and assert:

```ts
await expect(table.getByRole("columnheader", { name: "数量指标" })).toBeVisible();
await expect(table.getByRole("columnheader", { name: "当前在群" })).toBeVisible();
const layout = await table.evaluate((element) => {
  const wrapper = element.parentElement;
  const firstHeader = element.querySelector("th");
  return {
    scrolls: Boolean(wrapper && element.scrollWidth > wrapper.clientWidth),
    position: firstHeader ? getComputedStyle(firstHeader).position : "",
    left: firstHeader ? getComputedStyle(firstHeader).left : "",
  };
});
expect(layout).toEqual({ scrolls: true, position: "sticky", left: "0px" });
```

- [ ] **Step 2: Run the browser test and verify RED**

```bash
CI=1 npm run test:e2e -- --reporter=line tests/e2e/management-analysis.spec.ts -g "complete analysis tables"
```

Expected: FAIL because the hooks do not yet have wide-table and sticky-column styles.

- [ ] **Step 3: Add scoped styles**

```css
.analysis-grid .analysis-metrics-table { min-width: 1560px; table-layout: auto; }
.analysis-metrics-table th, .analysis-metrics-table td { overflow-wrap: normal; white-space: nowrap; }
.analysis-metrics-table .analysis-column-group { height: 34px; text-align: center; }
.analysis-metrics-table .analysis-sticky-column { position: sticky; z-index: 2; left: 0; min-width: 150px; background: #fff; }
.analysis-metrics-table thead .analysis-sticky-column { z-index: 3; background: #f8f9fb; }
.analysis-metrics-table tbody tr:hover .analysis-sticky-column { background: #fafcff; }
```

- [ ] **Step 4: Run focused verification**

```bash
npm test -- --run tests/unit/management-analysis-details-ui.test.ts
CI=1 npm run test:e2e -- --reporter=line tests/e2e/management-analysis.spec.ts -g "complete analysis tables"
```

Expected: both commands PASS.

- [ ] **Step 5: Verify build without corrupting the live dev cache**

Stop the server on port `56790`, run `npm run build` and `git diff --check`, then restart `next dev` on `127.0.0.1:56790`. Confirm the production build exits 0 before restarting the live server.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css tests/e2e/management-analysis.spec.ts
git commit -m "fix: keep complete analysis tables readable"
```
