import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const dailySheet = read("../components/UnifiedMemberDataSheet.tsx");
const customerTable = read("../../../packages/customer-sheet/CustomerSheet.tsx");

test("客户表调用独立客户接口，保存后通知相关页面刷新", () => {
 assert.match(customerTable, /\/api\/customer-sheet/);
 assert.doesNotMatch(customerTable, /\/api\/(?:daily-stats|customer-orders|customer-finance|lead\/customer-reporting)/);
 assert.match(customerTable, /dispatchEvent\(new Event\("ai-data-updated"\)\)/);
});
test("日报保留主动刷新且不订阅客户进度事件", () => {
 assert.match(dailySheet, /刷新进度/);
 assert.doesNotMatch(dailySheet, /addEventListener\("customer-data-updated"/);
 assert.match(dailySheet, /addEventListener\("ai-data-updated"/);
});
test("客户表后台刷新避开正在编辑或保存的内容", () => {
 assert.match(customerTable, /if\(!paused.current\)void load\(\)/);
 assert.match(customerTable, /paused.current=findOpen\|\|busy\|\|cellSaves>0\|\|addingRow\|\|!!editing/);
 assert.match(customerTable, /requestId===sequence.current/);
});
test("历史日报可编辑并沿用自动保存与版本保护", () => {
 assert.doesNotMatch(dailySheet, /numberEntryLocked|NUMBER_TRACKED_METRIC_KEYS|历史数字只读/);
 assert.match(dailySheet, /<DailyNumberInput/);
 assert.match(dailySheet, /expectedRevisionId/);
 assert.match(dailySheet, /自动保存/);
});
