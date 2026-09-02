import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const company = readFileSync(new URL("../components/CompanyWorkspace.tsx", import.meta.url), "utf8");
const department = readFileSync(new URL("../components/DepartmentWorkspace.tsx", import.meta.url), "utf8");
const groups = readFileSync(new URL("../components/DepartmentGroupManagement.tsx", import.meta.url), "utf8");
const customers = readFileSync(new URL("../components/DepartmentCustomerProgress.tsx", import.meta.url), "utf8");
const transfer = readFileSync(new URL("../components/DepartmentPersonnelTransfer.tsx", import.meta.url), "utf8");
const devices = readFileSync(new URL("../components/DepartmentDeviceAccounts.tsx", import.meta.url), "utf8");
const departmentCss = readFileSync(new URL("../app/department.css", import.meta.url), "utf8");

test("公司与部门开组都严格执行先建组、再开组长账号", () => {
  for (const source of [company, groups]) {
    assert.match(source, /requestJson\("\/api\/org\/groups"/);
    assert.match(source, /requestJson\("\/api\/org\/group-leads"/);
    assert.doesNotMatch(source, /leadAccount/);
  }
  assert.match(company, /JSON\.stringify\(\{ departmentId, name:/);
  assert.match(groups, /JSON\.stringify\(\{ departmentId: department\.id, name, groupType \}\)/);
  assert.match(groups, /第一步：开设新组/);
  assert.match(groups, /第二步：开设组长账号/);
});

test("公司与部门汇总覆盖各维度、全漏斗并保留表底合计", () => {
  for (const source of [company, department]) {
    for (const label of ["按归属个人", "按渠道", "按日期", "撞粉", "低金额", "人工无效", "进群率", "异常退群率", "注册率", "开单率", "首充", "续充", "出金", "净业绩", "合计"]) {
      assert.ok(source.includes(label), `${label} should be present`);
    }
  }
  assert.match(department, /个人归属数据汇总（每人一行）/);
  assert.match(company, /个人归属数据汇总（每人一行）/);
  assert.match(department, /department-total-row/);
  assert.match(company, /className=\{styles\.total\}/);
});

test("管理员客户进度是统一只读共享表", () => {
  assert.match(customers, /客户协作进度/);
  assert.match(customers, /仅显示你接粉或参与炒群、专家的客户/);
  assert.match(customers, /\{canCreateInView \? \([^]*新增进群客户/);
  assert.match(customers, /\/api\/lead\/customer-reporting/);
  assert.match(customers, /canEditGroupStage/);
  assert.match(customers, /canEditExpertStage/);
  assert.match(customers, /归属纠错/);
  assert.match(customers, /只有绑定小组的一线账号有入口，组织管理员保持只读/);
  assert.match(customers, /payload\?\.receptionOptions\.length/);
  assert.match(customers, /payload\.operatorOptions\.length/);
  assert.doesNotMatch(customers, /action: "setOwner"/);
  assert.doesNotMatch(customers, /action: "setChannel"/);
  assert.doesNotMatch(customers, /action: "setSourceDate"/);
});

test("人员跨组只搬当前工作对象，历史归属不变", () => {
  for (const label of ["在办客户", "实体设备", "聊天账号", "历史客户与历史业绩不搬家", "历史客户和历史业绩继续归原小组"]) {
    assert.ok(transfer.includes(label));
  }
  assert.match(transfer, /return \{ mode, userId:/);
});

test("设备筛选和分页签具备可访问语义，管理员弹窗主操作可见", () => {
  assert.match(devices, /aria-label="筛选设备所属小组"/);
  assert.match(devices, /aria-pressed=\{tab === "devices"\}/);
  assert.match(devices, /aria-pressed=\{tab === "accounts"\}/);
  assert.match(departmentCss, /\.department-modal footer>\.fresh-primary\{[^}]*background:#1a73e8;[^}]*color:#fff/);
});
