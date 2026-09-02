import { describe, expect, it } from "vitest";
import { GET, POST } from "../../src/app/api/daily-confirmations/route";

describe("已下线的每日确认接口", () => {
  it("查询和提交都返回 410，不能重新启用旧确认流程", async () => {
    const getRequest = new Request("http://localhost/api/daily-confirmations?businessDate=2026-09-02");
    const postRequest = new Request("http://localhost/api/daily-confirmations", { method: "POST", body: "{}" });
    expect((await GET(getRequest)).status).toBe(410);
    expect((await POST(postRequest)).status).toBe(410);
  });
});
