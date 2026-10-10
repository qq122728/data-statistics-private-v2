import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const team = readFileSync(new URL("../components/TeamManagement.tsx", import.meta.url), "utf8");
const groups = readFileSync(new URL("../components/DepartmentGroupManagement.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../components/FreshWorkspace.tsx", import.meta.url), "utf8");
const analysis = readFileSync(new URL("../components/GroupChannelAnalysis.tsx", import.meta.url), "utf8");
const inspector = readFileSync(new URL("../components/MemberDataInspector.tsx", import.meta.url), "utf8");
const channelReportingRoute = readFileSync(new URL("../../../src/app/api/lead/channel-reporting/route.ts", import.meta.url), "utf8");

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

test("小组汇总按人员渠道日期共用矩阵，保留合计与独立比率区", () => {
 const matrix=readFileSync(new URL("../components/MetricMatrixTable.tsx",import.meta.url),"utf8");
 assert.match(analysis, /<MetricMatrixTable/);
 assert.match(analysis, /payload.days/);
 for(const label of ["按组员","按渠道","按日期","合计","当前在群","首充","续充","出金","回复率","进群率","异常退群率","注册率","开单率"]) assert.ok(matrix.includes(label),label);
});

test("渠道智能分析不会把存量客户当天进群或开单误报为异常", () => {
  assert.doesNotMatch(channelReportingRoute, /joined\s*>\s*row\.totals\.effective/);
  assert.doesNotMatch(channelReportingRoute, /ordered\s*>\s*row\.totals\.registered/);
  assert.doesNotMatch(channelReportingRoute, /存在数据口径异常/);
});

test("组长检查页完整提供四类首续充资金纠正，不漏银行卡", () => {
 assert.match(inspector,/unified-member-v1:/);
 for(const field of ["bankInitialDepositCents","cryptoInitialDepositCents","bankRechargeCents","cryptoRechargeCents"]) {
  assert.match(inspector,new RegExp(`field: "${field}", label: "[^"\n]+", editable: true, money: true`));
 }
 for(const label of ["首充 · 银行卡","首充 · 加密货币","续充 · 银行卡","续充 · 加密货币"]) assert.ok(inspector.includes(label));
});

test("小组日报只保留文字和 Excel，并由组长手动推送", () => {
  assert.ok(analysis.includes("文字和 Excel 推送到 Telegram"));
  assert.doesNotMatch(analysis, /下载日报图片|format=png|ImageSquare/);
  assert.ok(analysis.includes("系统不会自动发送"));
});
