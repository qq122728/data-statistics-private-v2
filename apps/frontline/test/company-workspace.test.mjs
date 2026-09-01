import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/CompanyWorkspace.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../components/CompanyWorkspace.module.css", import.meta.url), "utf8");
const flowCss = readFileSync(new URL("../components/CompanyOrganizationFlow.module.css", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("../components/WorkspaceShell.module.css", import.meta.url), "utf8");

test("公司工作台导出签名和六个主导航保持稳定", () => {
  assert.match(source, /export default function CompanyWorkspace\(\{ user, onLogout \}/);
  for (const label of ["公司工作台", "数据汇总", "客户进度", "组织管理", "资源管理"]) assert.ok(source.includes(`label="${label}"`));
  assert.ok(source.includes("通知中心"));
});

test("公司范围页面只读取组织网关的真实 API", () => {
  for (const endpoint of ["/api/org/reporting", "/api/org/structure", "/api/org/accounts", "/api/org/department-assets"]) assert.ok(source.includes(endpoint));
  assert.ok(source.includes("<DepartmentPersonnelTransfer />"));
  assert.ok(source.includes("<UnifiedNotificationCenter onUnreadChange={setNotificationUnread} />"));
  assert.ok(source.includes("<NotificationBadge count={notificationUnread} />"));
});

test("公司组织管理按真实对象执行部门、部门管理员、小组和组长流程", () => {
  for (const endpoint of ["/api/org/departments", "/api/org/department-managers", "/api/org/groups", "/api/org/group-leads"]) assert.ok(source.includes(endpoint));
  for (const label of ["先开部门", "再开管理员账号", "请选择本公司已存在的部门", "请选择暂无组长的小组"]) assert.ok(source.includes(label));
  assert.ok(source.includes("countryCode"));
  assert.ok(source.includes("workStartMinutes"));
  assert.ok(source.includes("workEndMinutes"));
  assert.match(flowCss, /@media \(max-width: 760px\)/);
});

test("五个转化率使用统一分母，合计行重新计算", () => {
  assert.match(source, /percent\(row\.totals\.replied, row\.totals\.effective\)/);
  assert.match(source, /percent\(row\.totals\.joined, row\.totals\.effective\)/);
  assert.match(source, /Math\.max\(0, row\.totals\.joined - row\.totals\.leftNormal\)/);
  assert.match(source, /percent\(row\.totals\.registered, row\.totals\.pushed\)/);
  assert.match(source, /percent\(row\.totals\.ordered, row\.totals\.registered\)/);
  assert.match(source, /cells\(\{ name: "合计", people, totals: total \}\)/);
});

test("公司页面沿用新版部门工作台的视觉标准并支持窄屏", () => {
  for (const token of ["WorkspaceShell", "WorkspaceNavButton", "SmartDateRangeToolbar", "AiSmartAssistant", "fresh-sheet-card"]) assert.ok(source.includes(token));
  assert.match(css, /background:#fff;border:1px solid #dfe4ec/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(shellCss, /@media \(max-width: 900px\)/);
});
