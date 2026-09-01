import { describe, expect, it, vi } from "vitest";
import { interpretWithServerModel } from "../../src/lib/ai-assistant/interpret";

describe("服务器 AI 数据助手", () => {
  it("使用服务器模型解析每日数据并把金额换成美分", async () => {
    const fetchImplementation = vi.fn(async (_url, init) => {
      expect(String(init?.body)).toContain("进群/拉群→joinCount");
      return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ kind: "daily", correction: false, updates: [
        { key: "dispatchCount", value: 20 }, { key: "cryptoInitialDepositCents", value: 100000 },
      ] }) } }],
      }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await interpretWithServerModel("今天添加20，首充1000", { apiKey: "test-only", fetchImplementation });
    expect(result).toEqual({ kind: "daily", correction: false, updates: [
      { key: "dispatchCount", value: 20, label: "添加数据" },
      { key: "cryptoInitialDepositCents", value: 100000, label: "加密货币首充", money: true },
    ] });
  });

  it("发送给模型前隐藏客户号码，返回时再由程序恢复后六位", async () => {
    const fetchImplementation = vi.fn(async (_url, init) => {
      expect(String(init?.body)).not.toContain("13800123456");
      expect(String(init?.body)).toContain("客户号码已由系统隐藏");
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"kind":"customer_query"}' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(interpretWithServerModel("查客户13800123456进度", { apiKey: "test-only", fetchImplementation }))
      .resolves.toEqual({ kind: "customer_query", phoneTail: "123456" });
  });

  it("服务器未配置密钥时由前端安全规则解析器兜底", async () => {
    await expect(interpretWithServerModel("回复8", { apiKey: "" })).resolves.toBeNull();
  });

  it("解析老客户今天开单场景", async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      kind: "legacy_event", event: "ORDERED", sourceDate: "2026-08-20", channelName: "FB-M",
      receptionOwnerName: "桃子", groupOperatorName: "阿水", expertName: "西瓜", amountCents: 100000,
    }) } }] }), { status: 200 })) as unknown as typeof fetch;
    await expect(interpretWithServerModel("000004是8月20日的粉，今天开单首充1000", { apiKey: "test-only", fetchImplementation, today: "2026-09-01" }))
      .resolves.toMatchObject({ kind: "legacy_event", event: "ORDERED", phoneTail: "000004", amountCents: 100000 });
  });
});
