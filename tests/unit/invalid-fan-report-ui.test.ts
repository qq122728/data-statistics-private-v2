import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { InvalidFanReportPanel } from "../../src/components/entry/InvalidFanReviewPanel";

describe("invalid fan report panel", () => {
  it("shows the three manual categories and the approval rule to reception", () => {
    const markup = renderToStaticMarkup(createElement(InvalidFanReportPanel, {
      role: "RECEPTION",
      channels: [{ id: "channel-a", name: "测试渠道", groupId: "group-a", channelType: "SMS" }],
      sourceDate: "2026-08-20",
      channelId: "channel-a",
    }));
    expect(markup).toContain("扣粉登记");
    expect(markup).toContain("无 WS 号码");
    expect(markup).toContain("低金额");
    expect(markup).toContain("撞粉");
    expect(markup).not.toContain("人工无效");
    expect(markup).toContain("组长审核后才会进入正式统计");
    expect(markup).toContain("登记数据");
    expect(markup).toContain("登记记录");
    expect(markup).toContain("invalid-fan-entry-card");
  });
});
