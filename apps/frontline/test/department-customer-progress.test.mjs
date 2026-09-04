import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../components/DepartmentCustomerProgress.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../components/DepartmentCustomerProgress.module.css", import.meta.url), "utf8");
const customerPatch = readFileSync(new URL("../../../src/app/api/lead/customer-reporting/[leadId]/route.ts", import.meta.url), "utf8");
const attributionCorrection = readFileSync(new URL("../../../src/app/api/lead/customer-reporting/[leadId]/attribution-correction/route.ts", import.meta.url), "utf8");

test("客户进度恢复截图中的简洁共享表格结构", () => {
  assert.match(component, /客户协作进度/);
  assert.match(component, /仅显示你接粉或参与炒群、专家的客户/);
  assert.match(component, /实时共享/);
  assert.match(component, /搜索号码、G\/E\/R\/O\/L 编号、组员或进度/);
  assert.match(component, /全部进度/);
  assert.match(component, /全部月份/);
  assert.match(component, /month \? "整月" : "全部日期"/);
  assert.match(component, /disabled=\{!month\}/);
  assert.match(component, /"已注册"/);
  assert.match(component, /if \(customer\.registeredOn\) return "已注册"/);
  assert.match(component, /aria-label="进度状态筛选"/);
  assert.match(component, /className=\{styles\.viewControls\}/);
  assert.match(component, /进度状态/);
  assert.match(component, /aria-label="归属组员筛选"/);
  assert.match(component, /aria-label="来源渠道筛选"/);
  assert.match(component, /aria-label="客户跟进入口"/);
  assert.match(component, /炒群进度/);
  assert.match(component, /专家进度/);
  assert.match(component, /stage: viewMode === "group" \? "pending-expert" : "expert"/);
  assert.match(component, /!customer\.expertIntroducedOn/);
  assert.match(component, /setMemberFilter/);
  assert.match(component, /setChannelFilter/);
  assert.match(component, /params\.set\("memberId", memberFilter\)/);
  assert.match(component, /params\.set\("channel", channelFilter\)/);
  assert.match(component, /当前显示第/);
  assert.match(component, /表格右侧可上下滚动查看更多/);
  assert.match(css, /overflow-y:\s*scroll/);
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
  assert.match(component, /params\.set\("q", exactPhoneQuery \|\| query\.trim\(\)\)/);
  assert.match(component, /编号 \/ 接粉 \/ 进群/);
  assert.match(css, /\.queueBadge/);
});

test("共享表完整保留已进群客户业务字段", () => {
  assert.match(component, /const \[compactView, setCompactView\] = useState\(false\)/);
  for (const field of ["客户日期", "客户信息", "客户归属", "群维护", "设备号", "群内天数", "炒群情况", "退群信息", "专家负责人", "专家情况", "注册信息", "开单 / 首充", "续充", "出金", "净业绩", "最后修改"]) {
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
  assert.ok(component.includes('>("/api/lead/customer-reporting"'));
  assert.match(component, /新客户号码/);
  assert.match(component, /maxLength=\{6\}/);
  assert.ok(component.includes(".slice(-6)"));
  assert.match(component, /placeholder="号码后 6 位"/);
  assert.match(component, /新客户接粉日期/);
  assert.match(component, /新客户进群日期/);
  assert.ok(component.includes("sourceDate: localToday()"));
  assert.match(component, /expertIntroducedOn: mode === "expert-recovery" \? today : ""/);
  assert.match(component, /expertDeviceAccountNumber,/);
  assert.match(component, /\.\.\.groupDraft/);
  assert.doesNotMatch(component, /<form className=\{styles\.modal\}/);
  assert.match(component, /payload\?\.receptionOptions\.length/);
  assert.match(component, /payload\.operatorOptions\.length/);
  assert.match(component, /payload\?\.receptionOptions\.map/);
  assert.match(component, /payload\?\.operatorOptions\.map/);
});

test("历史客户恢复后回到全部时间并立即显示", () => {
  assert.match(component, /setAdding\(false\);\s*setPage\(1\);\s*setProgress\("全部进度"\);\s*\/\/[^]*setMonth\(""\);\s*setDay\("all"\)/);
  assert.match(component, /if \(createMode === "expert-recovery"\) \{\s*setViewMode\("expert"\);\s*setQuery\(draft\.phone\)/);
  assert.match(component, /showSaved\(/);
});

test("搜索号码后由炒群负责人智能登记遗失档案的推专家动作", () => {
  assert.doesNotMatch(component, /\? "新增专家客户"/);
  assert.doesNotMatch(component, /补录已注册\/开单客户/);
  assert.match(component, /const canRegisterExpertCustomer = Boolean/);
  assert.match(component, /isLead \|\| canEditGroup/);
  assert.match(component, /stage: "group"/);
  assert.match(component, /exactPhoneQuery/);
  assert.match(component, /登记本次推专家/);
  assert.match(component, /旧月份不会重复加数/);
  assert.match(component, /该号码已经推过专家，没有重复新增/);
  assert.match(component, /canCreateInView/);
  assert.match(component, /aria-label="新增客户专家负责人"/);
  assert.match(component, /aria-label="新增客户专家设备号"/);
  assert.match(component, /aria-label="新增客户推专家日期"/);
  assert.match(component, /expertDeviceAccountNumber/);
  assert.match(component, /专家设备号和推专家日期/);
});

test("共享表按实际负责人分阶段编辑，原始归属只读且组长纠错留痕", () => {
  assert.match(component, /const canEditExpert = Boolean/);
  assert.match(component, /需专家权限才能编辑/);
  assert.match(component, /canEditCustomerInfo/);
  assert.match(component, /canEditGroupStage/);
  assert.match(component, /canEditExpertStage/);
  assert.match(component, /canEditReception && attributedOwner\?\.id === actorId/);
  assert.match(component, /viewMode === "expert"/);
  assert.match(component, /aria-label="修改炒群负责人"/);
  assert.match(component, /炒群负责人已纠正/);
  for (const action of ["setJoinedOn", "assignGroupOperator", "setDeviceCode", "assignExpert", "setRegistration", "setLeave"]) assert.match(component, new RegExp(action));
  for (const action of ["setSourceDate", "setOwner", "setChannel"]) assert.doesNotMatch(component, new RegExp(`action: "${action}"`));
  assert.match(component, /修改组员\/渠道/);
  assert.match(component, /修改渠道/);
  assert.match(component, /修改原因（必填）/);
  assert.match(attributionCorrection, /hasAssignedRole\(sessionUser, "LEAD"\)/);
  assert.match(attributionCorrection, /CUSTOMER_ATTRIBUTION_CORRECTED/);
  assert.match(attributionCorrection, /reattributeCustomerNumberEvents/);
  assert.match(component, /撤销退群/);
  assert.match(component, /退群日期已纠正/);
  assert.match(component, /aria-label="推专家日期"/);
  assert.match(component, /aria-label="专家设备号"/);
  assert.match(component, /确认推专家/);
  assert.match(component, /保存修改/);
  assert.match(component, /专家负责人、设备号和推专家日期已保存/);
  assert.match(component, /撤销误点推专家/);
  assert.match(component, /action: "undoIntroduceExpert"/);
  assert.match(component, /错误的推专家已撤销，客户已回到在群待推专家/);
  assert.match(component, /!customer\.expertContactedOn/);
  assert.match(customerPatch, /input\.occurredOn \?\? lead\.expertIntroducedOn \?\? today/);
  assert.match(customerPatch, /只有该客户原接粉负责人或组长可以调整炒群负责人/);
  assert.match(customerPatch, /moveCustomerExpertIntroductionDate/);
  assert.match(customerPatch, /leaveType:\s*z\.enum\(\["NORMAL", "ABNORMAL", "NONE"\]\)/);
  assert.match(customerPatch, /delta:\s*-1/);
  assert.match(component, /placeholder="手动填写"/);
  assert.doesNotMatch(component, /deviceOptions/);
  assert.match(component, /\/api\/customer-orders/);
  assert.match(component, /\+ 开单 \/ 首充/);
  assert.match(component, /开单日期/);
  assert.match(component, /开单金额（首充）/);
  assert.match(component, /确认开单并登记首充/);
  assert.match(component, /请先填写注册日期；保存后即可填写开单日期和开单金额/);
  assert.match(component, /customer\.order\.openedOn/);
  assert.match(component, /客户资金流水/);
  assert.match(component, /不修改组员填写的公司认账财务/);
  assert.match(component, /\+ 新增续充/);
  assert.match(component, /\+ 登记出金/);
  assert.match(component, /当前净值/);
  assert.match(component, /initialDepositCents \+ ledgerCustomer\.order\.rechargeCents - ledgerCustomer\.order\.withdrawalCents/);
  assert.match(component, /depositMethodLabel/);
  assert.match(component, /event\.enteredBy/);
  assert.match(component, /openLedger/);
  assert.match(css, /\.financeSummary/);
  assert.match(css, /\.netButton/);
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
  assert.match(component, /炒群进度/);
  assert.match(component, /待专家接待/);
  assert.match(component, /FOLLOWING/);
  assert.match(component, /payload\?\.counts\["pending-expert"\]/);
  assert.match(component, /payload\.expertCounts\.MATERIALS/);
  assert.match(css, /\.stageFilters button\[data-active="true"\]/);
  assert.match(css, /\.dayCell\s*\{[^}]*background:\s*#edf8f1/);
  assert.match(css, /\.progressCell\s*\{[^}]*width:\s*230px/);
  assert.match(css, /\.stackedCell\s*\{[^}]*display:\s*grid;[^}]*gap:\s*5px/);
  assert.match(css, /\.table th:nth-child\(2\),\s*\.table td:nth-child\(2\)\s*\{[^}]*position:\s*sticky/);
  assert.match(css, /\.table th\s*\{\s*text-align:\s*center/);
  assert.match(css, /\.table th,\s*\.table td\s*\{\s*height:\s*126px/);
});
