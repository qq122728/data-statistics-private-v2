import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const team = readFileSync(new URL("../components/TeamManagement.tsx", import.meta.url), "utf8");
const groups = readFileSync(new URL("../components/DepartmentGroupManagement.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../components/FreshWorkspace.tsx", import.meta.url), "utf8");
const analysis = readFileSync(new URL("../components/GroupChannelAnalysis.tsx", import.meta.url), "utf8");
const inspector = readFileSync(new URL("../components/MemberDataInspector.tsx", import.meta.url), "utf8");

test("组员管理只使用真实组员和交接接口", () => {
  assert.match(team, /requestJson<Array<[^]*?>>\("\/api\/lead\/members"\)/);
  assert.ok(team.includes("/api/lead/members/handover"));
  assert.ok(team.includes("setMembers([])"));
  assert.doesNotMatch(team, /initialMembers|演示组长|auditRows/);
});

test("开组与开组长账号是两个独立步骤", () => {
  assert.ok(groups.includes("第一步：开设新组"));
  assert.ok(groups.includes("第二步：开设组长账号"));
  assert.ok(groups.includes('requestJson("/api/org/group-leads"'));
  assert.doesNotMatch(groups, /leadAccount|同时开设首任组长账号|一次建好小组和首任组长账号/);
});

test("组长保留组员能力并拥有汇总、管理、设备和通知入口", () => {
  for (const component of ["UnifiedMemberDataSheet", "MemberDailyRecords", "MemberCustomerProgress", "DeviceAccounts", "GroupChannelAnalysis", "TeamManagement", "UnifiedNotificationCenter"]) {
    assert.match(workspace, new RegExp(`<${component}`));
  }
  assert.match(workspace, /user\.roles\.includes\("LEAD"\)/);
});

test("小组汇总可按归属人员、渠道和日期查看完整指标且保留合计", () => {
  for (const label of ["按归属人员看", "按渠道看", "按日期看", "撞粉", "低金额", "无 WS", "人工无效", "当前在群", "首充", "续充", "出金", "回复率", "进群率", "异常退群率", "注册率", "开单率"]) {
    assert.ok(analysis.includes(label));
  }
  assert.match(analysis, /<tfoot>/);
  assert.match(analysis, /payload\.days/);
});

test("组长检查页识别新版统一组员记录及其资金字段，同时兼容旧记录", () => {
  assert.match(inspector, /unified-member-v1:/);
  assert.match(inspector, /unifiedReceptionMetrics/);
  assert.match(inspector, /entry\.position === "EXPERT" \|\| isUnifiedEntry\(entry\)/);
  for (const label of ["正常退群", "异常退群", "推专家", "注册", "开单", "加密货币首充", "银行卡续充", "出金", "净业绩"]) {
    assert.ok(inspector.includes(label));
  }
});
