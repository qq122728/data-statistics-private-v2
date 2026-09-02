import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../components/DepartmentCustomerProgress.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../components/DepartmentCustomerProgress.module.css", import.meta.url), "utf8");
const legacy = readFileSync(new URL("../components/LegacyCustomerImport.tsx", import.meta.url), "utf8");
const customerPatch = readFileSync(new URL("../../../src/app/api/lead/customer-reporting/[leadId]/route.ts", import.meta.url), "utf8");

test("客户进度恢复截图中的简洁共享表格结构", () => {
  assert.match(component, /组内共享客户进度/);
  assert.match(component, /实时共享/);
  assert.match(component, /搜索号码、G\/E\/R\/O\/L 编号、组员或进度/);
  assert.match(component, /全部进度/);
  assert.match(component, /"已注册"/);
  assert.match(component, /if \(customer\.registeredOn\) return "已注册"/);
  assert.match(component, /aria-label="客户状态筛选"/);
  assert.match(component, /className=\{styles\.viewControls\}/);
  assert.match(component, /进度状态/);
  assert.match(component, /aria-label="归属组员筛选"/);
  assert.match(component, /aria-label="来源渠道筛选"/);
  assert.match(component, /aria-label="客户跟进入口"/);
  assert.match(component, /在群待推专家/);
  assert.match(component, /专家进度/);
  assert.match(component, /stage: viewMode === "group" \? "pending-expert" : "expert"/);
  assert.match(component, /!customer\.expertIntroducedOn/);
  assert.match(component, /setMemberFilter/);
  assert.match(component, /setChannelFilter/);
  assert.doesNotMatch(component, /className=\{styles\.summary\}/);
  assert.doesNotMatch(component, /shared-sheet__detail/);
});

test("五个客户阶段使用按日编号并支持编号搜索", () => {
  assert.match(component, /groupQueueNumber/);
  assert.match(component, /expertQueueNumber/);
  for (const prefix of ["G", "E", "R", "O", "L"]) assert.ok(component.includes(`queueNumber("${prefix}"`));
  assert.match(component, /registrationQueueNumber/);
  assert.match(component, /orderQueueNumber/);
  assert.match(component, /leaveQueueNumber/);
  assert.match(component, /params\.set\("q", query\.trim\(\)\)/);
  assert.match(component, /编号 \/ 接粉 \/ 进群/);
  assert.match(css, /\.queueBadge/);
});

test("共享表完整保留已进群客户业务字段", () => {
  for (const field of ["客户日期", "客户信息", "客户归属", "群维护", "设备号", "群内天数", "炒群情况", "退群信息", "专家负责人", "专家情况", "注册信息", "首充", "续充", "出金", "净业绩", "最后修改"]) {
    assert.match(component, new RegExp(field));
  }
  assert.ok(component.includes("注册信息"));
  assert.ok(component.includes("状态 / 日期"));
  assert.ok(component.includes('"已注册"') && component.includes('"未注册"'));
  assert.ok(component.includes("号码 / 姓名 / 平台 / 金额"));
  assert.match(component, /action: "setCustomerName"/);
  for (const action of ["setCustomerName", "setCustomerPlatform", "setLossAmount"]) assert.match(customerPatch, new RegExp(action));
});

test("组员和组长都能新增进群客户", () => {
  assert.match(component, /member\s*\?/);
  assert.match(component, /新增进群客户/);
  assert.ok(component.includes('requestJson("/api/lead/customer-reporting"'));
  assert.match(component, /新客户号码/);
  assert.match(component, /maxLength=\{6\}/);
  assert.ok(component.includes(".slice(-6)"));
  assert.match(component, /placeholder="号码后 6 位"/);
  assert.match(component, /新客户接粉日期/);
  assert.match(component, /新客户进群日期/);
  assert.ok(component.includes("sourceDate: localToday()"));
  assert.match(component, /expertIntroducedOn: viewMode === "expert" \? today : ""/);
  assert.match(component, /const \{ expertOwnerId, expertIntroducedOn, \.\.\.groupDraft \} = draft/);
  assert.match(component, /\.\.\.groupDraft/);
  assert.doesNotMatch(component, /<form className=\{styles\.modal\}/);
});

test("专家可以在专家进度直接新增一行并确认实际推专家日期", () => {
  assert.match(component, /新增专家客户/);
  assert.match(component, /canCreateInView/);
  assert.match(component, /aria-label="新增客户专家负责人"/);
  assert.match(component, /aria-label="新增客户推专家日期"/);
  assert.match(component, /const \{ expertOwnerId, expertIntroducedOn, \.\.\.groupDraft \} = draft/);
  assert.match(component, /\? \{\s*expertOwnerId,\s*expertIntroducedOn,/);
});

test("共享表开放接粉和炒群列，专家列需要专家权限", () => {
  assert.match(component, /const canEdit = Boolean\(member\)/);
  assert.match(component, /const canEditExpert = Boolean/);
  assert.match(component, /需专家权限才能编辑/);
  assert.doesNotMatch(component, /const canOwner|const canOperator|const canExpert/);
  for (const action of ["setSourceDate", "setJoinedOn", "assignGroupOperator", "setDeviceCode", "assignExpert", "setRegistration", "setLeave"]) assert.match(component, new RegExp(action));
  assert.match(component, /撤销退群/);
  assert.match(component, /退群日期已纠正/);
  assert.match(component, /aria-label="推专家日期"/);
  assert.match(component, /专家负责人和推专家日期已保存/);
  assert.match(component, /推专家日期已纠正/);
  assert.match(customerPatch, /input\.occurredOn \?\? lead\.expertIntroducedOn \?\? today/);
  assert.match(customerPatch, /moveCustomerExpertIntroductionDate/);
  assert.match(customerPatch, /leaveType:\s*z\.enum\(\["NORMAL", "ABNORMAL", "NONE"\]\)/);
  assert.match(customerPatch, /delta:\s*-1/);
  assert.match(component, /placeholder="手动填写"/);
  assert.doesNotMatch(component, /deviceOptions/);
  assert.match(component, /\/api\/customer-orders/);
  assert.match(component, /\/api\/customer-finance/);
  assert.match(component, /\+ 确认本次续充/);
  assert.match(component, /financeEvents/);
  assert.match(customerPatch, /hasAssignedRole\(actor, "EXPERT"\)/);
});

test("炒群和专家单元格双击编辑并自动保存", () => {
  assert.match(component, /onDoubleClick=\{\(\) => setEditing\(true\)\}/);
  assert.match(component, /updateGroupProgress/);
  assert.match(component, /updateExpertDetails/);
  assert.match(component, /已自动保存/);
  assert.match(component, /自动保存并记录操作人/);
});

test("表格视觉使用双层信息和清晰的冻结列", () => {
  assert.match(css, /\.sheetCard\s*\{[^}]*max-height:\s*calc\(100vh - 142px\)/);
  assert.match(css, /\.filterField\s*\{/);
  assert.match(css, /\.table\[data-view="group"\]\s*\{\s*min-width:\s*1260px/);
  assert.match(css, /\.table\[data-view="expert"\]\s*\{\s*min-width:\s*1510px/);
  assert.match(css, /\.viewTabs button\[data-active="true"\]/);
  assert.match(css, /\.dayCell\s*\{[^}]*background:\s*#edf8f1/);
  assert.match(css, /\.progressCell\s*\{[^}]*width:\s*230px/);
  assert.match(css, /\.stackedCell\s*\{[^}]*display:\s*grid;[^}]*gap:\s*5px/);
  assert.match(css, /\.table th:nth-child\(2\),\s*\.table td:nth-child\(2\)\s*\{[^}]*position:\s*sticky/);
  assert.match(css, /\.table th\s*\{\s*text-align:\s*center/);
  assert.match(css, /\.table th,\s*\.table td\s*\{\s*height:\s*126px/);
});

test("客户进度提供接粉日期分离且接入统计的老客户入口", () => {
  assert.match(component, /老客户导入/);
  assert.match(component, /LegacyCustomerImport/);
  for (const field of ["接粉日期", "客户号码后 6 位", "检查号码", "来源渠道", "接粉归属", "设备号", "进群（开始炒群）日期", "炒群负责人", "专家负责人", "推专家日期", "注册日期", "开单日期", "启用前最后状态", "实际发生日期", "首充金额", "续充金额", "出金金额"]) {
    assert.match(legacy, new RegExp(field));
  }
  for (const scenario of ["老粉今天进群", "老粉今天开单", "已开单老粉今天续充"]) assert.match(legacy, new RegExp(scenario));
  assert.match(legacy, /\/api\/legacy-customers/);
  assert.match(legacy, /sourceDate: draft\.sourceDate/);
  assert.match(legacy, /号码已存在时只更新原客户/);
  assert.match(legacy, /历史阶段只建档，不重复增加统计/);
  assert.match(legacy, /\/api\/legacy-customers\?phone=/);
  assert.match(legacy, /canImportExpertStage/);
});
