import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { baseColumns, viewColumns, customerGroupStatus, customerExpertStatus, customerExpertStage, isExpertCustomer } from "../../../packages/customer-sheet/schema.ts";
import { sheetLayout } from "../../../packages/customer-sheet/layout.ts";
import { parseSheetText } from "../../../packages/customer-sheet/clipboard.ts";
const sheet=readFileSync(new URL("../../../packages/customer-sheet/CustomerSheet.tsx",import.meta.url),"utf8");
// 权限、持久化、跨组隔离、整批回滚由 test:vnext 与 HTTP 验收覆盖。
test("在群表保留确认的字段和专家负责人，不混入专家资金字段",()=>{
 assert.deepEqual(viewColumns(baseColumns,"group").map(c=>c.id),["intakeOn","quality","replied","repliedOn","status","phone","progress","ownerId","operatorId","channelId","device","lossAmount","joinedOn","normalLeft","normalLeftOn","abnormalLeft","abnormalLeftOn","note","addedExpert","expertId"]);
});
test("专家按联系追踪注册开单分类，可跳过前置记录",()=>{
 for(const [data,stage] of [[{},"联系"],[{traceStartedOn:"2026-09-01"},"追踪"],[{registeredOn:"2026-09-01"},"注册"],[{firstDeposit:1},"开单"]]) assert.equal(customerExpertStage(data),stage);
});
test("正常和异常退群由字段自动识别，不受开单状态干扰",()=>{
 assert.equal(customerGroupStatus({joinedOn:"2026-09-01",firstDeposit:100}),"正常在群");
 assert.equal(customerGroupStatus({normalLeft:true}),"正常退群");
 assert.equal(customerGroupStatus({abnormalLeft:true}),"异常退群");
});
test("新增客户直接插入输入行，保存后清除旧筛选",()=>{
 assert.match(sheet,/setAddingRow\(true\)/);
 assert.match(sheet,/保存新行/);
 assert.match(sheet,/setQ\(""\);setStatus\(""\);setDateRange\("all"\)/);
 assert.match(sheet,/setPage\(1\);setMine\(false\)/);
 assert.doesNotMatch(sheet,/setModal\("create"\)/);
});
test("粘贴导入保留完整号码、多行备注与空字段",()=>{
 assert.deepEqual(parseSheetText('客户号码\t备注\t设备\n97718128\t"第一行\n第二行"\t'),[["客户号码","备注","设备"],["97718128","第一行\n第二行",""]]);
});
test("分配专家即可进入专家视图，不要求先补历史阶段",()=>{
 assert.equal(isExpertCustomer({expertId:"expert-1"}),true);
 assert.equal(isExpertCustomer({firstDeposit:100}),true);
 assert.equal(isExpertCustomer({}),false);
});
test("开单后暂停结束可恢复，原有资金进度保留",()=>{
 const data={firstDeposit:100,registeredOn:"2026-09-01"};
 for(const expertMode of ["暂停跟进","已结束"]) assert.equal(customerExpertStatus({...data,expertMode}),expertMode);
 assert.equal(customerExpertStatus({...data,expertMode:"自动跟进"}),"已首充");
 assert.equal(data.firstDeposit,100);
});
test("开单布局提供投资总额及跟进安排",()=>{
 const ids=sheetLayout("expert","开单").flatMap(g=>g.ids);
 for(const id of ["expertMode","firstDeposit","investmentTotal","expertNote"]) assert.ok(ids.includes(id));
});
test("在群紧凑布局完整容纳可见字段且无重复",()=>{
 const ids=sheetLayout("group","").flatMap(g=>g.ids);
 assert.equal(new Set(ids).size,ids.length);
 assert.deepEqual([...ids].sort(),viewColumns(baseColumns,"group").map(c=>c.id).sort());
 assert.ok(sheetLayout("group","").length<ids.length);
});
