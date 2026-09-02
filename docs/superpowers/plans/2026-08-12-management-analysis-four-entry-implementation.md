# 管理分析四入口 Implementation Plan

> **历史归档，停止执行。** 本文只用于追溯当时的设计或实施过程；涉及资源部确认、手填进群/注册/开单、岗位权限、统计日期或旧前端的内容均不是现行规则。当前口径请看 [当前业务规则](/Users/aaaa/Desktop/数据统计/docs/business/current-business-rules.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把管理员和组长现有的密集报表拆成“管理概览、团队表现、渠道分析、批次追踪”四个独立入口，同时保留普通成员的个人工作台和个人报表。

**Architecture:** 继续使用 Next.js 15 Server Components、Prisma 和现有报表口径，不复制第二套事件数据。新增 `analytics` 查询层，统一完成角色范围、日期成熟度、样本量和漏斗规则；页面层只负责筛选、表格、抽屉和下钻。分析批次的最小归属单位固定为 `SourceBatch + enteredById`，确保同一日期、同一渠道但不同录入人的业绩不会混在一起。

**Tech Stack:** Next.js 15.5、React 19、TypeScript 5.9、Prisma 6 + SQLite、Tailwind CSS 4、Recharts 3、Vitest 3、Playwright 1.55、Phosphor Icons。

## Global Constraints

- 谁录入数据，业绩就归谁；组长只录入自己的业务数据，不代替组员录入。
- “业务人员”只包含 `LEAD` 和 `MEMBER`；`ADMIN` 不进入人员业绩排名。
- 管理员可查看全部小组；组长查询和下钻必须固定为自己的 `groupId`；普通成员不能进入新增的三个分析页及对应接口。
- 管理员和组长访问 `/dashboard` 时显示“管理概览”；普通成员继续显示现有个人工作台。
- 普通成员继续拥有 `/reports` 个人转化报表；管理员和组长的旧 `/reports` 入口迁移到四入口体系。
- 所有转化率显示获粉样本量；`newFans < 20` 显示“样本不足”且不进入正式排名。
- 分母为 0 显示“暂无数据”；未达到 D7/D14 显示“尚未达到 D7/D14”。
- 增量模式中的 `inGroup` 文案统一为“本期净增在群”。
- 人员和渠道详情使用右侧抽屉；批次详情使用二级页面。
- 主表在 1280px 桌面宽度无横向滚动，常用筛选只保留 2–3 个。
- 沿用现有颜色、圆角、间距、`panel`、`toolbar`、`data-table` 和 `Drawer`，不创建第二套视觉系统。

---

## 文件结构

### 新建

- `src/lib/analytics/types.ts`：四入口共用的筛选、成熟度、漏斗、状态和返回值类型。
- `src/lib/analytics/scope.ts`：角色权限、默认日期、URL 筛选解析和跨页查询参数。
- `src/lib/analytics/metrics.ts`：聚合、成熟度、最大掉点、当前阶段、样本量和停滞规则。
- `src/lib/analytics/overview.ts`：管理概览查询。
- `src/lib/analytics/team-performance.ts`：小组和业务人员表现查询。
- `src/lib/analytics/channel-analysis.ts`：跨小组归一化渠道质量查询。
- `src/lib/analytics/batch-tracking.ts`：`SourceBatch + enteredById` 批次查询和详情查询。
- `src/app/(app)/team-performance/page.tsx`：团队表现入口。
- `src/app/(app)/channel-analysis/page.tsx`：渠道分析入口。
- `src/app/(app)/batch-tracking/page.tsx`：批次追踪入口。
- `src/app/(app)/batch-tracking/[batchId]/page.tsx`：批次二级详情页。
- `src/app/api/daily-confirmations/route.ts`：本人确认今日数据和管理者读取确认状态。
- `src/components/analytics/AnalysisFilters.tsx`：四入口共用的轻量筛选栏。
- `src/components/analytics/AnalysisState.tsx`：加载失败、空数据、样本不足和未成熟状态。
- `src/components/analytics/FunnelSummary.tsx`：对象详情共用漏斗和最大掉点。
- `src/components/analytics/TodayConfirmation.tsx`：本人“今日数据已填写完成”控件。
- `src/components/analytics/overview/OverviewAlerts.tsx`：待处理提醒及跳转。
- `src/components/analytics/overview/OverviewSummary.tsx`：四个结果卡和七日趋势。
- `src/components/analytics/team/TeamPerformanceTable.tsx`：小组/人员主表与排序。
- `src/components/analytics/team/MemberPerformanceDrawer.tsx`：人员详情抽屉。
- `src/components/analytics/channel/ChannelQualityTable.tsx`：渠道质量主表。
- `src/components/analytics/channel/ChannelDetailDrawer.tsx`：渠道详情抽屉。
- `src/components/analytics/batch/BatchTrackingTable.tsx`：批次优先级主表。
- `src/components/analytics/batch/BatchDetail.tsx`：批次二级详情内容。
- `prisma/migrations/20260812190000_add_daily_entry_confirmation/migration.sql`：每日确认表。
- `tests/unit/analytics-scope.test.ts`：权限和筛选范围。
- `tests/unit/analytics-metrics.test.ts`：成熟度、样本量、掉点和停滞规则。
- `tests/unit/daily-confirmation.test.ts`：确认接口安全和幂等。
- `tests/unit/overview-query.test.ts`：管理概览提醒与范围。
- `tests/unit/team-performance-query.test.ts`：小组/人员归属和排序。
- `tests/unit/channel-analysis-query.test.ts`：归一化渠道和样本门槛。
- `tests/unit/batch-tracking-query.test.ts`：人员批次拆分、年龄和状态。
- `tests/e2e/management-analysis.spec.ts`：四入口最小核心流程。

### 修改

- `prisma/schema.prisma`：加入 `DailyEntryConfirmation` 及 `User.confirmations`。
- `src/lib/app-navigation.ts`：从平铺导航改为分组导航，并按角色显示入口。
- `src/components/shell/AppSidebar.tsx`：渲染“日常工作 / 数据分析 / 人员管理”分组。
- `src/components/shell/AppHeader.tsx`：加入新路由中文标题。
- `src/app/(app)/dashboard/page.tsx`：按角色渲染管理概览或原个人工作台。
- `src/app/(app)/reports/page.tsx`：普通成员保留；管理员和组长跳到 `/team-performance`。
- `src/components/reports/MetricCards.tsx`、`src/components/reports/BatchReportTable.tsx`：增量模式文案改为“本期净增在群”。
- `src/app/globals.css`：只增加四入口共用的紧凑布局、状态和详情样式。
- `tests/unit/navigation.test.ts`：锁定三种角色的分组导航。
- `tests/e2e/dashboard.spec.ts`、`tests/e2e/reports.spec.ts`：保留普通成员旧流程并调整管理角色预期。

---

### Task 1: 共用分析类型、权限范围与分组导航

**Files:**
- Create: `src/lib/analytics/types.ts`
- Create: `src/lib/analytics/scope.ts`
- Create: `tests/unit/analytics-scope.test.ts`
- Modify: `src/lib/app-navigation.ts`
- Modify: `src/components/shell/AppSidebar.tsx`
- Modify: `src/components/shell/AppHeader.tsx`
- Modify: `tests/unit/navigation.test.ts`

**Interfaces:**
- Produces: `ManagementRole`, `AnalysisFilters`, `AnalysisScope`, `parseAnalysisFilters()`, `resolveAnalysisScope()`, `buildAnalysisHref()`。
- Produces: `getVisibleAppNavigationSections(role)`，供侧边栏渲染。
- Consumes: 现有 `PermissionUser`、`resolveReadableReportGroups()` 和 `normalizeChannelName()`。

- [ ] **Step 1: 写失败的权限和导航测试**

```ts
expect(resolveAnalysisScope(
  { id: "lead-a", role: "LEAD", groupId: "group-a", active: true },
  { groupId: "group-b", sourceDateFrom: "2026-07-01", sourceDateTo: "2026-08-12" },
  "2026-08-12",
  ["group-a", "group-b"],
)).toMatchObject({ groupIds: ["group-a"], requestedForbiddenGroup: true });

expect(() => resolveAnalysisScope(
  { id: "member-a", role: "MEMBER", groupId: "group-a", active: true },
  {},
  "2026-08-12",
  ["group-a"],
)).toThrow("管理分析仅限管理员和组长");

expect(getVisibleAppNavigationSections("LEAD").map((section) => ({
  label: section.label,
  items: section.items.map((item) => item.label),
}))).toEqual([
  { label: "日常工作", items: ["管理概览", "数据录入", "历史记录"] },
  { label: "数据分析", items: ["团队表现", "渠道分析", "批次追踪"] },
  { label: "人员管理", items: ["组员管理"] },
]);
```

- [ ] **Step 2: 运行测试，确认新接口尚不存在**

Run: `npm test -- --run tests/unit/analytics-scope.test.ts tests/unit/navigation.test.ts`

Expected: FAIL，提示无法导入 `src/lib/analytics/scope.ts` 或 `getVisibleAppNavigationSections` 未导出。

- [ ] **Step 3: 定义共用类型和严格的权限范围**

```ts
export type ManagementRole = "ADMIN" | "LEAD";
export type AnalysisFilters = {
  groupId?: string;
  memberId?: string;
  normalizedName?: string;
  sourceDateFrom: string;
  sourceDateTo: string;
  includeInactive: boolean;
};
export type AnalysisScope = AnalysisFilters & {
  actorId: string;
  role: ManagementRole;
  groupIds: string[];
  requestedForbiddenGroup: boolean;
};

export function resolveAnalysisScope(
  user: PermissionUser,
  filters: Partial<AnalysisFilters>,
  today: string,
  readableGroupIds: string[],
): AnalysisScope {
  if (!user.active || user.role === "MEMBER") throw new AnalysisAccessError();
  const groupIds = user.role === "LEAD"
    ? (user.groupId ? [user.groupId] : [])
    : filters.groupId && readableGroupIds.includes(filters.groupId)
      ? [filters.groupId]
      : readableGroupIds;
  return {
    actorId: user.id,
    role: user.role,
    groupIds,
    requestedForbiddenGroup: Boolean(filters.groupId && !groupIds.includes(filters.groupId)),
    groupId: user.role === "LEAD" ? user.groupId ?? undefined : filters.groupId,
    memberId: filters.memberId,
    normalizedName: filters.normalizedName ? normalizeChannelName(filters.normalizedName) : undefined,
    sourceDateFrom: filters.sourceDateFrom ?? addDays(today, -29),
    sourceDateTo: filters.sourceDateTo ?? today,
    includeInactive: filters.includeInactive === true,
  };
}
```

`buildAnalysisHref()` 必须只复制 `groupId`、`memberId`、`normalizedName`、`sourceDateFrom`、`sourceDateTo` 和 `includeInactive=1`，并通过 `URLSearchParams` 编码，不拼接未经编码的字符串。

- [ ] **Step 4: 实现分组导航**

```ts
export type AppNavigationSection = {
  label: "日常工作" | "数据分析" | "人员管理";
  items: VisibleAppNavigationItem[];
};

const analysisItems = [
  { href: "/team-performance", label: "团队表现" },
  { href: "/channel-analysis", label: "渠道分析" },
  { href: "/batch-tracking", label: "批次追踪" },
] as const;
```

管理员和组长的“日常工作”第一项显示 `/dashboard · 管理概览`；普通成员显示 `/dashboard · 工作台`，且“数据分析”中只保留 `/reports · 转化报表`。`AppSidebar` 在每组链接前渲染 `<p className="app-nav-section-label">`，图标继续使用 Phosphor Icons。

- [ ] **Step 5: 运行测试和类型检查**

Run: `npm test -- --run tests/unit/analytics-scope.test.ts tests/unit/navigation.test.ts`

Expected: PASS。

Run: `npx tsc --noEmit`

Expected: PASS。

- [ ] **Step 6: 提交基础能力**

```bash
git add src/lib/analytics/types.ts src/lib/analytics/scope.ts src/lib/app-navigation.ts src/components/shell/AppSidebar.tsx src/components/shell/AppHeader.tsx tests/unit/analytics-scope.test.ts tests/unit/navigation.test.ts
git commit -m "feat: add management analysis navigation"
```

---

### Task 2: 分析指标、成熟度与规则状态

**Files:**
- Create: `src/lib/analytics/metrics.ts`
- Create: `tests/unit/analytics-metrics.test.ts`
- Modify: `src/lib/metrics.ts`
- Modify: `src/components/reports/MetricCards.tsx`
- Modify: `src/components/reports/BatchReportTable.tsx`

**Interfaces:**
- Consumes: `BatchTotals`、`ConversionRates`、`calculateConversionRates()`。
- Produces: `aggregateEventsByOwner()`、`getMaturity()`、`getLargestDrop()`、`getDeepestStage()`、`getBatchStatus()`、`getSampleState()`。

- [ ] **Step 1: 写失败的规则单元测试**

```ts
expect(getSampleState(19)).toBe("INSUFFICIENT");
expect(getSampleState(20)).toBe("RANKABLE");
expect(getMaturity("2026-08-01", "2026-08-08")).toEqual({ d7: true, d14: false, ageDays: 7 });
expect(getLargestDrop({
  newFans: 100, replies: 60, groupJoin: 40, groupLeave: 5,
  inGroup: 35, expertIntro: 10, registration: 8, orders: 2, rechargeCents: 50000,
})).toMatchObject({ from: "GROUP_JOIN", to: "EXPERT_INTRO", lost: 30 });
expect(getBatchStatus({
  totals: totals({ newFans: 20, groupJoin: 8 }),
  sourceDate: "2026-08-01",
  today: "2026-08-08",
  lastProgressedOn: "2026-08-04",
})).toBe("STALLED");
```

- [ ] **Step 2: 运行测试，确认规则函数尚不存在**

Run: `npm test -- --run tests/unit/analytics-metrics.test.ts`

Expected: FAIL，提示导出不存在。

- [ ] **Step 3: 实现固定漏斗顺序和成熟度**

```ts
export const funnelStages = [
  "NEW_FANS", "REPLIES", "GROUP_JOIN", "EXPERT_INTRO", "REGISTRATION", "ORDER",
] as const;

export function getMaturity(sourceDate: string, today: string) {
  const ageDays = Math.max(0, differenceInCalendarDays(today, sourceDate));
  return { ageDays, d7: ageDays >= 7, d14: ageDays >= 14 };
}

export function getSampleState(newFans: number) {
  return newFans >= 20 ? "RANKABLE" as const : "INSUFFICIENT" as const;
}
```

`getBatchStatus()` 的优先级固定为 `DATA_ANOMALY → ORDERED → INSUFFICIENT → STALLED → NORMAL`。`STALLED` 必须同时满足：获粉不少于 20、D4+、开单为 0、当前最深阶段最后一次新增日期距今天至少 3 个自然日。

- [ ] **Step 4: 实现异常与掉点，不改原有公式**

```ts
export function hasFunnelAnomaly(t: BatchTotals) {
  return t.groupJoin > t.newFans
    || t.expertIntro > t.groupJoin
    || t.registration > t.expertIntro
    || t.orders > t.newFans
    || t.groupLeave > t.groupJoin;
}
```

最大掉点只比较 `获粉→回复→入群→专家介绍→注册→开单` 相邻阶段的数量差；充值是金额，不进入人数掉点比较。保留 `calculateConversionRates()` 中现有五个公式。

- [ ] **Step 5: 修正文案并运行回归测试**

增量模式中把 `群内` 改为 `本期净增在群`；累计模式继续显示 `在群`。运行：

Run: `npm test -- --run tests/unit/analytics-metrics.test.ts tests/unit/metrics.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交指标规则**

```bash
git add src/lib/analytics/metrics.ts src/lib/metrics.ts src/components/reports/MetricCards.tsx src/components/reports/BatchReportTable.tsx tests/unit/analytics-metrics.test.ts
git commit -m "feat: add management analysis rules"
```

---

### Task 3: 今日数据确认

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260812190000_add_daily_entry_confirmation/migration.sql`
- Create: `src/app/api/daily-confirmations/route.ts`
- Create: `src/components/analytics/TodayConfirmation.tsx`
- Create: `tests/unit/daily-confirmation.test.ts`

**Interfaces:**
- Produces Prisma model: `DailyEntryConfirmation`。
- Produces API: `GET /api/daily-confirmations?businessDate=YYYY-MM-DD&groupId=...`、`POST /api/daily-confirmations`。
- Produces UI: `<TodayConfirmation businessDate initialConfirmedAt />`。

- [ ] **Step 1: 写失败的确认接口测试**

```ts
const first = await POST(confirmRequest({ businessDate: "2026-08-12" }, leadCookie));
const second = await POST(confirmRequest({ businessDate: "2026-08-12" }, leadCookie));
expect(first.status).toBe(200);
expect(await second.json()).toMatchObject({ alreadyConfirmed: true });

const rows = await GET(statusRequest("2026-08-12", "group-b", leadCookie));
expect(rows.status).toBe(403);

const adminRows = await GET(statusRequest("2026-08-12", "group-a", adminCookie));
expect(await adminRows.json()).toMatchObject({
  members: expect.arrayContaining([{ userId: "lead-a", confirmed: true }]),
});
```

- [ ] **Step 2: 运行测试，确认接口不存在**

Run: `npm test -- --run tests/unit/daily-confirmation.test.ts`

Expected: FAIL，提示无法导入确认路由。

- [ ] **Step 3: 增加模型和迁移**

```prisma
model DailyEntryConfirmation {
  id           String   @id @default(cuid())
  userId       String
  businessDate String
  confirmedAt  DateTime @default(now())
  updatedAt    DateTime @updatedAt
  user         User     @relation(fields: [userId], references: [id])

  @@unique([userId, businessDate])
  @@index([businessDate])
}
```

迁移创建相同字段、唯一索引和日期索引，并给 `User` 增加 `confirmations DailyEntryConfirmation[]`。

- [ ] **Step 4: 实现幂等 POST 和受限 GET**

POST 只接受当前登录人的确认，使用 `upsert({ where: { userId_businessDate: { userId, businessDate } } })`；`ADMIN` 不提交业务确认，返回 403。GET 只允许管理员或组长；组长忽略外部 `groupId` 并固定本组，伪造其他组返回 403。返回业务人员包含 `LEAD` 与 `MEMBER`，停用人员只有在 `includeInactive=1` 时返回。

- [ ] **Step 5: 实现本人确认控件**

```tsx
<button type="button" disabled={busy || confirmed} onClick={confirmToday}>
  {confirmed ? `已确认 ${confirmedTime}` : "确认今日数据已填写完成"}
</button>
```

组件成功后显示确认时间；失败保留按钮并显示 `role="alert"`；重复点击显示已有确认结果。管理员不渲染此按钮。

- [ ] **Step 6: 生成客户端并运行测试**

Run: `npm run db:generate`

Expected: PASS。

Run: `npm test -- --run tests/unit/daily-confirmation.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交确认能力**

```bash
git add prisma/schema.prisma prisma/migrations/20260812190000_add_daily_entry_confirmation/migration.sql src/app/api/daily-confirmations/route.ts src/components/analytics/TodayConfirmation.tsx tests/unit/daily-confirmation.test.ts
git commit -m "feat: add daily data confirmation"
```

---

### Task 4: 管理概览

**Files:**
- Create: `src/lib/analytics/overview.ts`
- Create: `src/components/analytics/AnalysisFilters.tsx`
- Create: `src/components/analytics/AnalysisState.tsx`
- Create: `src/components/analytics/overview/OverviewAlerts.tsx`
- Create: `src/components/analytics/overview/OverviewSummary.tsx`
- Create: `tests/unit/overview-query.test.ts`
- Modify: `src/app/(app)/dashboard/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `AnalysisScope`、Task 2 规则、Task 3 确认状态。
- Produces: `loadManagementOverview(scope, today): Promise<ManagementOverview>`。
- Produces: `AnalysisFilters` 组件，接收 `action`、可见筛选项、选项和当前值。

- [ ] **Step 1: 写失败的概览查询测试**

```ts
const result = await loadManagementOverview(leadScope("group-a"), "2026-08-12");
expect(result.summary).toMatchObject({ newFans: 40, orders: 2, rechargeCents: 80000 });
expect(result.alerts.unconfirmed.map((item) => item.userId)).toContain("member-a");
expect(result.alerts.unconfirmed.map((item) => item.userId)).not.toContain("other-group-member");
expect(result.alerts.noRecords3Days).toContainEqual(expect.objectContaining({ userId: "member-b" }));
expect(result.alerts.replyWithoutFans).toContainEqual(expect.objectContaining({ batchId: expect.any(String) }));
expect(result.alerts.funnelAnomalies).toContainEqual(expect.objectContaining({ reason: "注册大于专家介绍" }));
```

- [ ] **Step 2: 运行测试，确认查询尚不存在**

Run: `npm test -- --run tests/unit/overview-query.test.ts`

Expected: FAIL，提示 `loadManagementOverview` 未定义。

- [ ] **Step 3: 实现概览返回结构和查询**

```ts
export type ManagementOverview = {
  summary: Pick<BatchTotals, "newFans" | "orders" | "rechargeCents"> & { orderRate: number | null };
  trend: Array<{ occurredOn: string; orders: number; rechargeCents: number }>;
  largestDrop: FunnelDrop | null;
  alerts: {
    unconfirmed: PersonAlert[];
    noRecords3Days: PersonAlert[];
    replyWithoutFans: BatchAlert[];
    funnelAnomalies: BatchAlert[];
    excessiveLeaves: BatchAlert[];
  };
};
```

业务结果使用最近 7 个自然日发生数据；“今日待处理”使用今天。未确认人员必须包含当天全 0 但未确认的人；连续无记录严格按最近 3 个自然日没有任何 `MetricEvent` 判断。

- [ ] **Step 4: 按角色拆分 `/dashboard`**

把现有个人工作台 JSX 提取为 `renderMemberDashboard()` 或独立私有组件，`MEMBER` 继续走原查询；`ADMIN/LEAD` 调用 `loadManagementOverview()`。管理概览页面顺序固定为：轻量筛选、待处理摘要、获粉/开单/充值/开单率、7 日趋势、最大掉点、异常快捷入口。组长页面同时显示 Task 3 的本人确认按钮。

- [ ] **Step 5: 实现提醒跳转**

```ts
buildAnalysisHref("/team-performance", filters, { memberId: alert.userId });
buildAnalysisHref("/channel-analysis", filters, { normalizedName: alert.normalizedName });
buildAnalysisHref("/batch-tracking", filters, { batchId: alert.batchId, memberId: alert.memberId });
```

提醒必须同时显示文字原因和数量，不只依赖红色。无提醒显示“当前没有需要处理的数据”。

- [ ] **Step 6: 运行概览和旧工作台测试**

Run: `npm test -- --run tests/unit/overview-query.test.ts tests/unit/dashboard-insights.test.ts tests/unit/dashboard-query-shape.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交管理概览**

```bash
git add src/lib/analytics/overview.ts src/components/analytics src/app/\(app\)/dashboard/page.tsx src/app/globals.css tests/unit/overview-query.test.ts
git commit -m "feat: build management overview"
```

---

### Task 5: 团队表现与人员详情

**Files:**
- Create: `src/lib/analytics/team-performance.ts`
- Create: `src/app/(app)/team-performance/page.tsx`
- Create: `src/components/analytics/FunnelSummary.tsx`
- Create: `src/components/analytics/team/TeamPerformanceTable.tsx`
- Create: `src/components/analytics/team/MemberPerformanceDrawer.tsx`
- Create: `tests/unit/team-performance-query.test.ts`

**Interfaces:**
- Consumes: `AnalysisScope`、`getMaturity()`、`getSampleState()`、`getLargestDrop()`、`buildAnalysisHref()`。
- Produces: `loadTeamPerformance(scope, today)`，返回 `groupRows`、`memberRows` 和可选的 `selectedMemberDetail`。

- [ ] **Step 1: 写失败的小组和人员归属测试**

```ts
const admin = await loadTeamPerformance(adminScope(), "2026-08-12");
expect(admin.groupRows[0]).toMatchObject({ groupId: "group-a", activePeople: 2 });
expect(admin.memberRows.find((row) => row.userId === "lead-a")?.role).toBe("LEAD");
expect(admin.memberRows.find((row) => row.userId === "admin")).toBeUndefined();

const lead = await loadTeamPerformance(leadScope("group-a"), "2026-08-12");
expect(new Set(lead.memberRows.map((row) => row.groupId))).toEqual(new Set(["group-a"]));
expect(lead.memberRows.find((row) => row.userId === "other-group-member")).toBeUndefined();
```

再建立同一 `SourceBatch` 下组长和成员分别录入事件，断言数字按 `enteredById` 分开，不按批次整包归属。

- [ ] **Step 2: 运行测试，确认团队查询尚不存在**

Run: `npm test -- --run tests/unit/team-performance-query.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现查询和排序**

```ts
export type MemberPerformanceRow = {
  userId: string;
  name: string;
  role: "LEAD" | "MEMBER";
  groupId: string;
  groupName: string;
  active: boolean;
  totals: BatchTotals;
  rates: ConversionRates;
  sampleState: "RANKABLE" | "INSUFFICIENT";
  matureNewFans: number;
};
```

默认只用已经达到 D7 的批次计算排名转化率，但“获粉、开单、充值”同时返回选定 30 天范围的总量。默认排序：充值降序 → 开单降序 → 获粉降序 → 姓名。小组人均开单为 `orders / activePeople`，没有活跃业务人员时为 `null`。

- [ ] **Step 4: 实现主表和人员抽屉**

管理员默认显示小组表，点击小组后通过 `groupId` 查询参数显示人员表；组长直接显示本组人员表且不渲染小组筛选。主表列固定为姓名角色、样本、入群率、注册率、开单率、开单数、充值。

人员抽屉由 `memberId` 查询参数打开，内容顺序固定为：核心结果、完整漏斗与最大掉点、最近趋势、渠道构成、查看相关批次。关闭抽屉只移除 `memberId`，保留其他筛选。复用现有 `Drawer`，打开后焦点进入关闭按钮，关闭后回到原表格按钮。

- [ ] **Step 5: 运行团队查询与权限测试**

Run: `npm test -- --run tests/unit/team-performance-query.test.ts tests/unit/analytics-scope.test.ts tests/unit/report-scope.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交团队表现**

```bash
git add src/lib/analytics/team-performance.ts src/app/\(app\)/team-performance/page.tsx src/components/analytics/FunnelSummary.tsx src/components/analytics/team tests/unit/team-performance-query.test.ts
git commit -m "feat: add team performance analysis"
```

---

### Task 6: 渠道质量分析与渠道详情

**Files:**
- Create: `src/lib/analytics/channel-analysis.ts`
- Create: `src/app/(app)/channel-analysis/page.tsx`
- Create: `src/components/analytics/channel/ChannelQualityTable.tsx`
- Create: `src/components/analytics/channel/ChannelDetailDrawer.tsx`
- Create: `tests/unit/channel-analysis-query.test.ts`

**Interfaces:**
- Consumes: `AnalysisScope`、`normalizeChannelName()`、Task 2 指标规则、`FunnelSummary`。
- Produces: `loadChannelAnalysis(scope, today)`，返回 `rows` 和可选 `selectedChannelDetail`。

- [ ] **Step 1: 写失败的归一化和样本门槛测试**

```ts
const result = await loadChannelAnalysis(adminScope(), "2026-08-12");
const douyin = result.rows.find((row) => row.normalizedName === "抖音直播");
expect(douyin).toMatchObject({ newFans: 25, groups: expect.arrayContaining(["一组", "二组"]) });
expect(douyin?.rankable).toBe(true);
expect(result.rows.find((row) => row.normalizedName === "小红书")?.rankable).toBe(false);
expect(result.rankableRows.every((row) => row.newFans >= 20)).toBe(true);
```

同名渠道在不同小组通过 `normalizedName` 合并；复用相同旧 `channelId` 但名称不同的渠道不得合并。

- [ ] **Step 2: 运行测试，确认渠道查询尚不存在**

Run: `npm test -- --run tests/unit/channel-analysis-query.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现渠道质量指标**

```ts
export type ChannelQualityRow = {
  normalizedName: string;
  displayName: string;
  newFans: number;
  groupRate: number | null;
  registrationRate: number | null;
  orderRate: number | null;
  rechargePerFanCents: number | null;
  rankable: boolean;
  groupCount: number;
};
```

`rechargePerFanCents = newFans === 0 ? null : rechargeCents / newFans`。正式排名先按 `rankable` 分区，再按充值/粉降序、开单率降序、渠道名升序。D7、D14 累计指标分别只统计已成熟批次在来源日后第 7/14 天以内发生的事件。

- [ ] **Step 4: 实现渠道主表和详情抽屉**

主表只有渠道、获粉样本量、入群率、注册率、开单率、充值/粉。样本不足行显示具体获粉数和“样本不足”，不显示红绿判断。渠道抽屉按顺序显示回复率、退群率、专家介绍率、充值/开单、完整漏斗、D7/D14、涉及小组和“查看相关批次”。

详情链接使用：

```ts
buildAnalysisHref("/batch-tracking", filters, { normalizedName: row.normalizedName });
```

- [ ] **Step 5: 运行渠道回归测试**

Run: `npm test -- --run tests/unit/channel-analysis-query.test.ts tests/unit/channel-names.test.ts tests/unit/report-query.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交渠道分析**

```bash
git add src/lib/analytics/channel-analysis.ts src/app/\(app\)/channel-analysis/page.tsx src/components/analytics/channel tests/unit/channel-analysis-query.test.ts
git commit -m "feat: add channel quality analysis"
```

---

### Task 7: 批次追踪、优先级和二级详情

**Files:**
- Create: `src/lib/analytics/batch-tracking.ts`
- Create: `src/app/(app)/batch-tracking/page.tsx`
- Create: `src/app/(app)/batch-tracking/[batchId]/page.tsx`
- Create: `src/components/analytics/batch/BatchTrackingTable.tsx`
- Create: `src/components/analytics/batch/BatchDetail.tsx`
- Create: `tests/unit/batch-tracking-query.test.ts`

**Interfaces:**
- Consumes: `AnalysisScope`、Task 2 批次状态和成熟度、`buildAnalysisHref()`。
- Produces: `loadBatchTracking(scope, today)` 和 `loadBatchDetail(scope, batchId, memberId, today)`。

- [ ] **Step 1: 写失败的人员批次拆分测试**

```ts
const result = await loadBatchTracking(adminScope({ sourceDateFrom: "2026-07-29" }), "2026-08-12");
const sameBatchRows = result.rows.filter((row) => row.batchId === sharedBatchId);
expect(sameBatchRows).toHaveLength(2);
expect(new Set(sameBatchRows.map((row) => row.memberId))).toEqual(new Set(["lead-a", "member-a"]));
expect(result.rows.find((row) => row.sourceDate === "2026-08-12")?.ageLabel).toBe("D0");
expect(result.rows.find((row) => row.sourceDate === "2026-08-05")?.ageLabel).toBe("D4–7");
expect(result.rows.find((row) => row.status === "STALLED")).toBeTruthy();
```

再断言组长查询无法返回其他小组行，伪造 `memberId` 的详情返回 `null`。

- [ ] **Step 2: 运行测试，确认批次查询尚不存在**

Run: `npm test -- --run tests/unit/batch-tracking-query.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现批次列表查询**

```ts
export type BatchTrackingRow = {
  key: string; // `${batchId}:${memberId}`
  batchId: string;
  memberId: string;
  sourceDate: string;
  normalizedName: string;
  channelName: string;
  memberName: string;
  groupId: string;
  groupName: string;
  ageDays: number;
  ageLabel: "D0" | "D1–3" | "D4–7" | "D8–14" | "D15+";
  totals: BatchTotals;
  currentStage: FunnelStage;
  largestDrop: FunnelDrop | null;
  status: BatchStatus;
};
```

默认来源日期为最近 14 天。排序优先级固定为：`DATA_ANOMALY`、`STALLED`、`NORMAL`、`INSUFFICIENT`、`ORDERED`；同状态按年龄降序、来源日期升序、渠道名和人员名升序。

- [ ] **Step 4: 实现二级详情和历史跳转**

详情 URL 必须同时包含人员归属：`/batch-tracking/${batchId}?memberId=${memberId}`。服务端用 `batchId + enteredById + readable group` 三重条件取数据，不能只按 `batchId`。内容顺序为批次身份、完整漏斗、最大掉点、D7/D14、阶段日期趋势、对应历史记录。

历史跳转：

```ts
buildAnalysisHref("/history", filters, {
  sourceDateFrom: detail.sourceDate,
  sourceDateTo: detail.sourceDate,
  memberId: detail.memberId,
  normalizedName: detail.normalizedName,
});
```

- [ ] **Step 5: 运行批次和历史权限回归测试**

Run: `npm test -- --run tests/unit/batch-tracking-query.test.ts tests/unit/history-groups.test.ts tests/unit/history-update.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交批次追踪**

```bash
git add src/lib/analytics/batch-tracking.ts src/app/\(app\)/batch-tracking src/components/analytics/batch tests/unit/batch-tracking-query.test.ts
git commit -m "feat: add batch tracking analysis"
```

---

### Task 8: 旧报表迁移、跨页筛选和完整核心流程

**Files:**
- Modify: `src/app/(app)/reports/page.tsx`
- Modify: `src/app/(app)/history/page.tsx`
- Modify: `src/components/history/HistoryGroupList.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/e2e/management-analysis.spec.ts`
- Modify: `tests/e2e/dashboard.spec.ts`
- Modify: `tests/e2e/reports.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-12-management-analysis-information-architecture-design.md`

**Interfaces:**
- Consumes: 四个入口和 `buildAnalysisHref()`。
- Produces: 完整下钻链路、旧链接兼容和最终验收证据。

- [ ] **Step 1: 写最小核心流程浏览器测试**

```ts
test("lead sees only own group across four management entries", async ({ page }) => {
  await loginAs(page, "lead", "demo-password");
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "管理概览" })).toBeVisible();
  await expect(page.getByLabel("小组")).toHaveCount(0);
  await page.getByRole("link", { name: "团队表现" }).click();
  await expect(page.getByRole("row", { name: /组长/ })).toBeVisible();
  await expect(page.getByText("二组")).toHaveCount(0);
});

test("manager drill-down preserves filters", async ({ page }) => {
  await loginAs(page, "admin", "demo-password");
  await page.goto("/channel-analysis?groupId=group-a&sourceDateFrom=2026-07-01&sourceDateTo=2026-08-12");
  await page.getByRole("button", { name: /查看渠道/ }).first().click();
  await page.getByRole("link", { name: "查看相关批次" }).click();
  await expect(page).toHaveURL(/groupId=group-a/);
  await expect(page).toHaveURL(/sourceDateFrom=2026-07-01/);
  await expect(page).toHaveURL(/normalizedName=/);
});
```

同文件再覆盖：普通成员三个新增入口被拒绝、组长伪造其他小组无数据、批次详情返回历史、本人确认全 0 数据成功。

- [ ] **Step 2: 运行浏览器测试，确认旧迁移流程尚未完成**

执行前先获得用户同意使用现有 Chrome Playwright 测试配置。

Run: `CI=1 npm run test:e2e -- --reporter=line tests/e2e/management-analysis.spec.ts`

Expected: 首次 FAIL 于旧 `/reports` 行为或缺少跨页参数保留。

- [ ] **Step 3: 完成旧入口迁移和历史筛选兼容**

- `MEMBER` 访问 `/reports` 继续渲染原个人报表。
- `ADMIN` 或 `LEAD` 访问 `/reports` 使用 `redirect("/team-performance")`。
- `/history` 接受 `sourceDateFrom`、`sourceDateTo`、`memberId`、`normalizedName`；仍使用现有权限过滤，组长不能因 URL 参数越权。
- 关闭抽屉、切换团队层级和跳转批次时只改目标参数，其他筛选保留。
- 保持设计说明状态为“用户已确认，等待实施”，实现完成后改为“已实现”。

- [ ] **Step 4: 完成桌面可用性和可访问性**

在现有 CSS 变量上增加 `.analysis-grid`、`.analysis-status`、`.analysis-detail-grid`、`.app-nav-section-label`；1280px 主表只显示设计规定的 5–7 列，详情列不塞回表格。所有状态同时显示文字；排序按钮有 `aria-sort`；抽屉有焦点进入、Tab 环、Escape 关闭和触发按钮焦点恢复。

- [ ] **Step 5: 运行聚焦测试和构建**

使用独立临时 SQLite：

```bash
cp prisma/dev.db /tmp/management-analysis-test.db
DATABASE_URL=file:/tmp/management-analysis-test.db npm test -- --run tests/unit/analytics-scope.test.ts tests/unit/analytics-metrics.test.ts tests/unit/daily-confirmation.test.ts tests/unit/overview-query.test.ts tests/unit/team-performance-query.test.ts tests/unit/channel-analysis-query.test.ts tests/unit/batch-tracking-query.test.ts
```

Expected: PASS。

Run: `npm run build`

Expected: PASS。

获得浏览器测试许可后运行：

Run: `CI=1 npm run test:e2e -- --reporter=line tests/e2e/management-analysis.spec.ts tests/e2e/dashboard.spec.ts tests/e2e/reports.spec.ts`

Expected: PASS。

- [ ] **Step 6: 用应用内浏览器做最终视觉检查**

按管理员和组长各检查一次 1280×900：侧边栏分组、顶部筛选数量、主表无横向滚动、抽屉焦点、空状态、样本不足、D7/D14 未成熟。发现视觉差异时只改现有设计 token 和共用组件，不给四个页面分别发明不同样式。

- [ ] **Step 7: 最终提交**

```bash
git add src/app src/components src/lib prisma tests docs/superpowers/specs/2026-08-12-management-analysis-information-architecture-design.md
git commit -m "feat: complete management analysis workspace"
```

---

## 自查结果

- 设计说明第 1–14 节均对应到 Task 1–8，没有遗漏权限、样本量、D7/D14、下钻、空状态或无障碍要求。
- 所有新增类型、函数、路由和测试文件都在任务中首次定义后再被后续任务使用。
- 第一版明确不加入目标管理、ROI、AI 预测、消息推送、人工任务流和综合评分。
- 现有管理员中心、组员管理、数据录入、历史编辑不重写，只增加必要的导航和筛选兼容。
- 实施时每个任务都先写失败测试、再实现、再复核、再提交；不会等全部做完才一次性检查。
