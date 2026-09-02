# Member Overview, Financial Accounting, and Risk Alerts Implementation Plan

> **历史归档，停止执行。** 本文只用于追溯当时的设计或实施过程；涉及资源部确认、手填进群/注册/开单、岗位权限、统计日期或旧前端的内容均不是现行规则。当前口径请看 [当前业务规则](/Users/aaaa/Desktop/数据统计/docs/business/current-business-rules.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有“异常榜单”升级为可实际管理资源分配的“组员数据总览”，补齐有效粉、渠道固定单价、财务核算、员工阶段、正向排名和按天风险预警，同时严格保持本人录入和角色数据边界。

**Architecture:** 原始业务数据继续保存为 `MetricEvent`，新增数量和金额事件，不保存客户端提交的消耗、净业绩或纯利；渠道固定单价、员工阶段和风险规则由管理员维护。分析查询从成熟批次的原始事件按需计算，渠道校正基准排除本人；人工确认限流/淘汰单独保存为不可混淆的管理决定。页面保留旧 `/anomaly-ranking` 地址以兼容现有导航，但标题和导航统一改成“组员数据总览”。

**Tech Stack:** Next.js 15 App Router、React 19、TypeScript、Prisma 6、SQLite、Zod、Tailwind CSS、Vitest、Playwright。

## Global Constraints

- [ ] 先阅读设计规格：`docs/superpowers/specs/2026-08-14-member-overview-financial-risk-design.md`。
- [ ] 组员和组长只能写入及修改本人数据；服务端不得接受 `enteredById` 来切换录入人。
- [ ] 组长可查看本组分析，但不能代填组员数据、改渠道价格、改员工阶段或改风险规则。
- [ ] 管理员设置每个具体渠道的唯一固定有效粉单价；不实现按日期价格。
- [ ] 未定价渠道允许录入，但 `costCents` 和 `profitCents` 必须为 `null`，并排除盈利排名与财务风险判断。
- [ ] 金额全部使用整数分；百分比和效率使用服务端计算结果，不把浮点金额写入数据库。
- [ ] 正式转化只使用成熟来源批次及 D0–D7 事件；未成熟、样本不足、未定价和数据异常必须显示状态，不得伪装成 0 或差表现。
- [ ] 限流观察和淘汰观察只生成建议，必须由管理员人工确认，绝不自动停用账号或减少资源。
- [ ] 现有 `.superpowers/` 和 `design-qa-assets/` 用户文件不得加入提交。
- [ ] 按用户要求减少重复复审：Task 1–5 作为 Phase A 完成后统一审查一次；Task 6–9 作为 Phase B 完成后统一审查和浏览器验收一次。
- [ ] 每个任务先写聚焦失败测试，再实现最小代码；各任务只跑聚焦测试，Phase A 末跑一次完整 unit，Phase B 末跑完整 unit、E2E 和 build。

---

## Phase A — 财务、录入与管理员规则基础

### Task 1: 扩展数据库模型和测试数据库夹具

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260814090000_add_financial_member_risk_foundation/migration.sql`
- Modify: `prisma/seed.ts`
- Modify: `tests/unit/helpers/analytics-db.ts`
- Create: `tests/unit/financial-schema.test.ts`

- [ ] **Step 1: 写数据库契约测试**

在 `tests/unit/financial-schema.test.ts` 使用独立临时 SQLite，执行迁移后验证：

```ts
expect(await prisma.channel.findFirst({
  select: { effectiveFanPriceCents: true },
})).toHaveProperty("effectiveFanPriceCents");

const member = await prisma.user.create({
  data: {
    id: "financial-schema-member",
    username: "financial-schema-member",
    name: "测试成员",
    role: "MEMBER",
    hireDate: "2026-08-01",
    stageOverride: "OBSERVATION",
    stageOverrideReason: "延长观察期",
  },
});
expect(member.hireDate).toBe("2026-08-01");
expect(member.stageOverride).toBe("OBSERVATION");
```

同时创建五种新事件并断言 Prisma 接受：`EFFECTIVE_FANS`、`NO_NUMBER`、`DUPLICATE_FANS`、`WITHDRAWAL`、`CHANNEL_PERFORMANCE`。

- [ ] **Step 2: 运行 RED 测试**

Run:

```bash
DATABASE_URL=file:/tmp/member-overview-schema-red.db npm test -- --run tests/unit/financial-schema.test.ts
```

Expected: FAIL，Prisma 类型或数据库列不存在。

- [ ] **Step 3: 修改 Prisma 模型**

在 `prisma/schema.prisma` 添加：

```prisma
enum MetricKind {
  NEW_FANS
  EFFECTIVE_FANS
  NO_NUMBER
  DUPLICATE_FANS
  REPLIES
  GROUP_JOIN
  GROUP_LEAVE
  EXPERT_INTRO
  REGISTRATION
  ORDER
  RECHARGE
  WITHDRAWAL
  CHANNEL_PERFORMANCE
}

enum EmployeeStageOverride {
  TRAINING
  OBSERVATION
  FORMAL
  PAUSED
}

enum RiskDecisionLevel {
  LIMIT_WATCH
  ELIMINATION_WATCH
}

model User {
  // 保留现有字段
  hireDate            String?
  stageOverride       EmployeeStageOverride?
  stageOverrideReason String?
  stageOverrideAt     DateTime?
  riskDecisions       RiskDecision[] @relation("RiskDecisionMember")
  madeRiskDecisions   RiskDecision[] @relation("RiskDecisionActor")
}

model Channel {
  // 保留现有字段
  effectiveFanPriceCents Int?
}

model RiskDecision {
  id              String            @id @default(cuid())
  memberId        String
  actorId         String
  level           RiskDecisionLevel
  evidenceThrough String
  reason          String
  member          User              @relation("RiskDecisionMember", fields: [memberId], references: [id])
  actor           User              @relation("RiskDecisionActor", fields: [actorId], references: [id])
  createdAt       DateTime          @default(now())

  @@index([memberId, createdAt])
}
```

`stageOverrideById` 不重复存入 `User`；操作者、前后值和原因统一写 `AuditLog`，避免产生额外双向关系和两份不一致的审计来源。

- [ ] **Step 4: 写明确的 SQLite 迁移**

迁移必须：

1. 重建 `MetricEvent` 以更新 SQLite enum 检查约束；
2. 为 `Channel` 添加 nullable `effectiveFanPriceCents`；
3. 为 `User` 添加四个阶段字段；
4. 创建 `RiskDecision`、外键和索引；
5. 保留所有现有事件、用户、渠道和批次。

- [ ] **Step 5: 更新 seed 与独立数据库帮助函数**

演示渠道设置不同固定价格，例如底料 5000 分、抖音 6500 分；演示用户填入确定的 `hireDate`，使页面可以同时展示培训、观察和正式阶段。测试帮助函数必须支持传入：

```ts
type AnalyticsMemberSeed = {
  id: string;
  name: string;
  role?: "LEAD" | "MEMBER";
  hireDate?: string | null;
  stageOverride?: "TRAINING" | "OBSERVATION" | "FORMAL" | "PAUSED" | null;
};

type AnalyticsChannelSeed = {
  id: string;
  name: string;
  effectiveFanPriceCents?: number | null;
};
```

- [ ] **Step 6: 生成客户端并运行 GREEN 测试**

Run:

```bash
npm run db:generate
DATABASE_URL=file:/tmp/member-overview-schema-green.db npm test -- --run tests/unit/financial-schema.test.ts
```

Expected: PASS，且临时库清理后工作区 `prisma/dev.db` 哈希未改变。

- [ ] **Step 7: 提交**

```bash
git add prisma/schema.prisma prisma/migrations/20260814090000_add_financial_member_risk_foundation/migration.sql prisma/seed.ts tests/unit/helpers/analytics-db.ts tests/unit/financial-schema.test.ts
git commit -m "feat: add member finance and risk foundation"
```

### Task 2: 建立财务、员工阶段和风险设置的纯函数口径

**Files:**
- Modify: `src/lib/metrics.ts`
- Modify: `src/lib/validation.ts`
- Create: `src/lib/finance.ts`
- Create: `src/lib/employee-stage.ts`
- Create: `src/lib/risk-settings.ts`
- Modify: `src/lib/settings.ts`
- Modify: `tests/unit/metrics.test.ts`
- Modify: `tests/unit/validation.test.ts`
- Create: `tests/unit/finance.test.ts`
- Create: `tests/unit/employee-stage.test.ts`
- Create: `tests/unit/risk-settings.test.ts`

- [ ] **Step 1: 为财务公式写 RED 测试**

覆盖以下公开接口：

```ts
export type FinancialInput = {
  effectiveFans: number;
  rechargeCents: number;
  withdrawalCents: number;
  channelPerformanceCents: number;
  effectiveFanPriceCents: number | null;
};

export type FinancialResult = {
  costCents: number | null;
  netPerformanceCents: number;
  profitCents: number | null;
  priceState: "PRICED" | "PENDING_PRICE";
};

export function calculateFinancials(input: FinancialInput): FinancialResult;
export function validateFanBreakdown(input: {
  newFans: number;
  effectiveFans: number;
  noNumber: number;
  duplicateFans: number;
}): { valid: true } | { valid: false; message: string };
```

测试固定例子：有效粉 100、价格 5000 分、充值 800000 分、通道业绩 100000 分、出金 200000 分，应得消耗 500000、净业绩 700000、纯利 200000。价格为 `null` 时净业绩仍为 700000，但消耗和纯利必须为 `null`。

- [ ] **Step 2: 为阶段和规则解析写 RED 测试**

`resolveEmployeeStage` 接收业务日期、入职日期、可选覆盖和全局天数：

```ts
export type EmployeeStage = "TRAINING" | "OBSERVATION" | "FORMAL" | "PAUSED";

export function resolveEmployeeStage(input: {
  onDate: string;
  hireDate: string | null;
  override: EmployeeStage | null;
  trainingDays: number;
  observationDays: number;
}): { stage: EmployeeStage; employmentDay: number | null; source: "AUTO" | "OVERRIDE" };
```

断言第 0–7 天培训、第 8–30 天观察、第 31 天正式、覆盖值优先；未来入职日期返回培训且 `employmentDay` 为 0，不产生负天数。

`parseRiskSettings` 必须从 `SystemSetting` 读取并校验默认值：

```ts
export const defaultRiskSettings = {
  trainingDays: 7,
  observationDays: 30,
  coachingEfficiency: 0.80,
  coachingDays: 7,
  limitEfficiency: 0.70,
  limitDays: 15,
  eliminationEfficiency: 0.60,
  eliminationDays: 30,
  replyMinNewFans: 50,
  groupMinNewFans: 50,
  leaveMinGroupJoin: 30,
  expertMinGroupJoin: 30,
  registrationMinExpert: 20,
  orderMinNewFans: 100,
  efficiencyMinEffectiveFans: 100,
  priceComparisonMinOrders: 5,
} as const;
```

- [ ] **Step 3: 运行 RED 测试**

```bash
npm test -- --run tests/unit/finance.test.ts tests/unit/employee-stage.test.ts tests/unit/risk-settings.test.ts tests/unit/metrics.test.ts tests/unit/validation.test.ts
```

Expected: FAIL，新增模块和字段尚不存在。

- [ ] **Step 4: 扩展指标模型和校验**

`BatchTotals` 新增：

```ts
effectiveFans: number;
noNumber: number;
duplicateFans: number;
withdrawalCents: number;
channelPerformanceCents: number;
```

数量事件是 `EFFECTIVE_FANS | NO_NUMBER | DUPLICATE_FANS`，金额事件是 `RECHARGE | WITHDRAWAL | CHANNEL_PERFORMANCE`。更新所有空 totals、switch 分支和聚合函数，避免新字段在渠道汇总中丢失。

`parseNewFansInput` 改为接收：

```ts
{
  channelId?: string;
  channelName?: string;
  sourceDate: string;
  quantity: number;
  effectiveFans: number;
  noNumber: number;
  duplicateFans: number;
}
```

并调用 `validateFanBreakdown` 拒绝三项合计大于获粉。`parseMetricInput` 允许两个新增金额事件，但仍严格拒绝金额事件附带 `quantity`。

- [ ] **Step 5: 实现纯函数与设置读写映射**

风险规则保存在 `SystemSetting` 的独立 key 中，使用整数基点保存效率阈值，避免字符串浮点漂移，例如 `risk.coachingEfficiencyBps=8000`。`getRiskSettings()` 遇到缺失 key 使用默认值，遇到非法数据库值返回默认值并保留可观测错误日志，不把页面打崩。

- [ ] **Step 6: 运行 GREEN 测试并提交**

```bash
npm test -- --run tests/unit/finance.test.ts tests/unit/employee-stage.test.ts tests/unit/risk-settings.test.ts tests/unit/metrics.test.ts tests/unit/validation.test.ts
git add src/lib/metrics.ts src/lib/validation.ts src/lib/finance.ts src/lib/employee-stage.ts src/lib/risk-settings.ts src/lib/settings.ts tests/unit/metrics.test.ts tests/unit/validation.test.ts tests/unit/finance.test.ts tests/unit/employee-stage.test.ts tests/unit/risk-settings.test.ts
git commit -m "feat: define finance stage and risk calculations"
```

### Task 3: 扩展本人数据录入和历史编辑

**Files:**
- Modify: `src/app/api/batches/route.ts`
- Modify: `src/app/api/events/route.ts`
- Modify: `src/app/api/history/route.ts`
- Modify: `src/app/(app)/entry/page.tsx`
- Modify: `src/components/entry/NewFansForm.tsx`
- Modify: `src/components/entry/EntryTabs.tsx`
- Create: `src/components/entry/FinancialForm.tsx`
- Modify: `src/lib/history-groups.ts`
- Modify: `src/components/history/history-display.ts`
- Modify: `src/components/history/HistoryGroupRow.tsx`
- Modify: `src/components/history/HistoryEditDrawer.tsx`
- Modify: `tests/unit/event-write-transaction.test.ts`
- Modify: `tests/unit/history-groups.test.ts`
- Modify: `tests/unit/history-update.test.ts`
- Modify: `tests/unit/entry-layout.test.ts`
- Modify: `tests/e2e/data-entry.spec.ts`
- Modify: `tests/e2e/history-permissions.spec.ts`

- [ ] **Step 1: 写获粉拆分与财务录入的 API RED 测试**

验证一次获粉提交在同一事务内创建四个事件：

```ts
expect(events.map((event) => [event.kind, event.quantity])).toEqual([
  ["DUPLICATE_FANS", 5],
  ["EFFECTIVE_FANS", 80],
  ["NEW_FANS", 100],
  ["NO_NUMBER", 10],
]);
```

验证三项合计 101、负数、超 Prisma Int 均返回 400 且数据库无半条数据。验证成员和组长提交体伪造 `enteredById` 时，新增事件仍只属于当前登录人或请求被拒绝，不能写入别人名下。

验证 `/api/events` 接受 `WITHDRAWAL` 和 `CHANNEL_PERFORMANCE` 的非负 `amountCents`，拒绝负数和带 `quantity` 的金额事件。

- [ ] **Step 2: 写历史整组编辑 RED 测试**

将 `historyMetricFields` 扩为：

```ts
[
  "newFans", "effectiveFans", "noNumber", "duplicateFans",
  "replies", "groupJoin", "groupLeave", "expertIntro",
  "registration", "order", "rechargeCents",
  "withdrawalCents", "channelPerformanceCents",
]
```

测试本人一次修改有效粉、出金、通道业绩后，旧事件被安全替换、fingerprint 更新、审计含前后值；测试三项合计超过获粉返回 400；组长和管理员仍不能编辑其他人的历史组。

- [ ] **Step 3: 运行 RED 单测**

```bash
npm test -- --run tests/unit/event-write-transaction.test.ts tests/unit/history-groups.test.ts tests/unit/history-update.test.ts tests/unit/entry-layout.test.ts
```

Expected: FAIL，新字段、新事件和 UI 入口尚不存在。

- [ ] **Step 4: 实现事务写入**

`POST /api/batches` 在解析后使用现有重试事务创建或复用渠道、批次，并写四个同日事件；即使值为 0 也写事件，使历史编辑抽屉始终能完整显示字段。所有事件 `enteredById` 固定使用会话用户。

`POST /api/events` 只接收单个指标事件，出金和通道业绩沿用批次权限检查。服务端不接收消耗、净业绩、纯利。

- [ ] **Step 5: 实现录入 UI**

`NewFansForm` 每行显示渠道、来源日期、获粉、有效粉、无号码、撞粉，实时显示“剩余其他无效粉”，三项合计超出时行内报错。

`EntryTabs` 增加第五个“财务记录”入口。`FinancialForm` 使用现有 `BatchPicker`，一次只选择自己的批次和发生日期，分别录入出金或通道业绩；充值仍保留在“转化与充值”中，避免破坏已熟悉流程。

- [ ] **Step 6: 实现历史整组显示和编辑**

更新 mapping、金额格式和抽屉字段。抽屉在客户端预检拆分合计，但服务端再次验证。编辑成功后原地替换组、保持筛选和排序；保留现有焦点陷阱、Escape 关闭和 stale fingerprint 409 行为。

- [ ] **Step 7: 跑 GREEN 单测与聚焦 E2E**

```bash
npm test -- --run tests/unit/event-write-transaction.test.ts tests/unit/history-groups.test.ts tests/unit/history-update.test.ts tests/unit/entry-layout.test.ts
CI=1 npm run test:e2e -- --reporter=line tests/e2e/data-entry.spec.ts tests/e2e/history-permissions.spec.ts
```

Expected: 单测全绿；E2E 真实完成组员新增自定义渠道、四项获粉录入、财务录入、本人历史修改，且 lead/admin 越权 PATCH 返回 403。

- [ ] **Step 8: 提交**

```bash
git add src/app/api/batches/route.ts src/app/api/events/route.ts src/app/api/history/route.ts 'src/app/(app)/entry/page.tsx' src/components/entry/NewFansForm.tsx src/components/entry/EntryTabs.tsx src/components/entry/FinancialForm.tsx src/lib/history-groups.ts src/components/history/history-display.ts src/components/history/HistoryGroupRow.tsx src/components/history/HistoryEditDrawer.tsx tests/unit/event-write-transaction.test.ts tests/unit/history-groups.test.ts tests/unit/history-update.test.ts tests/unit/entry-layout.test.ts tests/e2e/data-entry.spec.ts tests/e2e/history-permissions.spec.ts
git commit -m "feat: capture member finance and fan quality data"
```

### Task 4: 管理员设置渠道价格和员工阶段

**Files:**
- Modify: `src/app/api/admin/channels/route.ts`
- Modify: `src/components/admin/ChannelManager.tsx`
- Modify: `src/components/admin/ChannelTable.tsx`
- Modify: `src/app/api/admin/users/route.ts`
- Modify: `src/components/admin/MemberDrawer.tsx`
- Modify: `src/components/admin/MemberTable.tsx`
- Modify: `src/components/admin/admin-display.ts`
- Modify: `src/app/(app)/admin/page.tsx`
- Modify: `tests/unit/admin-channel-audit.test.ts`
- Modify: `tests/unit/admin-user-boundaries.test.ts`
- Modify: `tests/unit/admin-validation.test.ts`
- Modify: `tests/e2e/admin-management.spec.ts`

- [ ] **Step 1: 写渠道单价权限和审计 RED 测试**

管理员 PATCH：

```json
{ "id": "channel-1", "groupId": "group-1", "effectiveFanPriceCents": 5000 }
```

返回更新渠道并写 `CHANNEL_PRICE_UPDATED` 审计，summary 含 `before.effectiveFanPriceCents`、`after.effectiveFanPriceCents`。验证 0 为合法免费渠道，负数、非整数和超过 Prisma Int 返回 400；LEAD/MEMBER 返回 403；同名跨组渠道不能串改。

- [ ] **Step 2: 写入职日期和阶段覆盖 RED 测试**

管理员可提交：

```json
{
  "id": "member-1",
  "hireDate": "2026-08-01",
  "stageOverride": "OBSERVATION",
  "stageOverrideReason": "延长观察以补足样本"
}
```

阶段覆盖必须有不少于 4 个字的原因；清除覆盖时 `stageOverride=null` 且原因清空。写 `USER_EMPLOYMENT_UPDATED` 审计。组长开成员账号的现有接口不得因此获得改阶段能力。

- [ ] **Step 3: 运行 RED 测试**

```bash
npm test -- --run tests/unit/admin-channel-audit.test.ts tests/unit/admin-user-boundaries.test.ts tests/unit/admin-validation.test.ts
```

- [ ] **Step 4: 实现管理员 API 和 UI**

渠道列表新增“有效粉单价”列：已定价显示 `¥50.00 / 有效粉`，未定价显示黄色“待定价”。编辑价格使用元输入但 API 传整数分。

成员抽屉新增入职日期、自动阶段预览、手动阶段和原因；成员表显示“培训 / 观察 / 正式 / 暂停评价”标签。所有判断使用业务时区的日期，不用浏览器本地日期。

- [ ] **Step 5: 跑 GREEN 和浏览器管理流**

```bash
npm test -- --run tests/unit/admin-channel-audit.test.ts tests/unit/admin-user-boundaries.test.ts tests/unit/admin-validation.test.ts
CI=1 npm run test:e2e -- --reporter=line tests/e2e/admin-management.spec.ts
```

Expected: 管理员真实设置价格、修改阶段并看到日志；组长管理成员页面不出现价格和阶段操作，伪造请求仍 403。

- [ ] **Step 6: 提交**

```bash
git add src/app/api/admin/channels/route.ts src/components/admin/ChannelManager.tsx src/components/admin/ChannelTable.tsx src/app/api/admin/users/route.ts src/components/admin/MemberDrawer.tsx src/components/admin/MemberTable.tsx src/components/admin/admin-display.ts 'src/app/(app)/admin/page.tsx' tests/unit/admin-channel-audit.test.ts tests/unit/admin-user-boundaries.test.ts tests/unit/admin-validation.test.ts tests/e2e/admin-management.spec.ts
git commit -m "feat: let admins price channels and manage stages"
```

### Task 5: 管理员风险规则和人工确认接口

**Files:**
- Modify: `src/components/admin/AdminSectionNav.tsx`
- Create: `src/app/api/admin/risk-settings/route.ts`
- Create: `src/components/admin/RiskSettingsForm.tsx`
- Modify: `src/app/(app)/admin/page.tsx`
- Create: `src/app/api/admin/risk-decisions/route.ts`
- Create: `tests/unit/admin-risk-settings.test.ts`
- Create: `tests/unit/risk-decision-auth.test.ts`
- Modify: `tests/e2e/admin-management.spec.ts`

- [ ] **Step 1: 写规则设置 RED 测试**

验证管理员可整体 PATCH `RiskSettings`，服务端强制：阶段天数递增、效率阈值为 0–1、辅导/限流/淘汰连续天数为正整数、每个样本门槛为非负整数。规则改变写 `RISK_SETTINGS_UPDATED` 审计；LEAD/MEMBER GET 和 PATCH 都是 403，不能读取隐藏管理规则。

- [ ] **Step 2: 写人工确认 RED 测试**

`POST /api/admin/risk-decisions` 接收：

```ts
{
  memberId: string;
  level: "LIMIT_WATCH" | "ELIMINATION_WATCH";
  evidenceThrough: string;
  reason: string;
}
```

验证只有管理员可写；成员必须为 LEAD/MEMBER；原因至少 4 字；操作仅创建管理决定和审计，不修改用户 `active`、小组或任何事件。

- [ ] **Step 3: 运行 RED 测试**

```bash
npm test -- --run tests/unit/admin-risk-settings.test.ts tests/unit/risk-decision-auth.test.ts
```

- [ ] **Step 4: 实现管理页面**

在管理员中心增加 `risk` section“预警规则”。表单分为员工阶段、连续偏低、样本门槛三组，直接展示大白话解释，例如“连续 7 个合格评价日低于 0.80 才建议辅导”。保存成功后刷新服务端数据并显示审计可追溯提示。

- [ ] **Step 5: 实现人工确认 API**

接口只存 `RiskDecision` 和 `AuditLog`。重复确认允许追加记录以保留历次管理判断，但必须在返回体中给出最新决定，供详情抽屉显示。

- [ ] **Step 6: 跑 GREEN、Phase A 完整单测和 build**

```bash
npm test -- --run tests/unit/admin-risk-settings.test.ts tests/unit/risk-decision-auth.test.ts
DATABASE_URL=file:/tmp/member-overview-phase-a.db npm test -- --run
npm run build
git diff --check
```

Expected: 完整 unit 全绿、build 成功、默认 `prisma/dev.db` 未被测试改写。

- [ ] **Step 7: Phase A 统一审查**

只在此处做一次 Phase A 代码审查，重点检查：本人写入边界、金额整数分、渠道跨组隔离、历史编辑的事务原子性、所有管理员修改的审计。发现 P0/P1 时先补 RED 测试再修复；P2 记录到 Phase B 一并处理，不逐文件重复复审。

- [ ] **Step 8: 提交**

```bash
git add src/components/admin/AdminSectionNav.tsx src/app/api/admin/risk-settings/route.ts src/components/admin/RiskSettingsForm.tsx 'src/app/(app)/admin/page.tsx' src/app/api/admin/risk-decisions/route.ts tests/unit/admin-risk-settings.test.ts tests/unit/risk-decision-auth.test.ts tests/e2e/admin-management.spec.ts
git commit -m "feat: add configurable member risk rules"
```

---

## Phase B — 四页签分析、风险证据与最终体验

### Task 6: 构建组员总览聚合和渠道校正引擎

**Files:**
- Create: `src/lib/analytics/member-overview.ts`
- Create: `src/lib/analytics/channel-adjustment.ts`
- Create: `src/lib/analytics/member-periods.ts`
- Modify: `src/lib/analytics/types.ts`
- Modify: `src/lib/analytics/scope.ts`
- Create: `tests/unit/member-overview-query.test.ts`
- Create: `tests/unit/channel-adjustment.test.ts`
- Create: `tests/unit/member-periods.test.ts`
- Modify: `tests/unit/analytics-scope.test.ts`

- [ ] **Step 1: 定义查询返回契约并写 RED 测试**

核心接口：

```ts
export type MemberOverviewRow = {
  member: { id: string; name: string; active: boolean; role: "LEAD" | "MEMBER" };
  group: { id: string; name: string };
  stage: EmployeeStage;
  totals: BatchTotals;
  effectiveRate: number | null;
  orderRate: number | null;
  rechargePerEffectiveFanCents: number | null;
  financials: FinancialResult;
  adjustedEfficiency: number | null;
  adjustedState: "READY" | "INSUFFICIENT_PEERS" | "INSUFFICIENT_SAMPLE" | "DATA_INVALID";
  trend: number | null;
  pricingState: "PRICED" | "PENDING_PRICE";
};

export type MemberOverviewResult = {
  rows: MemberOverviewRow[];
  summary: {
    effectiveFans: number;
    rechargeCents: number;
    costCents: number | null;
    profitCents: number | null;
    attentionMemberCount: number;
    matureBatchCount: number;
    observingBatchCount: number;
    rankedMemberCount: number;
  };
  pendingPriceChannels: Array<{ id: string; groupId: string; name: string }>;
};

export async function loadMemberOverview(scope: AnalysisScope, today: string): Promise<MemberOverviewResult>;
```

测试必须使用真实临时数据库并覆盖：管理员全公司、组长仅本组、成员调用被拒绝或页面重定向；停用人员默认排除；D7 外事件排除；未定价时财务 `null`；定价后历史自动补算；数据异常不进入评价。

- [ ] **Step 2: 写渠道校正 RED 测试**

公开纯函数：

```ts
export function calculateChannelAdjustedEfficiency(input: {
  memberId: string;
  channels: Array<{
    groupId: string;
    normalizedName: string;
    effectiveFans: number;
    orders: number;
    peers: Array<{ memberId: string; effectiveFans: number; orders: number }>;
  }>;
  minMemberEffectiveFans: number;
  minPeerEffectiveFans: number;
}): {
  actualOrders: number;
  expectedOrders: number | null;
  efficiency: number | null;
  state: "READY" | "INSUFFICIENT_PEERS" | "INSUFFICIENT_SAMPLE";
};
```

断言基准排除本人、同组同渠道才可合并、不同小组同名渠道不得混入；预计开单为 0 时不生成无限效率。

- [ ] **Step 3: 写成熟周期 RED 测试**

`resolveMemberPeriods` 支持 `mature7`、`mature30`、`custom`，默认 `mature30`。返回当前和上一等长来源日范围，便于趋势比较。URL 参数非法时回退默认并返回 warning。

- [ ] **Step 4: 运行 RED 测试**

```bash
npm test -- --run tests/unit/member-overview-query.test.ts tests/unit/channel-adjustment.test.ts tests/unit/member-periods.test.ts tests/unit/analytics-scope.test.ts
```

- [ ] **Step 5: 实现一次查询、内存聚合**

一次读取授权范围内成员、渠道、批次和事件，按 `batch.groupId + enteredById` 双重归属过滤。先按成员×渠道聚合，再汇总到成员，避免同名渠道串组。当前周期和上一周期使用同一口径。禁止在成员循环里逐人查询数据库。

- [ ] **Step 6: 排序与状态规则**

总览默认已定价且可比较人员按纯利降序；待定价、样本不足和暂停评价仍显示，但排在正式排行之后并带明确状态。培训期和观察期保留业务数据，不进入正式正负排名。

- [ ] **Step 7: 跑 GREEN 并提交**

```bash
DATABASE_URL=file:/tmp/member-overview-query.db npm test -- --run tests/unit/member-overview-query.test.ts tests/unit/channel-adjustment.test.ts tests/unit/member-periods.test.ts tests/unit/analytics-scope.test.ts
git add src/lib/analytics/member-overview.ts src/lib/analytics/channel-adjustment.ts src/lib/analytics/member-periods.ts src/lib/analytics/types.ts src/lib/analytics/scope.ts tests/unit/member-overview-query.test.ts tests/unit/channel-adjustment.test.ts tests/unit/member-periods.test.ts tests/unit/analytics-scope.test.ts
git commit -m "feat: calculate fair member performance summaries"
```

### Task 7: 构建按天风险评价和证据下钻

**Files:**
- Create: `src/lib/analytics/risk-evaluation.ts`
- Create: `src/lib/analytics/data-risk.ts`
- Create: `src/lib/analytics/member-evidence.ts`
- Create: `src/app/api/member-overview/[memberId]/route.ts`
- Create: `tests/unit/risk-evaluation.test.ts`
- Create: `tests/unit/data-risk.test.ts`
- Create: `tests/unit/member-evidence-auth.test.ts`

- [ ] **Step 1: 写按天连续评价 RED 测试**

核心接口：

```ts
export type DailyEvaluation = {
  evaluationDate: string;
  eligible: boolean;
  efficiency: number | null;
  state: "LOW" | "OK" | "OBSERVING";
  reason: "READY" | "IMMATURE" | "INSUFFICIENT_SAMPLE" | "PENDING_PRICE" | "DATA_INVALID";
};

export function countConsecutiveLowDays(
  evaluations: readonly DailyEvaluation[],
  threshold: number,
): number;
```

测试顺序按日期升序：合格偏低日加一；`OBSERVING` 暂停但不清零；合格且不偏低日清零；未来或重复日期拒绝。风险级别取当前满足的最高级，并受员工阶段限制：培训无风险，观察最多辅导，正式可到限流/淘汰。

- [ ] **Step 2: 写数据风险和财务风险 RED 测试**

数据风险至少包含：未确认、长期无记录、下游大于上游、退群大于入群、频繁修改历史、渠道待定价。它们只能返回 `category: "DATA"`，不能增加表现连续偏低天数。

财务风险覆盖：已定价且持续纯利为负、纯利显著下降、出金异常；未定价只返回“待定价”数据风险，不返回亏损预警。

- [ ] **Step 3: 写详情权限 RED 测试**

`GET /api/member-overview/[memberId]`：管理员读取授权小组内 LEAD/MEMBER；组长只读本组；成员 403；跨组 403；不存在也返回统一 404/403 策略，不能借错误差异枚举人员。

- [ ] **Step 4: 运行 RED 测试**

```bash
npm test -- --run tests/unit/risk-evaluation.test.ts tests/unit/data-risk.test.ts tests/unit/member-evidence-auth.test.ts
```

- [ ] **Step 5: 实现滚动评价**

每个评价日使用最近 7 个已成熟来源日的 D0–D7 事件，复用 Task 6 渠道校正函数。实现纯函数生成日期序列，不创建定时任务和缓存表；这样历史编辑、价格修正或规则变化后立即按原始证据重算，不会留下陈旧预警。

- [ ] **Step 6: 实现证据详情**

详情返回完整漏斗、渠道构成、单价、财务算式、当前与上期趋势、最大掉点、风险证据、相关成熟批次和最新人工决定。接口返回已格式化前的数值和状态，组件负责中文展示。

- [ ] **Step 7: 跑 GREEN 并提交**

```bash
DATABASE_URL=file:/tmp/member-risk-query.db npm test -- --run tests/unit/risk-evaluation.test.ts tests/unit/data-risk.test.ts tests/unit/member-evidence-auth.test.ts
git add src/lib/analytics/risk-evaluation.ts src/lib/analytics/data-risk.ts src/lib/analytics/member-evidence.ts 'src/app/api/member-overview/[memberId]/route.ts' tests/unit/risk-evaluation.test.ts tests/unit/data-risk.test.ts tests/unit/member-evidence-auth.test.ts
git commit -m "feat: explain daily member risk evidence"
```

### Task 8: 重做“组员数据总览”四页签和详情交互

**Files:**
- Modify: `src/app/(app)/anomaly-ranking/page.tsx`
- Create: `src/app/(app)/anomaly-ranking/loading.tsx`
- Create: `src/app/(app)/anomaly-ranking/error.tsx`
- Create: `src/components/analytics/member/MemberOverviewTabs.tsx`
- Create: `src/components/analytics/member/MemberOverviewSummary.tsx`
- Create: `src/components/analytics/member/MemberOverviewTable.tsx`
- Create: `src/components/analytics/member/PerformanceRankings.tsx`
- Create: `src/components/analytics/member/ConversionRankingTable.tsx`
- Create: `src/components/analytics/member/RiskAlerts.tsx`
- Create: `src/components/analytics/member/MemberInsightDrawer.tsx`
- Create: `src/components/analytics/member/RiskDecisionDialog.tsx`
- Modify: `src/components/analytics/AnalysisFilters.tsx`
- Modify: `src/lib/app-navigation.ts`
- Modify: `tests/unit/anomaly-ranking-ui.test.ts`
- Create: `tests/unit/member-overview-ui.test.ts`
- Modify: `tests/unit/navigation.test.ts`
- Modify: `tests/e2e/management-analysis.spec.ts`

- [ ] **Step 1: 写 UI 契约 RED 测试**

测试页面标题和导航是“组员数据总览”，四个页签可通过 `tab=overview|performance|conversion|risk` 的 URL 恢复。筛选支持 `period=mature7|mature30|custom`、小组、渠道、人员和停用人员；组长没有可切换小组控件，成员没有导航入口。

测试各页签关键列：

- 总览：有效粉、开单、充值、消耗、纯利、渠道校正效率、趋势、建议；
- 业绩：盈利贡献、渠道校正效率、稳定进步三榜；
- 转化：回复率、入群率、退群率、引专家率、注册率、开单率、每粉充值、渠道校正效率；
- 风险：表现风险、财务风险、数据风险分区，不混为一个红榜。

- [ ] **Step 2: 写真实浏览器 RED 用例**

在 `management-analysis.spec.ts` 增加：管理员切四页签、周期和成员筛选后刷新仍保留；组长固定本组；点击成员打开详情抽屉；手机 viewport 显示卡片/全屏详情；未定价渠道显示待定价；规则满足时管理员可以确认限流观察，但用户仍保持 active。

- [ ] **Step 3: 运行 RED**

```bash
npm test -- --run tests/unit/anomaly-ranking-ui.test.ts tests/unit/member-overview-ui.test.ts tests/unit/navigation.test.ts
CI=1 npm run test:e2e -- --reporter=line tests/e2e/management-analysis.spec.ts
```

- [ ] **Step 4: 实现共享页面框架**

服务端读取公共筛选、摘要和对应页签数据。页签用 Next `Link` 更新 URL，保留所有筛选，不在客户端复制一份状态。切页保留整体框架，`loading.tsx` 只显示表格骨架；`error.tsx` 提供“重新加载”。

- [ ] **Step 5: 实现四个页签**

桌面端控制主列宽度，详情数据进入抽屉；移动端一人一卡。红色只用于明确风险，黄色用于观察/待核实，绿色用于正向结果，所有状态附文字。分母为 0 显示“—”和 tooltip“缺少有效分母”。

业绩排行不生成综合分；三个榜分别排序。转化排行一次选择一个指标，退群率按低到高，其余按高到低。样本不足人员可查看但不获得正式名次。

- [ ] **Step 6: 实现风险操作**

风险卡显示员工阶段、有效粉、样本状态、证据描述和“查看证据”。管理员对符合条件的限流/淘汰建议显示“人工确认”，弹窗强制填写原因并调用 `/api/admin/risk-decisions`；组长只显示“安排辅导”和查看证据，不显示确认操作。

- [ ] **Step 7: 跑 GREEN**

```bash
npm test -- --run tests/unit/anomaly-ranking-ui.test.ts tests/unit/member-overview-ui.test.ts tests/unit/navigation.test.ts
CI=1 npm run test:e2e -- --reporter=line tests/e2e/management-analysis.spec.ts
```

- [ ] **Step 8: 提交**

```bash
git add 'src/app/(app)/anomaly-ranking/page.tsx' 'src/app/(app)/anomaly-ranking/loading.tsx' 'src/app/(app)/anomaly-ranking/error.tsx' src/components/analytics/member src/components/analytics/AnalysisFilters.tsx src/lib/app-navigation.ts tests/unit/anomaly-ranking-ui.test.ts tests/unit/member-overview-ui.test.ts tests/unit/navigation.test.ts tests/e2e/management-analysis.spec.ts
git commit -m "feat: turn anomaly ranking into member overview"
```

### Task 9: 全链路验证、性能检查和最终大块审查

**Files:**
- Modify if required: `tests/e2e/role-workflow.spec.ts`
- Modify if required: `tests/e2e/reports.spec.ts`
- Create: `docs/superpowers/reviews/2026-08-14-member-overview-final-review.md`

- [ ] **Step 1: 完成端到端角色矩阵**

补齐且只补齐缺失用例：

| 行为 | ADMIN | LEAD | MEMBER |
|---|---:|---:|---:|
| 查看全公司总览 | 允许 | 仅本组 | 拒绝 |
| 录入自己的新字段 | 拒绝（管理员不录业务数据） | 允许且只归本人 | 允许且只归本人 |
| 代替别人录入/编辑 | 拒绝 | 拒绝 | 拒绝 |
| 创建组内渠道 | 按设置允许 | 按设置允许 | 按设置允许 |
| 设置渠道价格 | 允许 | 拒绝 | 拒绝 |
| 修改员工阶段/风险规则 | 允许 | 拒绝 | 拒绝 |
| 确认限流/淘汰观察 | 允许 | 拒绝 | 拒绝 |

- [ ] **Step 2: 使用隔离数据库运行完整验证**

```bash
npm run db:generate
DATABASE_URL=file:/tmp/member-overview-full-unit.db npm test -- --run
CI=1 npm run test:e2e -- --reporter=line
npm run build
git diff --check
git status --short
```

Expected: unit、E2E、build 全部成功；`git status` 只包含本任务明确文件和用户原有未跟踪 `design-qa-assets/`，默认 `prisma/dev.db` 前后哈希一致。

- [ ] **Step 3: 浏览器视觉和流畅性验收**

启动本地服务，用真实管理员、组长、组员账号检查桌面 1440×900 和手机 390×844：

1. 导航切换无整页裸白闪烁；
2. 四页签、筛选、刷新、返回保持条件；
3. 表格不出现横向挤成一团，移动端改卡片；
4. 抽屉焦点、Escape、背景 inert 和关闭后焦点恢复正常；
5. 未定价、未成熟、样本不足、无数据和查询失败是五种不同状态；
6. 金额和百分比与测试夹具手算一致；
7. 风险红色不会用于单纯漏填或样本不足。

- [ ] **Step 4: 做一次 Phase B 统一审查**

审查报告写入 `docs/superpowers/reviews/2026-08-14-member-overview-final-review.md`，只列有证据的问题并按 P0/P1/P2 分类。P0/P1 必须先加回归测试再修复；P2 若不影响安全、口径或核心操作，可明确记录后交用户复审，不进行无止境抛光。

- [ ] **Step 5: 最终提交**

```bash
git add tests/e2e/role-workflow.spec.ts tests/e2e/reports.spec.ts docs/superpowers/reviews/2026-08-14-member-overview-final-review.md
git commit -m "test: verify member overview end to end"
```

如这三个文件没有实际变化，不创建空提交。完成后使用 `superpowers:finishing-a-development-branch` 决定本地合并方式，并向用户提供可直接打开的本地地址和演示账号。

---

## Definition of Done

- [ ] Excel 中需要保留的财务字段已经进入网页录入、历史编辑和分析，不依赖 Excel 公式。
- [ ] 管理员可给每个具体渠道设置唯一固定有效粉单价；待定价不会生成假纯利。
- [ ] 组员和组长只能填写及修改本人数据，服务端越权测试通过。
- [ ] 管理员可维护入职日期、手动阶段、风险阈值、连续天数和样本门槛，修改有审计。
- [ ] “组员数据总览”四个页签可操作，正向排行、转化排行和三类风险不混淆。
- [ ] 渠道校正效率使用同组同渠道其他人员作为基准并排除本人。
- [ ] 连续偏低按合格评价日计算；观察日暂停不重置；培训/观察阶段保护生效。
- [ ] 限流/淘汰必须管理员人工确认，确认不会自动停用人员。
- [ ] 完整 unit、E2E、build、浏览器桌面/手机验收均通过。
