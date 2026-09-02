import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dailySheet = readFileSync(new URL("../components/UnifiedMemberDataSheet.tsx", import.meta.url), "utf8");
const customerTable = readFileSync(new URL("../components/DepartmentCustomerProgress.tsx", import.meta.url), "utf8");
const groupWorkbench = readFileSync(new URL("../components/GroupOperatorWorkbench.tsx", import.meta.url), "utf8");
const expertWorkbench = readFileSync(new URL("../components/ExpertWorkbench.tsx", import.meta.url), "utf8");

test("客户进程保存后会实时刷新日报，不再因统计日未变而丢弃新数据", () => {
  assert.match(dailySheet, /setContext\(next\)/);
  assert.doesNotMatch(dailySheet, /current\.today === next\.today/);
  assert.match(dailySheet, /window\.addEventListener\("customer-data-updated"/);
  assert.match(dailySheet, /window\.addEventListener\("focus"/);
  assert.match(dailySheet, /document\.addEventListener\("visibilitychange"/);
  assert.match(dailySheet, /15_000/);
  assert.ok(dailySheet.includes("刷新进度"));
});

test("进群、注册和开单入口都会通知日报同步", () => {
  assert.match(customerTable, /window\.dispatchEvent\(new Event\("ai-data-updated"\)\)/);
  assert.match(groupWorkbench, /window\.dispatchEvent\(new Event\("customer-data-updated"\)\)/);
  assert.match(expertWorkbench, /window\.dispatchEvent\(new Event\("customer-data-updated"\)\)/);
  assert.match(expertWorkbench, /register/);
  assert.match(expertWorkbench, /\/api\/customer-orders/);
});

test("界面明确说明老客户不受当日添加数限制", () => {
  assert.match(dailySheet, /当天添加为 0 也不影响/);
  for (const label of ["进群", "注册", "开单", "号码自动统计"]) assert.ok(dailySheet.includes(label));
});

test("所有日期都禁止手填号码漏斗，历史数字只读保留", () => {
  assert.match(dailySheet, /const numberEntryLocked = Boolean\(context && !lawyerGroup && mode === "daily"\)/);
  assert.match(dailySheet, /numberEntryLocked && NUMBER_TRACKED_METRIC_KEYS\.has\(metric\.key\)/);
  assert.ok(dailySheet.includes("历史数据只读"));
});
