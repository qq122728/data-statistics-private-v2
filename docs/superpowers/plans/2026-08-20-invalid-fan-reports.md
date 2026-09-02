# 无效粉人工填报与组长审核 Implementation Plan

> **历史归档，停止执行。** 本文只用于追溯当时的设计或实施过程；涉及资源部确认、手填进群/注册/开单、岗位权限、统计日期或旧前端的内容均不是现行规则。当前口径请看 [当前业务规则](/Users/aaaa/Desktop/数据统计/docs/business/current-business-rules.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让无 WS、小金额、撞粉以人工数量登记并由组长审核后进入正式报表，而不是创建无效客户。

**Architecture:** 新建独立的无效粉报告与审计模型；客户导入只创建有效客户。报告聚合集中在一个服务中，页面、榜单、资源数据和导出都调用同一口径。写入接口以角色和小组为边界，并在事务内记录审计。

**Tech Stack:** Next.js App Router、TypeScript、Prisma（SQLite/ PostgreSQL）、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-08-20-invalid-fan-reports-design.md`

## Global Constraints

- 新无效粉不得创建 `LeadCustomer`、`LeadException` 或自动正式撞粉事件。
- 只有 `APPROVED` 报告进入正式数据；修正、退回、补录原因必填。
- 接粉员只能操作本人待审核记录；组长只能操作本组记录。
- 历史无效客户和历史指标必须保留且不与新报告重复计数。
- SQLite 与 PostgreSQL schema、迁移、Prisma client 必须同步。

---

### Task 1: 数据模型、迁移与审计类型

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/postgres/schema.prisma`
- Create: `prisma/migrations/20260820210000_add_invalid_fan_reports/migration.sql`
- Create: `prisma/postgres/migrations/20260820210000_add_invalid_fan_reports/migration.sql`
- Test: `tests/unit/invalid-fan-reports.test.ts`

**Interfaces:**
- Produces `InvalidFanReport`、`InvalidFanReportAudit`、`InvalidFanReportStatus` 与 `InvalidFanReportAction`。

- [ ] **Step 1: 写失败测试**：断言最终计数只接受三个非负整数，且批准前无正式数量。
- [ ] **Step 2: 运行 `npx vitest run tests/unit/invalid-fan-reports.test.ts`，确认失败。**
- [ ] **Step 3: 增加报告与审计 schema、双数据库迁移和最小的领域类型。**
- [ ] **Step 4: 重新生成 SQLite Prisma client，运行单元测试确认通过。**

### Task 2: 写入服务与权限 API

**Files:**
- Create: `src/lib/invalid-fan-reports.ts`
- Create: `src/app/api/invalid-fan-reports/route.ts`
- Create: `src/app/api/invalid-fan-reports/[reportId]/route.ts`
- Modify: `src/lib/permissions.ts`
- Test: `tests/unit/invalid-fan-report-api.test.ts`

**Interfaces:**
- Consumes Task 1 模型。
- Produces `createInvalidFanReport`、`updateInvalidFanReport`、`reviewInvalidFanReport` 和 `getApprovedInvalidFanTotals`。

- [ ] **Step 1: 写失败 API 权限测试**：接粉员不能改别人/已审核；组长不能审核跨组；退回与修正缺原因返回 400。
- [ ] **Step 2: 运行 `npx vitest run tests/unit/invalid-fan-report-api.test.ts`，确认失败。**
- [ ] **Step 3: 用单一事务写报告、最终数值与审计；为组长补录创建已确认报告。**
- [ ] **Step 4: 运行 API 与领域单元测试确认通过。**

### Task 3: 导入流程只创建有效客户

**Files:**
- Modify: `src/app/api/leads/route.ts`
- Modify: `src/components/entry/EntryReceptionPanels.tsx`
- Modify: `src/components/entry/EntryTabs.tsx`
- Test: `tests/unit/reception-classification.test.ts`
- Test: `tests/e2e/data-entry.spec.ts`

**Interfaces:**
- Consumes Task 2 的报告 API。
- Produces有效客户导入和人工无效粉登记两个独立入口。

- [ ] **Step 1: 写失败测试**：低金额客户、无 WS、重复号码不会创建客户或自动增加正式无效指标。
- [ ] **Step 2: 运行相关单元与 E2E 测试，确认失败。**
- [ ] **Step 3: 移除导入时自动创建低金额/无效客户与自动正式重粉计数；重复只返回提示。**
- [ ] **Step 4: 新增无效粉登记卡片和本人待审核列表。**
- [ ] **Step 5: 运行导入测试确认通过。**

### Task 4: 组长审核与无效数据查看界面

**Files:**
- Modify: `src/app/(app)/entry/page.tsx`
- Modify: `src/components/entry/EntryTabs.tsx`
- Modify: `src/components/entry/EntryReceptionPanels.tsx`
- Create: `src/components/entry/InvalidFanReviewPanel.tsx`
- Test: `tests/unit/invalid-fan-report-ui.test.ts`

**Interfaces:**
- Consumes Task 2 的报告列表与审核 API。
- Produces接粉员登记卡片、组长审核清单、历史无效数据与新填报的分区展示。

- [ ] **Step 1: 写失败组件测试**：待审核不显示在正式汇总；组长可看到审核按钮和原因输入；接粉员不可见审核按钮。
- [ ] **Step 2: 运行 `npx vitest run tests/unit/invalid-fan-report-ui.test.ts`，确认失败。**
- [ ] **Step 3: 按角色渲染登记、审核、补录和审计历史；把“无效库”文案更新为“无效数据”。**
- [ ] **Step 4: 运行组件测试确认通过。**

### Task 5: 统一统计和 Excel 导出

**Files:**
- Modify: `src/lib/analytics/channel-analysis.ts`
- Modify: `src/lib/analytics/resource-workspace.ts`
- Modify: `src/lib/analytics/role-rankings.ts`
- Modify: `src/lib/analytics/team-performance.ts`
- Modify: `src/lib/analytics/member-daily-detail.ts`
- Modify: `src/lib/member-performance-xlsx.ts`
- Test: `tests/unit/invalid-fan-report-metrics.test.ts`

**Interfaces:**
- Consumes Task 2 的 `getApprovedInvalidFanTotals`。
- Produces所有统计场景的统一字段：`lowAmount`、`noWs`、`collision`、`invalidTotal`、`added`、`effective`。

- [ ] **Step 1: 写失败测试**：待审核不计入；批准后加入添加数据和分类；页面与 Excel 数字一致。
- [ ] **Step 2: 运行 `npx vitest run tests/unit/invalid-fan-report-metrics.test.ts`，确认失败。**
- [ ] **Step 3: 用集中聚合替换分散的无效粉计算，保留历史事件兼容分支。**
- [ ] **Step 4: 运行指标和 Excel 相关单元测试确认通过。**

### Task 6: 端到端验证与本地迁移

**Files:**
- Modify: `tests/e2e/current-release-smoke.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: 写 E2E 场景**：接粉员登记 → 不进入正式统计 → 组长审核 → 三分类进入本组统计且不出现客户工作流。
- [ ] **Step 2: 运行 E2E，确认新增场景先失败。**
- [ ] **Step 3: 完成应用迁移并执行 `npm run db:migrate && npm run db:generate:sqlite`。**
- [ ] **Step 4: 运行相关 Vitest、E2E、`npm run build` 与 `git diff --check`。**
