import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../components/${name}`, import.meta.url), "utf8");

test("组员工作台使用统一日报、财务、客户和设备入口", () => {
  const source = read("FreshWorkspace.tsx");
  for (const component of ["UnifiedMemberDataSheet", "MemberDailyRecords", "MemberCustomerProgress", "DeviceAccounts"]) {
    assert.match(source, new RegExp(`<${component}`));
  }
  assert.doesNotMatch(source, /<DailyDataWorkbench/);
  assert.doesNotMatch(source, /customerSeed|deviceSeed|historySeed|historicalDailySeeds|localStorage|sessionStorage/);
  assert.match(source, /每天数据怎么填/);
  assert.match(source, /客户表怎么用/);


  assert.match(source, /member-entry-guide--compact/);
  assert.match(source, /展开查看操作说明/);
});

test("组长可以新增渠道且请求固定携带自己的 groupId", () => {
  const workspace = read("FreshWorkspace.tsx");
  const channelPanel = read("ChannelManagementPanel.tsx");
  assert.match(workspace, /isLead \? <button data-active=\{view === "channels"\}/);
  assert.match(workspace, /<ChannelManagementPanel scope="group" groupId=\{user\.groupId\}/);
  assert.match(channelPanel, /\{ groupId, name, channelType \}/);
  assert.match(channelPanel, /只添加到组长自己负责的小组/);
});

test("统一组员表按渠道读取并保存真实每日数据", () => {
  const source = read("UnifiedMemberDataSheet.tsx");
  assert.match(source, /requestJson<Context>\("\/api\/daily-stats"\)/);
  assert.match(source, /method:\s*"POST"/);
  assert.match(source, /position:\s*"RECEPTION"/);
  assert.match(source, /人工无效/);
  assert.match(source, /异常退群率/);
  assert.doesNotMatch(source, /numberTrackingFrom|NUMBER_TRACKED_METRIC_KEYS|客户进度自动统计/);
  for (const label of ["首充 · 银行卡", "首充 · 加密货币", "续充 · 银行卡", "续充 · 加密货币"]) assert.ok(source.includes(label));
  assert.match(source, /return values\.dispatchCount - values\.duplicateCount - values\.lowAmountCount - values\.noWsCount - values\.manualInvalidCount/);
  assert.match(source, /denominator > 0 \? numerator \/ denominator \* 100 : Number\.NaN/);
  assert.match(source, /!Number\.isFinite\(value\).*"—"/);
  assert.doesNotMatch(source, /mode === "finance" \|\| NUMBER_TRACKED_METRIC_KEYS/);
});

test("历史和财务读取真实每日数据接口", () => {
  const source = read("MemberDailyRecords.tsx");
  assert.match(source, /requestJson<Context>\(`\/api\/daily-stats/);
  assert.match(source, /ai-data-updated/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /setInterval\(refreshWhenVisible, 10_000\)/);
  assert.doesNotMatch(source, /aria-label="选择月份"/);
  assert.match(source, /选择日期/);
  assert.match(source, /所选时间汇总/);
  assert.match(source, /sumRows\(rows\)/);
  assert.doesNotMatch(source, /const\s+(?:history|finance|fund).*Seed/i);
});

test("客户进度统一使用真实共享表格", () => {
  const source = read("MemberCustomerProgress.tsx");
  assert.match(source, /<DepartmentCustomerProgress/);
  assert.match(source, /member=\{user\}/);
  assert.match(source, /user\.groupId/);
  assert.doesNotMatch(source, /GroupOperatorWorkbench|ExpertWorkbench|RealReceptionProgress/);
});

test("AI侧栏保留消息记录、上传和确认执行，移除手填日报",()=>{
 const source=read("AiSmartAssistant.tsx");
 assert.match(source,/role="log"/);
 assert.match(source,/\/api\/ai\/chat/);
 assert.match(source,/上传文件/);
 assert.match(source,/确认执行/);
 assert.match(source,/compactChat/);
 assert.doesNotMatch(source,/parseDailyInput|确认保存每日数据|填写 \/ 查询每日数据/);
});
