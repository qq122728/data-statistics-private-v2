import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  groups: vi.fn(), channels: vi.fn(), rows: vi.fn(), orders: vi.fn(),
}));
vi.mock("../../src/lib/db", () => ({ db: {
  teamGroup: { findMany: mocks.groups },
  channel: { findMany: mocks.channels },
  customerSheetRow: { findMany: mocks.rows },
  customerOrder: { findMany: mocks.orders },
} }));

import { POST } from "../../src/app/api/integrations/boss-order-query/route";

const secret = "boss-query-test-token-must-be-long-enough";
function request(token = secret, body: unknown = { view: "orders", group: "德国部", period: "month" }) {
  return new Request("http://localhost/api/integrations/boss-order-query", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
}

describe("电报号码查询接口授权", () => {
  beforeEach(() => {
    vi.stubEnv("BOSS_ORDER_QUERY_TOKEN", secret);
    mocks.groups.mockReset().mockResolvedValue([
      { id: "de", name: "WD-名将小组", active: true, groupType: "HACKER", countryCode: "DE", department: { name: "德国部", countryCode: "DE" } },
    ]);
    mocks.channels.mockReset().mockResolvedValue([{ id: "fbm", groupId: "de", name: "FB-M" }]);
    mocks.rows.mockReset().mockResolvedValue([{ id: "row", groupId: "de", phone: "491123456789", data: JSON.stringify({ intakeOn: "2026-10-01", firstDepositOn: "2026-10-10", firstDeposit: 250, channelId: "fbm" }) }]);
    mocks.orders.mockReset().mockResolvedValue([]);
  });

  it("错误令牌无法触碰数据库", async () => {
    const response = await POST(request("wrong"));
    expect(response.status).toBe(401);
    expect(mocks.groups).not.toHaveBeenCalled();
  });

  it("只返回授权范围内的号码与真实日期", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.count).toBe(1);
    expect(body.text).toContain("491123456789｜WD-名将小组｜FB-M");
    expect(body.text).toContain("接粉 2026-10-01 → 开单 2026-10-10");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("号码查询缺少尾号时立即拒绝", async () => {
    const response = await POST(request(secret, { view: "phone", phone: "12" }));
    expect(response.status).toBe(400);
    expect(mocks.groups).not.toHaveBeenCalled();
  });
});
