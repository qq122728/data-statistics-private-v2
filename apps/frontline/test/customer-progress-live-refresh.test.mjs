import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dailySheet = readFileSync(new URL("../components/UnifiedMemberDataSheet.tsx", import.meta.url), "utf8");
const customerTable = readFileSync(new URL("../components/DepartmentCustomerProgress.tsx", import.meta.url), "utf8");
const groupWorkbench = readFileSync(new URL("../components/GroupOperatorWorkbench.tsx", import.meta.url), "utf8");
const expertWorkbench = readFileSync(new URL("../components/ExpertWorkbench.tsx", import.meta.url), "utf8");

test("客户进程保存后会通知页面刷新，但不会自动改写日报数字", () => {
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

test("界面明确区分公司认账数据与客户进度", () => {
  assert.match(dailySheet, /客户明细金额只作跟踪/);
  assert.doesNotMatch(dailySheet, /号码自动统计|当天添加为 0 也不影响/);
  for (const label of ["进群", "注册", "开单"]) assert.ok(dailySheet.includes(label));
});
