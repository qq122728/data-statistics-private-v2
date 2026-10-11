import { describe, expect, it } from "vitest";
import { bossOrderQuerySchema, renderBossOrderQuery, type BossGroup } from "../../src/lib/boss-order-query";

const groups: BossGroup[] = [
  { id: "de", name: "WD-名将小组", active: true, groupType: "HACKER", countryCode: "DE", department: { name: "德国部", countryCode: "DE" } },
  { id: "sg", name: "WX-财财小组", active: true, groupType: "HACKER", countryCode: "SG", department: { name: "新加坡部", countryCode: "SG" } },
  { id: "test", name: "系统测试组", active: true, groupType: "HACKER", countryCode: "DE", department: { name: "德国部", countryCode: "DE" } },
];
const channels = [
  { id: "fbm", groupId: "de", name: "FB-M" },
  { id: "fbq", groupId: "de", name: "FB-Q" },
  { id: "jh", groupId: "sg", name: "JH" },
];
const sheetRows = [
  { id: "new", groupId: "de", phone: "491123456789", data: JSON.stringify({ intakeOn: "2026-10-01", firstDepositOn: "2026-10-10", firstDeposit: 250, channelId: "fbm" }) },
  { id: "old", groupId: "de", phone: "345678", data: JSON.stringify({ intakeOn: "2026-09-20", firstDepositOn: "2026-10-09", firstDeposit: 100, channelId: "fbq" }) },
  { id: "pending", groupId: "de", phone: "999678", data: JSON.stringify({ intakeOn: "2026-10-02", channelId: "fbm" }) },
  { id: "deleted", groupId: "de", phone: "111678", data: JSON.stringify({ intakeOn: "2026-10-02", firstDepositOn: "2026-10-09", firstDeposit: 50, channelId: "fbm", __deletedAt: "2026-10-10" }) },
  { id: "other", groupId: "sg", phone: "888999", data: JSON.stringify({ intakeOn: "2026-10-02", firstDepositOn: "2026-10-10", firstDeposit: 60, channelId: "jh" }) },
  { id: "test", groupId: "test", phone: "777678", data: JSON.stringify({ intakeOn: "2026-10-02", firstDepositOn: "2026-10-10", firstDeposit: 70, channelId: "fbm" }) },
];
const legacyOrders = [{ id: "legacy", phone: "491111222333", openedOn: "2026-10-08", initialDepositCents: 12500, batch: { groupId: "de", channelId: "fbm", sourceDate: "2026-08-30" } }];

function query(values: Record<string, unknown>) {
  return renderBossOrderQuery({ query: bossOrderQuerySchema.parse(values), today: "2026-10-11", groups, channels, sheetRows, legacyOrders });
}

describe("电报开单号码只读查询", () => {
  it("按开单日期列出号码、原始接粉日期与渠道，排除测试组和已删除行", () => {
    const result = query({ group: "德国部", period: "month", view: "orders" });
    expect(result.count).toBe(3);
    expect(result.text).toContain("491123456789｜WD-名将小组｜FB-M");
    expect(result.text).toContain("接粉 2026-10-01 → 开单 2026-10-10（9天）");
    expect(result.text).toContain("尾号 345678");
    expect(result.text).toContain("旧业务账");
    expect(result.text).not.toContain("888999");
    expect(result.text).not.toContain("777678");
    expect(result.text).not.toContain("111678");
  });

  it("按 FB 渠道族细分到具体渠道、小组和接粉月份", () => {
    const result = query({ group: "德国", channel: "FB", period: "month", view: "channels" });
    expect(result.count).toBe(3);
    expect(result.text).toContain("WD-名将小组｜FB-M：开单 2");
    expect(result.text).toContain("WD-名将小组｜FB-Q：开单 1");
    expect(result.text).toContain("2026-08 1单");
    expect(result.text).toContain("2026-09 1单");
    expect(result.text).toContain("2026-10 1单");
  });

  it("尾号查找也能回答尚未开单的号码，不跨小组泄漏", () => {
    const result = query({ group: "德国部", view: "phone", phone: "999678" });
    expect(result.count).toBe(1);
    expect(result.text).toContain("尾号 999678");
    expect(result.text).toContain("尚未开单");
    expect(query({ group: "新加坡部", view: "phone", phone: "999678" }).count).toBe(0);
  });

  it("拒绝无效或未来日期", () => {
    expect(() => query({ period: "custom", from: "2026-10-32", to: "2026-10-11" })).toThrow("有效");
    expect(() => query({ period: "custom", from: "2026-10-12", to: "2026-10-13" })).toThrow("未来");
  });
});
