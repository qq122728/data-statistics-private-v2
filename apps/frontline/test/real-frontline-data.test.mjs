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
  assert.match(source, /每天数据怎么填/);
  assert.match(source, /进群客户怎么导入/);
  assert.match(source, /每天资金情况怎么填/);
  assert.match(source, /公司最终认账/);
  assert.match(source, /member-entry-guide--compact/);
  assert.match(source, /展开查看操作说明/);
});

test("组长可以新增渠道且请求固定携带自己的 groupId", () => {
  const workspace = read("FreshWorkspace.tsx");
  const channelPanel = read("ChannelManagementPanel.tsx");
  assert.match(workspace, /isLead \? <button data-active=\{view === "channels"\}/);
  assert.match(workspace, /<ChannelManagementPanel scope="group" groupId=\{user\.groupId\}/);
  assert.match(channelPanel, /\{ groupId, name, channelType \}/);
  assert.match(channelPanel, /只添加到组长自己负责的小组/);
});

test("统一组员表按渠道读取并保存真实每日数据", () => {
  const source = read("UnifiedMemberDataSheet.tsx");
  assert.match(source, /requestJson<Context>\("\/api\/daily-stats"\)/);
  assert.match(source, /method:\s*"POST"/);
  assert.match(source, /position:\s*"RECEPTION"/);
  assert.match(source, /人工无效/);
  assert.match(source, /异常退群率/);
  assert.match(source, /numberTrackingFrom/);
  assert.match(source, /NUMBER_TRACKED_METRIC_KEYS/);
  assert.match(source, /由客户号码进度自动统计/);
  assert.match(source, /填写公司最终认账的首充、续充和出金/);
  assert.match(source, /return values\.dispatchCount - values\.duplicateCount - values\.lowAmountCount - values\.noWsCount - values\.manualInvalidCount/);
  assert.match(source, /denominator > 0 \? numerator \/ denominator \* 100 : Number\.NaN/);
  assert.match(source, /!Number\.isFinite\(value\).*"—"/);
  assert.doesNotMatch(source, /mode === "finance" \|\| NUMBER_TRACKED_METRIC_KEYS/);
});

test("历史和财务读取真实每日数据接口", () => {
  const source = read("MemberDailyRecords.tsx");
  assert.match(source, /requestJson<Context>\(`\/api\/daily-stats/);
  assert.match(source, /ai-data-updated/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /setInterval\(refreshWhenVisible, 10_000\)/);
  assert.match(source, /选择月份/);
  assert.match(source, /选择日期/);
  assert.match(source, /所选时间汇总/);
  assert.match(source, /sumRows\(rows\)/);
  assert.doesNotMatch(source, /const\s+(?:history|finance|fund).*Seed/i);
});

test("客户进度统一使用真实共享表格", () => {
  const source = read("MemberCustomerProgress.tsx");
  assert.match(source, /<DepartmentCustomerProgress/);
  assert.match(source, /member=\{user\}/);
  assert.match(source, /user\.groupId/);
  assert.doesNotMatch(source, /GroupOperatorWorkbench|ExpertWorkbench|RealReceptionProgress/);
});

test("组员AI仅从正式按钮进入写入流程，空白输入框保持只读闲聊", () => {
  const source = read("AiSmartAssistant.tsx");
  const workspace = read("FreshWorkspace.tsx");
  assert.match(source, /AI 对话内容/);
  assert.match(source, /AI 对话输入框/);
  assert.match(source, /添加今日数据/);
  assert.match(source, /更新客户进度/);
  assert.match(source, /新增专家客户/);
  assert.match(source, /接粉日期8月24日/);
  assert.match(source, /进群日期8月30日/);
  assert.match(source, /历史接粉、进群只用于恢复跟踪档案/);
  assert.match(source, /\/api\/leads\/check/);
  assert.doesNotMatch(source, /\/api\/legacy-customers/);
  assert.match(source, /收起 AI 助手/);
  assert.match(source, /requestJson<DailyContext>\("\/api\/daily-stats"\)/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /AI 不会在你确认前写入数据/);
  assert.match(source, /自然语言填写模板/);
  assert.match(source, /今天 FB-M：添加20/);
  assert.match(source, /新增进群客户112233/);
  assert.match(source, /新增专家客户112233/);
  assert.match(source, /专家设备号X08/);
  assert.match(source, /expertDeviceAccountNumber: progressDraft\.text/);
  assert.match(source, /输入专家设备号/);
  assert.match(source, /客户112233今天注册/);
  assert.match(source, /未提到的指标保持原值/);
  assert.doesNotMatch(source, /无效的合计不能超过添加数据/);
  assert.doesNotMatch(source, /回复数量不能超过有效数据/);
  assert.doesNotMatch(source, /改用逐步引导/);
  assert.match(source, /正在读取本组真实渠道和人员/);
  assert.match(source, /displayedNaturalTemplates/);
  assert.match(source, /context\.channels\.map/);
  assert.match(source, /customerContext\.channelOptions\.map/);
  assert.match(source, /确认保存/);
  assert.match(source, /requestJson<CustomerContext>\("\/api\/lead\/customer-reporting\?stage=group&page=1"\)/);
  assert.match(source, /客户号码至少需要 6 位/);
  assert.match(source, /完整号码只保留最后 6 位/);
  assert.match(source, /确认新增/);
  assert.match(source, /批量新增/);
  assert.match(source, /一次最多 200 个/);
  assert.match(source, /确认批量新增/);
  assert.match(source, /dryRun: true/);
  assert.match(source, /选择炒群负责人/);
  assert.match(source, /设备账号或设备号/);
  assert.match(source, /stage=group&page=1&q=/);
  assert.match(source, /更新炒群情况/);
  assert.match(source, /推专家/);
  assert.match(source, /登记注册/);
  assert.match(source, /登记首充/);
  assert.match(source, /还没有登记注册/);
  assert.match(source, /新增续充/);
  assert.match(source, /登记出金/);
  assert.match(source, /确认更新/);
  assert.match(source, /查询客户112233的全部进度/);
  assert.match(source, /把今天FB-M的回复从10改成8/);
  assert.match(source, /query-customer-result/);
  assert.match(source, /query-daily-result/);
  assert.match(source, /AI纠正/);
  assert.match(source, /为防止覆盖别人的新数据/);
  assert.doesNotMatch(source, /稍后接入/);
  assert.match(source, /进群及后续按号码自动统计/);
  assert.match(source, /\/api\/customer-orders/);
  assert.match(source, /\/api\/customer-finance/);
  assert.match(source, /ai-data-updated/);
  assert.match(source, /sendCasualChat/);
  assert.match(source, /\/api\/ai\/chat/);
  assert.match(source, /READ_ONLY_CHAT/);
  assert.match(source, /系统使用帮助/);
  assert.match(source, /\/api\/performance-leaderboard\?range=/);
  assert.match(source, /谁的数据最好/);
  assert.match(source, /free-form input is always read-only chat/);
  assert.doesNotMatch(source, /phase === "idle" && \/今日\|当天/);
  assert.match(source, /新增进群客户/);
  assert.match(source, /canUseExpertActions/);
  assert.match(source, /EXPERT_PROGRESS_ACTIONS/);
  assert.match(source, /当前账号没有专家权限/);
  assert.match(source, /canUseExpertActions \|\| !EXPERT_PROGRESS_ACTIONS\.has\(action\)/);
  assert.match(workspace, /<AiSmartAssistant[^>]*user=\{user\}/);
});
