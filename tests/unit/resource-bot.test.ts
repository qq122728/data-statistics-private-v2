import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
const mock = vi.hoisted(() => ({
  channel: { findMany: vi.fn() },
  resourceBuyerPhone: { findMany: vi.fn() },
  resourceBuyerSpend: { findMany: vi.fn() },
  customerSheetRow: { findMany: vi.fn() },
}));
vi.mock("../../src/lib/db", () => ({ db: mock }));
import {
  parseResourceQuestion,
  queryBounds,
  querySchema,
} from "../../src/lib/resource-bot/query";
import {
  addressedQuestion,
  type TelegramMessage,
} from "../../src/lib/resource-bot/telegram";
import { loadResourceBotData } from "../../src/lib/resource-bot/data";
import {
  exportResourceReport,
  renderResourceReport,
} from "../../src/lib/resource-bot/render";
import { createResourceBotHandler } from "../../src/lib/resource-bot/handler";
import type { BotConfig } from "../../src/lib/resource-bot/config";
const today = "2026-10-12";
const now = Date.parse("2026-10-12T01:00:00Z");
const config: BotConfig = {
  revision: "one",
  token: "test-only",
  botId: 1,
  username: "test_bot",
  name: "资源参谋",
  enabled: true,
  chatId: "-100",
  chatTitle: "资源分析群",
  activatedAt: now - 10000,
  updatedBy: "admin",
};
const msg = (text = "本月投手效果", id = 1): TelegramMessage => ({
  message_id: id,
  date: now / 1000,
  chat: { id: -100, type: "group" },
  from: { id: 4 },
  text: "@test_bot " + text,
  entities: [{ type: "mention", offset: 0, length: 9 }],
});
const q = () => querySchema.parse({});
const attribution = (phone: string, extras = {}) => ({
  channelId: "fb-m",
  phone,
  buyerId: "qq",
  buyer: { id: "qq", name: "QQ" },
  materialId: "m",
  material: { name: "视频A" },
  country: "DE",
  sourceDate: "2026-10-03",
  groupId: null,
  ...extras,
});
const row = (phone: string, groupId = "g1", extras = {}) => ({
  phone,
  groupId,
  data: JSON.stringify({
    channelId: "fb-m",
    intakeOn: "2026-09-20",
    firstDeposit: 500,
    firstDepositOn: "2026-10-05",
    joinedOn: "2026-09-21",
    expertOn: "2026-09-23",
    registeredOn: "2026-10-02",
    __recharges: JSON.stringify([
      { kind: "recharge", amountCents: 20000 },
      { kind: "withdrawal", amountCents: 5000 },
    ]),
    ...extras,
  }),
});
beforeEach(() => {
  vi.stubEnv("DEEPSEEK_API_KEY", "");
  mock.channel.findMany.mockResolvedValue([
    { id: "fb-m", name: "FB-M", groupId: "g1", group: { name: "1组" } },
    { id: "fb-m", name: "FB-M", groupId: "g2", group: { name: "2组" } },
  ]);
  mock.resourceBuyerPhone.findMany.mockResolvedValue([
    attribution("00123456789012345678"),
    attribution("88888888"),
    attribution("77777777"),
  ]);
  mock.customerSheetRow.findMany.mockResolvedValue([
    row("00123456789012345678"),
    row("88888888"),
    row("88888888", "g2"),
    row("99999999"),
    row("66666666", "g1", { __deletedAt: "2026-10-10" }),
    row("55555555", "g1", { channelId: "not-authorized" }),
  ]);
  mock.resourceBuyerSpend.findMany.mockResolvedValue([
    {
      channelId: "fb-m",
      buyerId: "qq",
      buyer: { name: "QQ" },
      country: "DE",
      materialId: null,
      material: null,
      currency: "USD",
      amountCents: 9000,
    },
  ]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("query parsing", () => {
  it("accepts questions about missing expense records and rejects ambiguous formatted phones", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({
            choices: [{ message: { content: '{"view":"issues"}' } }],
          }),
        ),
    );
    expect(
      await parseResourceQuestion("本月有哪些未登记消耗", today),
    ).toMatchObject({ view: "issues" });
    await expect(
      parseResourceQuestion("查询 +49 1755522287 的首充", today),
    ).rejects.toThrow("连续的完整号码");
  });
  it("looks up a full number without sending it to AI", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      await parseResourceQuestion(
        "查询 00123456789012345678 的首充和续充",
        today,
      ),
    ).toMatchObject({
      view: "phone",
      phone: "00123456789012345678",
      period: "all",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("supports standard no-AI queries without silently ignoring an unknown name", async () => {
    expect(await parseResourceQuestion("本月投手效果", today)).toMatchObject({
      view: "effects",
    });
    expect(
      await parseResourceQuestion("本月开单号码 导出 Excel", today),
    ).toMatchObject({ view: "orders", excel: true });
    await expect(parseResourceQuestion("QQ本月效果", today)).rejects.toThrow(
      "尚未配置",
    );
  });
  it("retains explicit channel and buyer when AI forgets them; refuses unsupported group and multiple numbers", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () =>
        Response.json({
          choices: [{ message: { content: '{"view":"orders"}' } }],
        }),
      ),
    );
    expect(
      await parseResourceQuestion("FB-M QQ 本月开单号码", today, {
        channels: ["FB-M"],
        buyers: ["QQ"],
        materials: [],
        groups: [],
      }),
    ).toMatchObject({ channel: "FB-M", buyer: "QQ", view: "orders" });
    await expect(
      parseResourceQuestion("1组 本月开单", today, {
        channels: [],
        buyers: [],
        materials: [],
        groups: ["1组"],
      }),
    ).rejects.toThrow("小组筛选");
    await expect(
      parseResourceQuestion("查询12345678和87654321", today),
    ).rejects.toThrow("一次查询一个");
  });
  it("refuses edits and invalid/custom reversed/future dates", async () => {
    await expect(parseResourceQuestion("删除客户号码", today)).rejects.toThrow(
      "只负责查询",
    );
    for (const dates of [
      { from: "bad", to: today },
      { from: "2026-10-13", to: today },
      { from: "2026-10-01", to: "2026-11-01" },
    ])
      expect(() =>
        queryBounds(querySchema.parse({ period: "custom", ...dates }), today),
      ).toThrow();
  });
  it("validates AI output strictly and masks number before AI", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({ view: "phone", period: "all" }),
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(
      await parseResourceQuestion("号码 12345678 哪天接的？", today),
    ).toMatchObject({ phone: "12345678", view: "phone" });
    expect(fetch.mock.calls[0][1].body).not.toContain("12345678");
    fetch.mockResolvedValue(
      Response.json({
        choices: [{ message: { content: '{"sql":"DROP TABLE x"}' } }],
      }),
    );
    await expect(parseResourceQuestion("查这个月", today)).rejects.toThrow(
      "条件不够明确",
    );
  });
});
describe("business matching and report", () => {
  it("deduplicates channel copies and excludes deleted/wrong-channel data, ambiguous conversion", async () => {
    const data = await loadResourceBotData(q(), today);
    expect(data.summary[0]).toMatchObject({
      imported: 3,
      matched: 1,
      pending: 1,
      ambiguous: 1,
      opened: 1,
      firstCents: 50000,
      rechargeCents: 20000,
      withdrawalCents: 5000,
      netCents: 65000,
      spend: [{ currency: "USD", amountCents: 9000 }],
    });
    expect(data.unattributed).toBe(1);
  });
  it("uses actual order date for orders even if intake happened last month", async () => {
    const data = await loadResourceBotData(
      querySchema.parse({ view: "orders" }),
      today,
    );
    expect(data.details).toHaveLength(4);
    expect(
      data.details.some(
        (d) => d.phone === "99999999" && d.buyer === "未登记投手",
      ),
    ).toBe(true);
    expect(data.details.every((d) => d.intakeOn === "2026-09-20")).toBe(true);
    const old = await loadResourceBotData(
      querySchema.parse({ view: "orders", period: "lastMonth" }),
      today,
    );
    expect(old.details).toHaveLength(0);
  });
  it("resolves same-channel duplicate phone only by explicitly assigned group", async () => {
    mock.resourceBuyerPhone.findMany.mockResolvedValue([
      attribution("88888888", { groupId: "g2" }),
    ]);
    const data = await loadResourceBotData(q(), today);
    expect(data.details[0]).toMatchObject({ status: "matched", group: "2组" });
    expect(data.summary[0].opened).toBe(1);
  });
  it("keeps currencies separate and refuses cross-currency cost rankings", async () => {
    const expenses = await mock.resourceBuyerSpend.findMany();
    mock.resourceBuyerSpend.findMany.mockResolvedValue([
      ...expenses,
      { ...expenses[0], currency: "EUR" },
    ]);
    const data = await loadResourceBotData(q(), today);
    expect(data.summary[0].spend).toHaveLength(2);
    await expect(
      loadResourceBotData(querySchema.parse({ sort: "cost" }), today),
    ).rejects.toThrow("多种币种");
  });
  it("distinguishes missing spend from zero spend and does not assign unallocated spend to materials", async () => {
    const data = await loadResourceBotData(
      querySchema.parse({ dimension: "material" }),
      today,
    );
    expect(data.summary[0].spend).toEqual([]);
    expect(
      renderResourceReport(querySchema.parse({ dimension: "material" }), data),
    ).toContain("消耗未登记");
  });
  it("writes a real workbook with precise text phone, numeric money, formulas not executed and cost definitions", async () => {
    mock.resourceBuyerPhone.findMany.mockResolvedValue([
      attribution("00123456789012345678", {
        buyer: { id: "qq", name: '=HYPERLINK("bad")' },
      }),
      attribution("77777777"),
    ]);
    const data = await loadResourceBotData(q(), today);
    const bytes = await exportResourceReport(q(), data);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(bytes) as never);
    const sheet = book.getWorksheet("号码明细")!;
    expect(sheet.getCell("A2").value).toBe("00123456789012345678");
    expect(sheet.getCell("D2").value).toBe('=HYPERLINK("bad")');
    expect(sheet.getCell("D2").type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell("U2").value).toBe(500);
    expect(sheet.getCell("V2").value).toBe(200);
    expect(sheet.getCell("Y2").value).toBe(650);
    expect(sheet.getCell("U3").value).toBeNull();
    expect(book.getWorksheet("查询说明")!.getCell("B3").text).toContain(
      "单粉成本＝消耗/导入",
    );
  });
});
describe("Telegram isolation and reply lifecycle", () => {
  it("only responds to exact mentions by humans in the bound group after activation", () => {
    expect(
      addressedQuestion(msg(), "test_bot", "-100", config.activatedAt),
    ).toBe("本月投手效果");
    for (const m of [
      { ...msg(), chat: { id: -200, type: "group" } },
      { ...msg(), from: { id: 4, is_bot: true } },
      { ...msg(), sender_chat: {} },
      { ...msg(), forward_origin: {} },
      { ...msg(), date: 1 },
      { ...msg(), entities: [] },
      { ...msg(), chat: { id: -100, type: "private" } },
    ])
      expect(
        addressedQuestion(m, "test_bot", "-100", config.activatedAt),
      ).toBeNull();
    expect(
      addressedQuestion(
        {
          ...msg(),
          text: "/start@test_bot",
          entities: [{ type: "bot_command", offset: 0, length: 15 }],
        },
        "test_bot",
        "-100",
        config.activatedAt,
      ),
    ).toBe("/start");
  });
  it("checks latest configuration again before sending data", async () => {
    const data = await loadResourceBotData(q(), today);
    const send = vi.fn();
    let live = config;
    const handle = createResourceBotHandler({
      catalog: async () => ({
        channels: [],
        buyers: [],
        materials: [],
        groups: [],
      }),
      readConfig: async () => live,
      parse: async () => q(),
      load: async () => {
        live = { ...config, enabled: false };
        return data;
      },
      send,
      now: () => now,
    });
    expect(await handle(msg(), config)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it("sends Excel only to bound group and scopes continuation to the requesting member", async () => {
    const data = await loadResourceBotData(q(), today);
    const send = vi.fn().mockResolvedValue({});
    const load = vi.fn().mockResolvedValue(data);
    const handle = createResourceBotHandler({
      catalog: async () => ({
        channels: [],
        buyers: [],
        materials: [],
        groups: [],
      }),
      readConfig: async () => config,
      parse: async () => querySchema.parse({ excel: true }),
      load,
      send,
      now: () => now,
    });
    expect(await handle(msg(), config)).toBe(true);
    const file = send.mock.calls.find(
      (c) => c[1] === "sendDocument",
    )![2] as FormData;
    expect(file.get("chat_id")).toBe("-100");
    expect(file.get("document")).toBeInstanceOf(Blob);
    await handle({ ...msg("下一页", 2), from: { id: 5 } }, config);
    expect(load).toHaveBeenCalledTimes(1);
    expect(send.mock.calls.at(-1)![2].text).toContain("请先问");
  });
  it("limits user frequency and never queries for non-bound messages", async () => {
    const send = vi.fn().mockResolvedValue({});
    const parse = vi
      .fn()
      .mockResolvedValue(querySchema.parse({ view: "help" }));
    const handle = createResourceBotHandler({
      catalog: async () => ({
        channels: [],
        buyers: [],
        materials: [],
        groups: [],
      }),
      readConfig: async () => config,
      parse,
      send,
      now: () => now,
    });
    await handle({ ...msg(), chat: { id: -200, type: "group" } }, config);
    expect(parse).not.toHaveBeenCalled();
    for (let i = 0; i < 7; i++) await handle(msg("帮助", i), config);
    expect(send).toHaveBeenCalledTimes(5);
  });
});
