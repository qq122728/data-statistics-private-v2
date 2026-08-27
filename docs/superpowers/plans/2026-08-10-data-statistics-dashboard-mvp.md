# 数据统计后台 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个电脑端网页，让团队按“粉来源日期 + 渠道”录入获粉、回复、拉群、退群和转化数据，并按权限查看准确的转化报表。

**Architecture:** 使用 Next.js 单体应用：页面、登录、权限检查和 JSON API 都放在同一项目中。所有数据以“粉批次”为中心；每一条录入都是当天新增的事件，报表服务从事件聚合得到累计数、在群数和转化率。开发时使用 SQLite 文件数据库，数据访问只经 Prisma，因此部署时仅需把 Prisma 数据库连接切换到 PostgreSQL。

**Tech Stack:** Next.js（App Router）、TypeScript、Tailwind CSS、Prisma、SQLite、Zod、Vitest、Playwright。

## Global Constraints

- 首个交付物是电脑端网页，不做 Telegram 小程序。
- 组员只能读取和写入自己的数据；组长只能读取本小组数据；管理员可读取和管理全部数据。
- 粉批次唯一键为 `groupId + sourceDate + channelId`，显示格式为“来源日期 · 渠道”。
- 所有填写的数量均为当天新增量，不覆盖历史累计值。
- 回复、拉群、退群、引专家、注册、开单、充值都必须关联到一个粉批次；获粉创建或使用该批次。
- 充值只记录金额，数据库以整数分 `amountCents` 保存；开单只记录人数。
- 在群数由累计拉群减累计退群计算，不提供手工输入。
- 比率分母为 0 时返回 `null`，界面显示“暂无数据”。
- 输入数量必须为 0 或正整数；充值金额必须为 0 或正数。
- 离职成员和停用渠道保留历史记录，但不能继续录入。

---

## File Structure

- `package.json`：项目脚本和依赖。
- `prisma/schema.prisma`：用户、小组、渠道、粉批次、指标事件和登录会话的数据表。
- `prisma/seed.ts`：本地演示账号、小组、渠道和样例数据。
- `src/lib/db.ts`：Prisma 单例。
- `src/lib/auth.ts`：登录会话、当前用户和角色检查。
- `src/lib/permissions.ts`：数据范围检查，阻止越权读写。
- `src/lib/validation.ts`：所有 API 共享的 Zod 输入校验。
- `src/lib/metrics.ts`：按粉批次聚合事件、计算在群和转化率。
- `src/app/api/**/route.ts`：渠道、成员、粉批次、指标事件、报表和登录 API。
- `src/app/(app)/**/page.tsx`：登录后的录入、报表、历史记录和管理页面。
- `src/components/entry/*.tsx`：四类录入表单和粉批次搜索选择器。
- `src/components/reports/*.tsx`：筛选栏、统计卡、漏斗和明细表。
- `src/components/admin/*.tsx`：小组、成员、渠道管理表格。
- `tests/unit/*.test.ts`：指标、校验和权限的单元测试。
- `tests/e2e/*.spec.ts`：关键浏览器流程测试。

## Data Interfaces

```ts
export type Role = "ADMIN" | "LEAD" | "MEMBER";
export type MetricKind =
  | "NEW_FANS"
  | "REPLIES"
  | "GROUP_JOIN"
  | "GROUP_LEAVE"
  | "EXPERT_INTRO"
  | "REGISTRATION"
  | "ORDER"
  | "RECHARGE";

export type BatchKey = {
  groupId: string;
  channelId: string;
  sourceDate: string; // YYYY-MM-DD
};

export type MetricInput = {
  batchId: string;
  occurredOn: string; // YYYY-MM-DD
  kind: Exclude<MetricKind, "NEW_FANS">;
  quantity?: number;
  amountCents?: number;
};

export type BatchTotals = {
  newFans: number;
  replies: number;
  groupJoin: number;
  groupLeave: number;
  inGroup: number;
  expertIntro: number;
  registration: number;
  orders: number;
  rechargeCents: number;
};
```

### Task 1: 创建可运行的 Next.js 基础项目

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Create: `vitest.config.ts`, `tests/unit/smoke.test.ts`
- Create: `.env.example`, `.gitignore`

**Interfaces:**
- Produces: `npm run dev`, `npm run test`, `npm run test:e2e` 和 `npm run db:seed` 脚本。

- [ ] **Step 1: 写失败的启动测试**

```ts
// tests/unit/smoke.test.ts
import { describe, expect, it } from "vitest";

describe("application", () => {
  it("has a test runner", () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: 验证测试尚不能执行**

Run: `npm run test -- --run tests/unit/smoke.test.ts`

Expected: FAIL，提示缺少 `package.json` 或 `vitest`。

- [ ] **Step 3: 使用 TypeScript、Tailwind、Vitest 和 Playwright 初始化项目**

在 `package.json` 写入 `dev`、`build`、`test`、`test:e2e`、`db:generate`、`db:migrate`、`db:seed` 脚本；创建能渲染“数据统计”的最小首页；`.env.example` 包含 `DATABASE_URL="file:./dev.db"`。

- [ ] **Step 4: 验证基础项目**

Run: `npm run test -- --run tests/unit/smoke.test.ts && npm run build`

Expected: PASS，且 Next.js 构建成功。

- [ ] **Step 5: 提交**

若工作区已初始化 Git：`git add package.json tsconfig.json next.config.ts src tests .env.example .gitignore && git commit -m "chore: scaffold statistics dashboard"`。

### Task 2: 建立可追溯的数据模型与演示数据

**Files:**
- Create: `prisma/schema.prisma`, `prisma/seed.ts`, `src/lib/db.ts`
- Test: `tests/unit/batch-key.test.ts`

**Interfaces:**
- Consumes: `BatchKey`。
- Produces: Prisma 模型 `User`、`TeamGroup`、`Channel`、`SourceBatch`、`MetricEvent`、`Session`；函数 `getOrCreateSourceBatch(key: BatchKey)`。

- [ ] **Step 1: 写失败的粉批次唯一性测试**

```ts
it("uses date, channel and group as one source batch key", async () => {
  const first = await getOrCreateSourceBatch({
    groupId: "group-a", channelId: "channel-1", sourceDate: "2026-08-10",
  });
  const second = await getOrCreateSourceBatch({
    groupId: "group-a", channelId: "channel-1", sourceDate: "2026-08-10",
  });
  expect(second.id).toBe(first.id);
});
```

- [ ] **Step 2: 验证测试失败**

Run: `npm run test -- --run tests/unit/batch-key.test.ts`

Expected: FAIL，提示 `getOrCreateSourceBatch` 未定义。

- [ ] **Step 3: 实现 Prisma schema 和批次服务**

创建以下关系：小组有成员、渠道和粉批次；粉批次属于小组和渠道，具有唯一复合索引 `[groupId, channelId, sourceDate]`；指标事件属于粉批次与录入用户，保存 `occurredOn`、`kind`、可选 `quantity`、可选 `amountCents`。种子数据包括管理员、组长、组员、两个小组、两个渠道和两个粉批次。

- [ ] **Step 4: 运行迁移、种子和测试**

Run: `npm run db:generate && npm run db:migrate && npm run db:seed && npm run test -- --run tests/unit/batch-key.test.ts`

Expected: 数据库生成成功，测试 PASS。

- [ ] **Step 5: 提交**

若已有 Git：`git add prisma src/lib/db.ts tests/unit/batch-key.test.ts && git commit -m "feat: add source batch data model"`。

### Task 3: 实现输入校验、聚合和转化率计算

**Files:**
- Create: `src/lib/validation.ts`, `src/lib/metrics.ts`
- Test: `tests/unit/validation.test.ts`, `tests/unit/metrics.test.ts`

**Interfaces:**
- Consumes: `MetricInput` 和 `MetricEvent[]`。
- Produces: `parseNewFansInput()`, `parseMetricInput()`, `calculateBatchTotals(events)`, `calculateConversionRates(totals)`。

- [ ] **Step 1: 写失败的指标测试**

```ts
it("calculates in-group and returns null for zero denominators", () => {
  const totals = calculateBatchTotals([
    { kind: "GROUP_JOIN", quantity: 6 },
    { kind: "GROUP_LEAVE", quantity: 2 },
  ]);
  expect(totals.inGroup).toBe(4);
  expect(calculateConversionRates(totals).groupRate).toBeNull();
});

it("calculates the requested funnel ratios", () => {
  const totals = {
    newFans: 100, groupJoin: 20, groupLeave: 4,
    expertIntro: 5, registration: 2, orders: 1,
    replies: 0, inGroup: 16, rechargeCents: 0,
  };
  expect(calculateConversionRates(totals)).toMatchObject({
    groupRate: 0.2, leaveRate: 0.2, expertRate: 0.25,
    registrationRate: 0.4, orderRate: 0.01,
  });
});
```

- [ ] **Step 2: 验证测试失败**

Run: `npm run test -- --run tests/unit/metrics.test.ts`

Expected: FAIL，提示聚合函数不存在。

- [ ] **Step 3: 实现纯函数和 Zod 校验**

`calculateBatchTotals` 必须把事件相加、把 `GROUP_JOIN - GROUP_LEAVE` 作为 `inGroup`，把充值金额相加。`calculateConversionRates` 返回 `groupRate`、`leaveRate`、`expertRate`、`registrationRate`、`orderRate`，分母为 0 返回 `null`。校验拒绝负数量、负金额、没有粉批次的后续事件，以及数量型事件同时传金额。

- [ ] **Step 4: 验证实现**

Run: `npm run test -- --run tests/unit/validation.test.ts tests/unit/metrics.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

若已有 Git：`git add src/lib/validation.ts src/lib/metrics.ts tests/unit && git commit -m "feat: calculate funnel metrics"`。

### Task 4: 实现登录、会话与角色数据范围

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/permissions.ts`, `src/app/login/page.tsx`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`, `src/middleware.ts`
- Test: `tests/unit/permissions.test.ts`

**Interfaces:**
- Consumes: `Role`、`User`、`TeamGroup`。
- Produces: `requireUser()`, `requireRole(...roles)`, `canReadGroup(user, groupId)`, `canWriteBatch(user, batchId)`。

- [ ] **Step 1: 写失败的权限测试**

```ts
it("allows a lead to read only its own group", () => {
  const lead = { id: "lead-1", role: "LEAD", groupId: "group-a", active: true };
  expect(canReadGroup(lead, "group-a")).toBe(true);
  expect(canReadGroup(lead, "group-b")).toBe(false);
});

it("rejects inactive members", () => {
  const member = { id: "member-1", role: "MEMBER", groupId: "group-a", active: false };
  expect(canReadGroup(member, "group-a")).toBe(false);
});
```

- [ ] **Step 2: 验证测试失败**

Run: `npm run test -- --run tests/unit/permissions.test.ts`

Expected: FAIL，提示权限函数不存在。

- [ ] **Step 3: 实现不透明 session cookie 登录**

创建密码哈希、数据库 session 记录和 HTTP-only cookie；中间件把未登录用户导到 `/login`。管理员拥有全部范围；组长拥有本组范围；组员仅能读取 `createdById` 为自己的事件，并且只能向本组粉批次写入。

- [ ] **Step 4: 验证权限和构建**

Run: `npm run test -- --run tests/unit/permissions.test.ts && npm run build`

Expected: PASS。

- [ ] **Step 5: 提交**

若已有 Git：`git add src/lib/auth.ts src/lib/permissions.ts src/app/login src/app/api/auth src/middleware.ts tests/unit/permissions.test.ts && git commit -m "feat: add role based access"`。

### Task 5: 实现管理员的小组、成员和渠道管理

**Files:**
- Create: `src/app/(app)/admin/page.tsx`, `src/app/api/admin/groups/route.ts`, `src/app/api/admin/users/route.ts`, `src/app/api/admin/channels/route.ts`
- Create: `src/components/admin/GroupManager.tsx`, `src/components/admin/MemberManager.tsx`, `src/components/admin/ChannelManager.tsx`
- Test: `tests/e2e/admin-management.spec.ts`

**Interfaces:**
- Consumes: `requireRole("ADMIN")`。
- Produces: 管理员可创建小组、添加/调整/停用成员、创建/停用渠道。

- [ ] **Step 1: 写失败的管理员浏览器测试**

```ts
test("admin can add and deactivate a channel", async ({ page }) => {
  await loginAs(page, "admin@example.com", "demo-password");
  await page.goto("/admin");
  await page.getByRole("button", { name: "添加渠道" }).click();
  await page.getByLabel("渠道名称").fill("渠道 3");
  await page.getByRole("button", { name: "保存渠道" }).click();
  await expect(page.getByText("渠道 3")).toBeVisible();
});
```

- [ ] **Step 2: 验证测试失败**

Run: `npm run test:e2e -- tests/e2e/admin-management.spec.ts`

Expected: FAIL，提示页面或控件不存在。

- [ ] **Step 3: 实现管理接口和页面**

所有管理路由先 `requireRole("ADMIN")`。停用操作只更新 `active=false`，不删除记录。页面用三个独立卡片呈现小组、成员、渠道，明确标出“停用后保留历史数据”。

- [ ] **Step 4: 验证管理员流程**

Run: `npm run test:e2e -- tests/e2e/admin-management.spec.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

若已有 Git：`git add src/app/'(app)'/admin src/app/api/admin src/components/admin tests/e2e/admin-management.spec.ts && git commit -m "feat: manage groups members and channels"`。

### Task 6: 实现四类组员数据录入流程

**Files:**
- Create: `src/app/(app)/entry/page.tsx`, `src/app/api/batches/route.ts`, `src/app/api/events/route.ts`
- Create: `src/components/entry/NewFansForm.tsx`, `src/components/entry/RepliesForm.tsx`, `src/components/entry/GroupChangesForm.tsx`, `src/components/entry/ConversionForm.tsx`, `src/components/entry/BatchPicker.tsx`
- Test: `tests/e2e/data-entry.spec.ts`

**Interfaces:**
- Consumes: `getOrCreateSourceBatch(key)`, `parseNewFansInput()`, `parseMetricInput()`, `canWriteBatch(user, batchId)`。
- Produces: 四个独立录入表单；`POST /api/batches` 和 `POST /api/events`。

- [ ] **Step 1: 写失败的浏览器测试，覆盖“今天没获粉也能回复”**

```ts
test("member records replies for two earlier source batches without new fans", async ({ page }) => {
  await loginAs(page, "member@example.com", "demo-password");
  await page.goto("/entry");
  await page.getByRole("tab", { name: "回复" }).click();
  await addMetricRow(page, "2026-08-08 · 渠道 1", "2");
  await addMetricRow(page, "2026-08-06 · 渠道 2", "2");
  await page.getByRole("button", { name: "保存回复" }).click();
  await expect(page.getByText("已保存 2 条回复记录")).toBeVisible();
});
```

- [ ] **Step 2: 验证测试失败**

Run: `npm run test:e2e -- tests/e2e/data-entry.spec.ts`

Expected: FAIL，提示录入页或“回复”标签不存在。

- [ ] **Step 3: 实现录入 API**

`POST /api/batches` 接收来源日期、渠道和当日粉数量，创建或使用同一粉批次并写入 `NEW_FANS` 事件。`POST /api/events` 接收一个或多条 `MetricInput`；每一条先校验批次、小组、成员活动状态和数量，再在数据库事务中写入事件。

- [ ] **Step 4: 实现录入页面**

页面用四个标签：获粉、回复、拉群与退群、转化与充值。每个标签能“添加一行”；回复和全部后续类型使用 `BatchPicker` 搜索“来源日期 · 渠道”。获粉页只填渠道和当日粉；转化页的充值金额输入框显示元，但提交前转换为整数分。保存成功显示写入条数，失败保留输入并显示字段错误。

- [ ] **Step 5: 验证关键录入流程**

Run: `npm run test:e2e -- tests/e2e/data-entry.spec.ts && npm run test -- --run tests/unit/validation.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

若已有 Git：`git add src/app/'(app)'/entry src/app/api/batches src/app/api/events src/components/entry tests/e2e/data-entry.spec.ts && git commit -m "feat: add source batch data entry"`。

### Task 7: 实现历史记录与可追溯编辑边界

**Files:**
- Create: `src/app/(app)/history/page.tsx`, `src/app/api/history/route.ts`, `src/components/history/EventHistoryTable.tsx`
- Test: `tests/e2e/history-permissions.spec.ts`

**Interfaces:**
- Consumes: `canReadGroup()`、指标事件及粉批次数据。
- Produces: 按发生日期、来源日期、渠道、成员筛选的事件明细表。

- [ ] **Step 1: 写失败的历史范围测试**

```ts
test("member cannot see another member's event in history", async ({ page }) => {
  await loginAs(page, "member@example.com", "demo-password");
  await page.goto("/history");
  await expect(page.getByText("另一成员的测试记录")).toHaveCount(0);
});
```

- [ ] **Step 2: 验证测试失败**

Run: `npm run test:e2e -- tests/e2e/history-permissions.spec.ts`

Expected: FAIL，提示历史页面不存在。

- [ ] **Step 3: 实现历史 API 与表格**

查询必须通过权限服务注入数据范围：管理员全部、组长本组、组员仅本人。每行显示发生日期、粉来源日期、渠道、指标类型、数量/金额和录入人；已停用的成员与渠道显示原名称及“已停用”徽标。

- [ ] **Step 4: 验证历史页面**

Run: `npm run test:e2e -- tests/e2e/history-permissions.spec.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

若已有 Git：`git add src/app/'(app)'/history src/app/api/history src/components/history tests/e2e/history-permissions.spec.ts && git commit -m "feat: add scoped event history"`。

### Task 8: 实现按粉批次统计的报表页

**Files:**
- Create: `src/app/(app)/reports/page.tsx`, `src/app/api/reports/route.ts`
- Create: `src/components/reports/ReportFilters.tsx`, `src/components/reports/MetricCards.tsx`, `src/components/reports/FunnelChart.tsx`, `src/components/reports/BatchReportTable.tsx`
- Test: `tests/unit/report-query.test.ts`, `tests/e2e/reports.spec.ts`

**Interfaces:**
- Consumes: `BatchTotals`, `calculateConversionRates()`, `canReadGroup()`。
- Produces: `/api/reports` 返回带 totals、rates、batch label 的批次列表；报表页面展示筛选、指标卡、漏斗图和明细表。

- [ ] **Step 1: 写失败的报表查询测试**

```ts
it("aggregates all later events into the selected source cohort", async () => {
  const report = await buildReport({ sourceDateFrom: "2026-08-08", sourceDateTo: "2026-08-08" });
  expect(report.rows[0]).toMatchObject({
    label: "2026-08-08 · 渠道 1",
    totals: { newFans: 10, replies: 4, groupJoin: 6, groupLeave: 1, inGroup: 5 },
  });
});
```

- [ ] **Step 2: 验证测试失败**

Run: `npm run test -- --run tests/unit/report-query.test.ts`

Expected: FAIL，提示 `buildReport` 未定义。

- [ ] **Step 3: 实现报表查询与权限范围**

默认来源日期筛选计算每一批粉截至查询当天的累计转换。发生日期筛选仅限制该期间新增的事件，并在界面显示“按发生日期新增量”。API 返回比例为 `null` 时，组件输出“暂无数据”，不显示 0%。

- [ ] **Step 4: 实现报表页面**

顶部筛选包括小组（管理员）、成员（管理员/组长）、渠道、来源日期范围、发生日期范围。下面按顺序显示指标卡、转化漏斗、来源批次表。颜色只表达状态：蓝色为主操作、绿色为正向和充值、红色为退群/删除；录入型数字使用白底输入框。

- [ ] **Step 5: 验证聚合和界面**

Run: `npm run test -- --run tests/unit/report-query.test.ts tests/unit/metrics.test.ts && npm run test:e2e -- tests/e2e/reports.spec.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

若已有 Git：`git add src/app/'(app)'/reports src/app/api/reports src/components/reports tests/unit/report-query.test.ts tests/e2e/reports.spec.ts && git commit -m "feat: add cohort conversion reports"`。

### Task 9: 完成视觉、可访问性与全量验证

**Files:**
- Modify: `src/app/globals.css`, `src/app/(app)/layout.tsx`
- Modify: `README.md`
- Test: `tests/e2e/role-workflow.spec.ts`

**Interfaces:**
- Consumes: 全部页面与测试账号。
- Produces: 可运行的桌面网页、演示账户说明和全角色冒烟测试。

- [ ] **Step 1: 写失败的端到端角色工作流测试**

```ts
test("admin sees all data while a member sees only own data", async ({ browser }) => {
  const admin = await browser.newPage();
  await loginAs(admin, "admin@example.com", "demo-password");
  await admin.goto("/reports");
  await expect(admin.getByText("小组 B")).toBeVisible();

  const member = await browser.newPage();
  await loginAs(member, "member@example.com", "demo-password");
  await member.goto("/reports");
  await expect(member.getByText("小组 B")).toHaveCount(0);
});
```

- [ ] **Step 2: 验证测试失败或暴露缺口**

Run: `npm run test:e2e -- tests/e2e/role-workflow.spec.ts`

Expected: 早期可能 FAIL；修复任何越权或页面缺失后再继续。

- [ ] **Step 3: 完成桌面端视觉和键盘可用性**

在应用布局中实现固定侧栏和顶部上下文栏；表单 `label` 必须与输入关联；错误信息放在对应输入旁；按钮显示明确动词；页面在 1280px 宽度下无需横向滚动。更新 README：安装、迁移、种子、启动、三个演示账号、备份 SQLite 文件和改用 PostgreSQL 的环境变量位置。

- [ ] **Step 4: 全量验证**

Run: `npm run test && npm run test:e2e && npm run build`

Expected: 全部 PASS，生产构建成功。

- [ ] **Step 5: 提交**

若已有 Git：`git add src README.md tests/e2e/role-workflow.spec.ts && git commit -m "feat: finish statistics dashboard mvp"`。

## Plan Self-Review

- 规格覆盖：权限（Task 4、5、7、9）；粉批次及来源/发生日期（Task 2、6、8）；四类录入（Task 6）；自动在群与比例（Task 3、8）；报表（Task 8）；停用仍保留历史（Task 5、7）；电脑端视觉与错误处理（Task 6、9）。
- 范围检查：本计划只交付第一版网页；不包含 Telegram、小粉丝个人档案、充值人数或第三方自动导数。
- 类型检查：`MetricKind`、`BatchKey`、`MetricInput` 和 `BatchTotals` 在计划顶部统一定义，后续任务沿用同一命名。
- 占位检查：未留下任何待补充项目或模糊的后续实现描述。
