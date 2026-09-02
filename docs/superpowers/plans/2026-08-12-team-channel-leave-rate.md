# 团队与渠道退群率实施计划

> **历史归档，停止执行。** 本文只用于追溯当时的设计或实施过程；涉及资源部确认、手填进群/注册/开单、岗位权限、统计日期或旧前端的内容均不是现行规则。当前口径请看 [当前业务规则](/Users/aaaa/Desktop/数据统计/docs/business/current-business-rules.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在团队表现的小组表、人员表和渠道分析主表中显示并排序退群率。

**Architecture:** 复用现有 `ConversionRates.leaveRate`，只在两个客户端表格组件中增加展示和排序键。排序比较器对 `null` 统一放到有效值之后；不改统计查询和公式。

**Tech Stack:** React 19、TypeScript、Next.js 15、Vitest、React DOM Server

## Global Constraints

- 退群率固定使用 `退群数 ÷ 入群数`。
- 入群数为 0 时显示“分母为 0”。
- 小组、人员、渠道三处主表都显示并支持排序。
- 默认排序、样本排名优先级、权限和筛选保持不变。
- 不引入新依赖，不修改 `calculateConversionRates`。

---

### Task 1: 三种分析行的退群率展示与排序

**Files:**
- Modify: `src/components/analytics/team/TeamPerformanceTable.tsx`
- Modify: `src/components/analytics/channel/ChannelQualityTable.tsx`
- Modify: `tests/unit/management-analysis-details-ui.test.ts`
- Modify: `tests/unit/team-sort-mode.test.ts`

**Interfaces:**
- Consumes: `GroupPerformanceRow.rates.leaveRate`、`MemberPerformanceRow.rates.leaveRate`、`ChannelQualityRow.rates.leaveRate`，类型均为 `number | null`。
- Produces: 三个可访问名称均为“按退群率排序”的表头按钮；单元格使用现有 `percent(number | null)` 格式化。

- [ ] **Step 1: 写失败的展示测试**

在 `management-analysis-details-ui.test.ts` 构造退群率为 `0.25` 的小组、人员和渠道行，断言三份 HTML 均包含 `aria-label="按退群率排序"`、`25.0%`，并断言小组转化列组为 3 列、人员转化列组为 4 列、渠道转化列组为 5 列。

- [ ] **Step 2: 写失败的排序测试**

在 `team-sort-mode.test.ts` 使用现有 React `useState` 测试替身，分别把小组、人员和渠道排序设置为 `{ key: "leaveRate", direction: "ascending" }`。每种表放入 `10%`、`40%`、`null` 三行，逐项断言渲染顺序为低退群率、高退群率、分母为 0。

- [ ] **Step 3: 运行测试并确认 RED**

Run: `npm test -- --run tests/unit/management-analysis-details-ui.test.ts tests/unit/team-sort-mode.test.ts`

Expected: FAIL，因为主表还没有“退群率”表头或 `leaveRate` 排序键。

- [ ] **Step 4: 实现团队表格**

在 `TeamPerformanceTable.tsx`：

```tsx
type SortKey = "activePeople" | "sample" | "groupRate" | "leaveRate" | "registrationRate" | "orderRate" | "orders" | "averageOrders" | "recharge";
```

让小组与人员的值提取函数在 `leaveRate` 时返回 `row.rates.leaveRate`。新增缺失值永远置后的比较函数，并用于小组、人员排序。小组表加入 `sortHeader("leaveRate", "退群率")`，转化列组从 2 调整为 3；人员表加入同一表头，转化列组从 3 调整为 4。行内对应增加 `percent(row.rates.leaveRate)`。

- [ ] **Step 5: 实现渠道表格**

在 `ChannelQualityTable.tsx` 的 `SortKey` 增加 `leaveRate`。新增值提取函数：该键读取 `row.rates.leaveRate`，其他键读取当前顶层指标。比较时 `null` 永远排在有效值之后。表头加入 `sortButton("leaveRate", "退群率")`，转化列组从 4 调整为 5；行内加入 `percent(row.rates.leaveRate)`。

- [ ] **Step 6: 运行聚焦测试并确认 GREEN**

Run: `npm test -- --run tests/unit/management-analysis-details-ui.test.ts tests/unit/team-sort-mode.test.ts tests/unit/metrics.test.ts`

Expected: 3 个测试文件全部通过。

- [ ] **Step 7: 浏览器验证**

在管理员登录状态下打开 `/team-performance`，验证小组表有退群率；点击小组验证人员表有退群率；打开 `/channel-analysis` 验证渠道表有退群率。点击三处表头，确认排序方向可以切换且控制台无新错误。

- [ ] **Step 8: 完整验证**

Run: `npm test -- --run`

Expected: 全部单元测试通过。

Run: `npm run build`

Expected: 生产构建退出码为 0。

Run: `git diff --check`

Expected: 无空白错误。

- [ ] **Step 9: 提交并合并**

```bash
git add src/components/analytics/team/TeamPerformanceTable.tsx src/components/analytics/channel/ChannelQualityTable.tsx tests/unit/management-analysis-details-ui.test.ts tests/unit/team-sort-mode.test.ts
git commit -m "feat: add leave rate to analysis tables"
```

验证合并后的 `main` 后清理隔离工作区。
