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
});

test("统一组员表按渠道读取并保存真实每日数据", () => {
  const source = read("UnifiedMemberDataSheet.tsx");
  assert.match(source, /requestJson<Context>\("\/api\/daily-stats"\)/);
  assert.match(source, /method:\s*"POST"/);
  assert.match(source, /position:\s*"RECEPTION"/);
  assert.match(source, /人工无效/);
  assert.match(source, /异常退群率/);
});

test("历史和财务读取真实每日数据接口", () => {
  const source = read("MemberDailyRecords.tsx");
  assert.match(source, /requestJson<Context>\(`\/api\/daily-stats/);
  assert.doesNotMatch(source, /const\s+(?:history|finance|fund).*Seed/i);
});

test("客户进度统一使用真实共享表格", () => {
  const source = read("MemberCustomerProgress.tsx");
  assert.match(source, /<DepartmentCustomerProgress/);
  assert.match(source, /member=\{user\}/);
  assert.match(source, /user\.groupId/);
  assert.doesNotMatch(source, /GroupOperatorWorkbench|ExpertWorkbench|RealReceptionProgress/);
});

test("组员AI使用右侧对话抽屉和快捷入口，但暂不连接业务写入", () => {
  const source = read("AiSmartAssistant.tsx");
  assert.match(source, /AI 对话内容/);
  assert.match(source, /AI 对话输入框/);
  assert.match(source, /添加今日数据/);
  assert.match(source, /更新客户进度/);
  assert.match(source, /收起 AI 助手/);
  assert.match(source, /disabled/);
  assert.doesNotMatch(source, /requestJson|\/api\//);
});
