import { describe, expect, it } from "vitest";
import { GET as listLeadReviews, POST as sendForReview } from "../../src/app/api/lead/channel-review/route";
import { GET as listResourceInbox } from "../../src/app/api/resource/channel-review/route";
import { POST as actOnReview } from "../../src/app/api/resource/channel-review/[id]/route";

describe("已下线的渠道审核接口", () => {
  it("所有旧入口都返回 410，不能继续写旧审批状态", async () => {
    const request = new Request("http://localhost/api/lead/channel-review", { method: "POST", body: "{}" });
    expect((await listLeadReviews()).status).toBe(410);
    expect((await sendForReview(request)).status).toBe(410);
    expect((await listResourceInbox()).status).toBe(410);
    expect((await actOnReview(request, { params: Promise.resolve({ id: "legacy" }) })).status).toBe(410);
  });
});
