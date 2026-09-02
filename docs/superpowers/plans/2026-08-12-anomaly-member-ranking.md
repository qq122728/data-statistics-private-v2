# Data Anomaly Member Ranking Implementation Plan

> **历史归档，停止执行。** 本文只用于追溯当时的设计或实施过程；涉及资源部确认、手填进群/注册/开单、岗位权限、统计日期或旧前端的内容均不是现行规则。当前口径请看 [当前业务规则](/Users/aaaa/Desktop/数据统计/docs/business/current-business-rules.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a secure “异常榜单” page that compares each member with the weighted average of other rankable members using the same channel.

**Architecture:** Add one focused analytics query that reuses existing scope, maturity, channel normalization, and conversion helpers. Render the query through a server page plus small presentational components, and extend the existing shared filter/navigation contracts instead of creating parallel infrastructure.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Prisma/SQLite, Vitest, Playwright, Tailwind CSS, Phosphor Icons.

## Global Constraints

- Use only D7-mature source batches and metric events inside the D0–D7 window.
- A member-channel sample is rankable only when `NEW_FANS >= 20`.
- Reply rate is `REPLIES / NEW_FANS`; group rate is `GROUP_JOIN / NEW_FANS`; expert rate is `EXPERT_INTRO / GROUP_JOIN`; registration rate is `REGISTRATION / EXPERT_INTRO`; order rate is `ORDER / NEW_FANS`.
- Channel benchmarks are weighted ratios: sum numerators divided by sum denominators across rankable visible member-channel rows.
- A metric is anomalous only when the member value is strictly below the benchmark; gaps are percentage points.
- ADMIN can read all readable groups and filter one group; LEAD is forced to their own group; MEMBER has no access.
- Build the selected visual direction from `exec-0e2f8eac-898e-4082-beb6-0f67956b316c.png` using the existing design system.
- Do not add or migrate database tables.

---

### Task 1: Ranking query and calculation contract

**Files:**
- Create: `src/lib/analytics/anomaly-ranking.ts`
- Create: `tests/unit/anomaly-ranking-query.test.ts`

**Interfaces:**
- Consumes: `AnalysisScope`, `getMaturity()`, `getSampleState()`, `isWithinMaturityWindow()`, `calculateBatchTotals()`, `normalizeChannelName()`.
- Produces: `loadAnomalyRanking(scope: AnalysisScope, today: string, options?: { showInsufficient?: boolean }): Promise<AnomalyRankingResult>`.
- Produces: `AnomalyRankingRow`, `AnomalyMetricComparison`, `AnomalyRankingSummary`, and `AnomalyMetricKey` exported types.

- [ ] **Step 1: Write isolated database tests for weighted benchmarks and five formulas**

Create two active members in one group/channel with unequal sample sizes, mature source batches, and all five funnel metrics. Assert the channel benchmark equals aggregate numerator divided by aggregate denominator, not the arithmetic mean of member percentages.

```ts
const result = await loadAnomalyRanking(adminScope(), "2026-08-12");
const weak = result.rows.find((row) => row.memberId === ids.weak)!;
expect(weak.metrics.replyRate).toMatchObject({ value: 0.2, average: 0.6, gap: -0.4, status: "LOW" });
expect(weak.anomalyCount).toBeGreaterThan(0);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run tests/unit/anomaly-ranking-query.test.ts`
Expected: FAIL because `src/lib/analytics/anomaly-ranking.ts` does not exist.

- [ ] **Step 3: Add edge-case tests**

Cover D7 exclusion, D0–D7 event window, sample `< 20`, zero denominator as `UNAVAILABLE`, single eligible member not anomalous, inactive member inclusion, normalized channel merge, ADMIN group filtering, and LEAD group isolation.

- [ ] **Step 4: Implement the minimal query**

Use these public shapes:

```ts
export type AnomalyMetricKey = "replyRate" | "groupRate" | "expertRate" | "registrationRate" | "orderRate";
export type AnomalyMetricComparison = {
  value: number | null;
  average: number | null;
  gap: number | null;
  status: "LOW" | "OK" | "UNAVAILABLE" | "INSUFFICIENT";
};
export type AnomalyRankingRow = {
  key: string;
  memberId: string;
  memberName: string;
  memberActive: boolean;
  role: "LEAD" | "MEMBER";
  groupId: string;
  groupName: string;
  normalizedName: string;
  channelName: string;
  newFans: number;
  rankable: boolean;
  metrics: Record<AnomalyMetricKey, AnomalyMetricComparison>;
  anomalyCount: number;
  largestGap: number | null;
};
```

Return only anomalous rankable rows by default. When `showInsufficient` is true, append insufficient rows after ranked anomalies. Also return `summary`, `channelOptions`, `hasMatureData`, `hasComparableData`, and `totalComparedRows`.

- [ ] **Step 5: Run GREEN and commit**

Run: `npm test -- --run tests/unit/anomaly-ranking-query.test.ts`
Expected: PASS.

```bash
git add src/lib/analytics/anomaly-ranking.ts tests/unit/anomaly-ranking-query.test.ts
git commit -m "feat: calculate channel anomaly rankings"
```

### Task 2: Shared filters, navigation, and role visibility

**Files:**
- Modify: `src/lib/analytics/types.ts`
- Modify: `src/lib/analytics/scope.ts`
- Modify: `src/components/analytics/AnalysisFilters.tsx`
- Modify: `src/lib/app-navigation.ts`
- Modify: `src/components/shell/AppSidebar.tsx`
- Modify: `src/components/shell/AppHeader.tsx`
- Modify: `tests/unit/analytics-scope.test.ts`
- Modify: `tests/unit/navigation.test.ts`
- Modify: `tests/unit/management-analysis-ui.test.ts`

**Interfaces:**
- Adds `showInsufficient: boolean` to `AnalysisFilters` and carries it through parsing, scope resolution, and link construction.
- Adds `href: "/anomaly-ranking"`, label `"异常榜单"`, and a Phosphor warning/ranking icon for ADMIN and LEAD navigation only.

- [ ] **Step 1: Write failing filter and navigation tests**

```ts
expect(parseAnalysisFilters(new URLSearchParams("showInsufficient=1")).showInsufficient).toBe(true);
expect(buildAnalysisHref("/anomaly-ranking", filters)).toContain("showInsufficient=1");
expect(getVisibleAppNavigation("LEAD")).toContainEqual({ href: "/anomaly-ranking", label: "异常榜单" });
expect(getVisibleAppNavigation("MEMBER").some((item) => item.href === "/anomaly-ranking")).toBe(false);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- --run tests/unit/analytics-scope.test.ts tests/unit/navigation.test.ts tests/unit/management-analysis-ui.test.ts`
Expected: FAIL on the new filter and navigation assertions.

- [ ] **Step 3: Implement shared contract changes**

Parse only the exact value `1` as true, append it in `buildAnalysisHref`, render a “显示样本不足” checkbox in the anomaly page’s more-filters area, and add the new title/icon/navigation item without changing MEMBER navigation.

- [ ] **Step 4: Run GREEN and commit**

Run: `npm test -- --run tests/unit/analytics-scope.test.ts tests/unit/navigation.test.ts tests/unit/management-analysis-ui.test.ts`
Expected: PASS.

```bash
git add src/lib/analytics/types.ts src/lib/analytics/scope.ts src/components/analytics/AnalysisFilters.tsx src/lib/app-navigation.ts src/components/shell/AppSidebar.tsx src/components/shell/AppHeader.tsx tests/unit/analytics-scope.test.ts tests/unit/navigation.test.ts tests/unit/management-analysis-ui.test.ts
git commit -m "feat: expose anomaly ranking navigation"
```

### Task 3: Selected ranking UI and page

**Files:**
- Create: `src/components/analytics/anomaly/AnomalySummary.tsx`
- Create: `src/components/analytics/anomaly/AnomalyRankingTable.tsx`
- Create: `src/app/(app)/anomaly-ranking/page.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/unit/anomaly-ranking-ui.test.ts`

**Interfaces:**
- `AnomalySummary({ summary }: { summary: AnomalyRankingSummary })` renders the three compact summary values.
- `AnomalyRankingTable({ rows, filters, showGroup }: { rows: AnomalyRankingRow[]; filters: Partial<AnalysisFilters>; showGroup: boolean })` renders the selected comparison table and batch-tracking links.
- Server page resolves the existing secure scope, calls `loadAnomalyRanking`, and chooses the correct empty-state copy.

- [ ] **Step 1: Write failing static-render UI tests**

Assert the selected table headings, personal/average/gap copy, red LOW state, green OK state, insufficient badge, summary values, ADMIN group text, LEAD group hiding, and query-preserving `/batch-tracking` link.

- [ ] **Step 2: Run focused UI tests and verify RED**

Run: `npm test -- --run tests/unit/anomaly-ranking-ui.test.ts`
Expected: FAIL because the new components do not exist.

- [ ] **Step 3: Implement components and page**

Use a minimum table width near 1180px so each comparison remains readable; allow horizontal scrolling below that width. Each metric cell must render the member percent as the primary value, `渠道平均 xx.x%` beneath it, and `低 xx.x 个百分点` only for `LOW`. Render no fake charts or decorative assets.

- [ ] **Step 4: Add explicit empty states**

Use `hasMatureData`, `hasComparableData`, and `rows.length` to distinguish “尚未达到 D7”, “缺少达到 20 粉的可比较对象”, and “当前没有低于渠道平均值的人员”.

- [ ] **Step 5: Run GREEN and commit**

Run: `npm test -- --run tests/unit/anomaly-ranking-ui.test.ts tests/unit/anomaly-ranking-query.test.ts`
Expected: PASS.

```bash
git add src/components/analytics/anomaly src/app/'(app)'/anomaly-ranking src/app/globals.css tests/unit/anomaly-ranking-ui.test.ts
git commit -m "feat: build anomaly ranking page"
```

### Task 4: Browser workflow and visual gate

**Files:**
- Modify: `tests/e2e/management-analysis.spec.ts`
- Create: `design-qa.md`
- Create: `design-qa-assets/anomaly-ranking-design-2026-08-12/01-implemented.png`
- Create: `design-qa-assets/anomaly-ranking-design-2026-08-12/02-comparison.png`

**Interfaces:**
- Browser flow covers ADMIN navigation/filter/downstream link, LEAD fixed scope, and MEMBER denial.
- `design-qa.md` must end with `final result: passed` before handoff.

- [ ] **Step 1: Add failing browser assertions**

Extend the management analysis E2E flow to open `/anomaly-ranking`, verify the new heading and table/empty-state region, check MEMBER redirects, and ensure an out-of-scope `groupId` cannot expose another group.

- [ ] **Step 2: Run focused browser test and correct only genuine failures**

Run: `CI=1 npm run test:e2e -- --reporter=line tests/e2e/management-analysis.spec.ts`
Expected: PASS after Tasks 1–3; if a behavior is missing, add a failing unit assertion before changing production code.

- [ ] **Step 3: Run regression and build verification**

Run: `npm test -- --run`
Run: `npm run build`
Run: `git diff --check`
Expected: all commands succeed.

- [ ] **Step 4: Compare the browser capture with the selected reference**

At the same desktop viewport, capture the implemented page, place it beside the selected reference, inspect spacing, typography, border radii, table density, low/healthy states, overflow, and filter wrapping, then fix all P0/P1/P2 visual mismatches.

- [ ] **Step 5: Write the design QA report and commit**

The report records the reference and implementation captures, interaction checks, remaining P3 notes, and the exact line `final result: passed`.

```bash
git add tests/e2e/management-analysis.spec.ts design-qa.md design-qa-assets/anomaly-ranking-design-2026-08-12/01-implemented.png design-qa-assets/anomaly-ranking-design-2026-08-12/02-comparison.png
git commit -m "test: verify anomaly ranking experience"
```
