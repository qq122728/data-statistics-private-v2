import test from "node:test";
import assert from "node:assert/strict";
import { interpretAssistantMessage, valueToStoreForUnifiedTotal, withComputedValues, EMPTY_DAILY_VALUES } from "../lib/ai-smart-assistant.ts";

test("识别同一句里的多项每日数据", () => {
  const result = interpretAssistantMessage("今天 FB-M 添加20，回复8，进群3，首充1000");
  assert.equal(result.kind, "daily");
  assert.equal(result.updates.length, 4);
  assert.equal(result.updates.find((item) => item.key === "cryptoInitialDepositCents").value, 100000);
});

test("把员工口语中的拉群识别为进群", () => {
  const result = interpretAssistantMessage("今天演示投流渠道添加20回复8拉群2");
  assert.deepEqual(result, {
    kind: "daily",
    correction: false,
    updates: [
      { key: "dispatchCount", label: "添加数据", value: 20, money: undefined },
      { key: "replyCount", label: "回复", value: 8, money: undefined },
      { key: "joinCount", label: "进群", value: 2, money: undefined },
    ],
  });
});

test("保存汇总目标值时扣除客户事件自动贡献，避免重复累加", () => {
  assert.equal(valueToStoreForUnifiedTotal(2, 5, 4), 1);
  assert.equal(valueToStoreForUnifiedTotal(8, 8, 8), 8);
  assert.equal(valueToStoreForUnifiedTotal(0, 1, 0), 0);
});

test("识别纠错语句", () => {
  const result = interpretAssistantMessage("JH 回复写错了，改成8");
  assert.equal(result.kind, "daily");
  assert.equal(result.correction, true);
  assert.equal(result.updates[0].key, "replyCount");
  assert.equal(result.updates[0].value, 8);
});

test("识别客户炒群情况更新", () => {
  const result = interpretAssistantMessage("号码 123456 炒群情况改成客户今晚会继续沟通");
  assert.deepEqual(result, { kind: "customer_note", phoneTail: "123456", noteKind: "group", note: "客户今晚会继续沟通" });
});

test("识别按号码更新客户进度", () => {
  assert.deepEqual(interpretAssistantMessage("客户123456今天拉群"), { kind: "customer_event", phoneTail: "123456", event: "JOINED" });
  assert.deepEqual(interpretAssistantMessage("客户123456今天续充500"), { kind: "customer_event", phoneTail: "123456", event: "RECHARGE", amountCents: 50000 });
  assert.deepEqual(interpretAssistantMessage("客户123456今天异常退群"), { kind: "customer_event", phoneTail: "123456", event: "LEFT_ABNORMAL" });
});

test("重新计算有效数据和当前在群", () => {
  const values = withComputedValues({ ...EMPTY_DAILY_VALUES, dispatchCount: 20, duplicateCount: 2, joinCount: 6, abnormalLeaveCount: 1 });
  assert.equal(values.effectiveCount, 18);
  assert.equal(values.currentInGroupCount, 5);
});

test("识别老粉今天开单且历史来源日期不当作今天", () => {
  const result = interpretAssistantMessage("客户000004是8月20日的老粉，今天开单首充1000");
  assert.deepEqual(result, { kind: "legacy_event", phoneTail: "000004", event: "ORDERED", sourceDate: "2026-08-20", amountCents: 100000 });
});

test("识别历史已开单客户今天续充", () => {
  const result = interpretAssistantMessage("客户000008是8月19日的粉，已经开单，今天续充500");
  assert.deepEqual(result, { kind: "legacy_event", phoneTail: "000008", event: "RECHARGE", sourceDate: "2026-08-19", amountCents: 50000 });
});
