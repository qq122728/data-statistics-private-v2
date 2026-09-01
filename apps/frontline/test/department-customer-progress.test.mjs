import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../components/DepartmentCustomerProgress.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../components/DepartmentCustomerProgress.module.css", import.meta.url), "utf8");
const legacy = readFileSync(new URL("../components/LegacyCustomerImport.tsx", import.meta.url), "utf8");

test("客户进度恢复截图中的简洁共享表格结构", () => {
  assert.match(component, /组内共享客户进度/);
  assert.match(component, /实时共享/);
  assert.match(component, /搜索号码、组员、渠道或进度/);
  assert.match(component, /全部进度/);
  assert.match(component, /"已注册"/);
  assert.match(component, /if \(customer\.registeredOn\) return "已注册"/);
  assert.match(component, /aria-label="按客户状态筛选"/);
  assert.match(component, /aria-pressed=\{progress === item\}/);
  assert.doesNotMatch(component, /<select aria-label="进度筛选"/);
  assert.doesNotMatch(component, /className=\{styles\.summary\}/);
  assert.doesNotMatch(component, /shared-sheet__detail/);
});

test("共享表完整保留已进群客户业务字段", () => {
  for (const field of ["进群日期（自动）", "客户号码", "归属组员", "来源渠道", "炒群负责人", "设备号", "群内天数", "炒群情况", "退群类型", "退群日期（自动）", "专家负责人", "专家情况", "注册", "注册日期", "首充", "续充", "出金", "净业绩", "最后修改"]) {
    assert.match(component, new RegExp(field));
  }
  assert.match(component, /<th>注册<\/th><th>注册日期<\/th>/);
  assert.match(component, /customer\.registeredOn \? "已注册" : "未注册"/);
});

test("组员和组长都能新增已进群客户", () => {
  assert.match(component, /\{member \? <button[^]*新增已进群客户/);
  assert.match(component, /requestJson\("\/api\/lead\/customer-reporting", \{ method: "POST"/);
  assert.match(component, /新客户号码/);
  assert.match(component, /maxLength=\{6\}/);
  assert.match(component, /replace\(\/\\D\/g, ""\)\.slice\(-6\)/);
  assert.match(component, /自动保留后 6 位/);
  assert.doesNotMatch(component, /<form className=\{styles\.modal\}/);
});

test("共享表向同组成员开放全部业务列并逐笔登记资金", () => {
  assert.match(component, /const canEdit = Boolean\(member\)/);
  assert.doesNotMatch(component, /const canOwner|const canOperator|const canExpert/);
  for (const action of ["assignGroupOperator", "setDeviceCode", "assignExpert", "setRegistration", "setLeave"]) assert.match(component, new RegExp(action));
  assert.match(component, /placeholder="手动填写"/);
  assert.doesNotMatch(component, /deviceOptions/);
  assert.match(component, /\/api\/customer-orders/);
  assert.match(component, /\/api\/customer-finance/);
  assert.match(component, /\+ 确认本次续充/);
  assert.match(component, /financeEvents/);
});

test("炒群和专家单元格双击编辑并自动保存", () => {
  assert.match(component, /onDoubleClick=\{\(\) => setEditing\(true\)\}/);
  assert.match(component, /updateGroupProgress/);
  assert.match(component, /updateExpertDetails/);
  assert.match(component, /已自动保存/);
  assert.match(component, /每次修改都记录账号和时间/);
});

test("表格视觉匹配目标截图的紧凑大表", () => {
  assert.match(css, /\.sheetCard\{[^}]*height:calc\(100vh - 164px\)/);
  assert.match(css, /\.table\{[^}]*min-width:2240px/);
  assert.match(css, /\.dayCell\{[^}]*background:#edf8f1/);
  assert.match(css, /\.progressCell\{[^}]*width:240px/);
});

test("客户进度提供独立的老客户自由填写共享表", () => {
  assert.match(component, /老客户导入/);
  assert.match(component, /LegacyCustomerImport/);
  assert.match(legacy, /添加一行/);
  for (const field of ["进群日期", "客户号码", "归属组员", "来源渠道", "炒群负责人", "设备号", "群内天数", "炒群情况", "退群类型", "退群日期（自动）", "专家负责人", "专家情况", "注册日期", "首充", "续充", "出金", "净业绩"]) {
    assert.match(legacy, new RegExp(field));
  }
  assert.match(legacy, /<select aria-label="来源渠道"/);
  assert.match(legacy, /channelOptions\.map/);
  assert.equal((legacy.match(/<select/g) ?? []).length, 1);
  assert.match(legacy, /\/api\/legacy-customer-rows/);
  assert.match(legacy, /onBlur=\{\(\) => void finish\(\)\}/);
  assert.match(legacy, /initialDepositCents \+ row\.rechargeCents - row\.withdrawalCents|netPerformanceCents/);
});
