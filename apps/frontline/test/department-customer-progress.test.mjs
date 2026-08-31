import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../components/DepartmentCustomerProgress.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../components/DepartmentCustomerProgress.module.css", import.meta.url), "utf8");

test("客户进度恢复截图中的简洁共享表格结构", () => {
  assert.match(component, /组内共享客户进度/);
  assert.match(component, /实时共享/);
  assert.match(component, /搜索号码、组员、渠道或进度/);
  assert.match(component, /全部进度/);
  assert.doesNotMatch(component, /className=\{styles\.summary\}/);
  assert.doesNotMatch(component, /shared-sheet__detail/);
});

test("共享表完整保留已进群客户业务字段", () => {
  for (const field of ["进群日期（自动）", "客户号码", "归属组员", "来源渠道", "炒群负责人", "设备号", "群内天数", "炒群情况", "退群类型", "退群日期（自动）", "专家负责人", "专家情况", "注册日期", "首充", "续充", "出金", "净业绩", "最后修改"]) {
    assert.match(component, new RegExp(field));
  }
});

test("组员和组长都能新增已进群客户", () => {
  assert.match(component, /\{member \? <button[^]*新增已进群客户/);
  assert.match(component, /requestJson\("\/api\/lead\/customer-reporting", \{ method: "POST"/);
  for (const field of ["客户号码", "客户姓名", "来源渠道", "归属组员", "进群日期", "设备号"]) assert.match(component, new RegExp(field));
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
  assert.match(css, /\.table\{[^}]*min-width:2160px/);
  assert.match(css, /\.dayCell\{[^}]*background:#edf8f1/);
  assert.match(css, /\.progressCell\{[^}]*width:240px/);
});
