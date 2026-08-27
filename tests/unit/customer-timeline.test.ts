import { describe, expect, it } from "vitest";
import { buildCustomerTimeline, customerTimelineActivityLabels } from "../../src/lib/customer-timeline";

describe("customer number timeline", () => {
  it("uses readable labels for every newer workflow action", () => {
    expect(customerTimelineActivityLabels.EXPERT_CONTACTED).toBe("专家确认已联系");
    expect(customerTimelineActivityLabels.GROUP_PROGRESS_UPDATED).toBe("填写群内每日进度");
    expect(customerTimelineActivityLabels.EXPERT_CONTACT_REVOKED).toBe("撤销专家联系");
  });

  it("puts source, workflow and finance actions in date order", () => {
    const rows = buildCustomerTimeline({
      sourceDate: "2026-08-10",
      createdAt: new Date("2026-08-10T08:00:00Z"),
      ownerName: "接粉 A",
      channelName: "短信粉",
      activities: [{ id: "joined", kind: "JOINED_GROUP", occurredOn: "2026-08-11", createdAt: new Date("2026-08-11T08:00:00Z"), note: null, actorName: "接粉 A" }],
      order: {
        id: "order-1",
        openedOn: "2026-08-13",
        createdAt: new Date("2026-08-13T08:00:00Z"),
        initialDepositCents: 10_000,
        voidedAt: null,
        voidReason: null,
        enteredByName: "专家 A",
        events: [{ id: "recharge-1", kind: "RECHARGE", occurredOn: "2026-08-14", createdAt: new Date("2026-08-14T08:00:00Z"), amountCents: 2_500, continuationNumber: 1, voidedAt: null, voidReason: null, enteredByName: "专家 A" }],
      },
    });
    expect(rows.map((row) => row.label)).toEqual(["录入号码", "客户入群", "客户开单", "第 1 次续充"]);
    expect(rows[2].detail).toContain("$100.00");
    expect(rows[3].detail).toContain("$25.00");
  });

  it("keeps voided finance history visible and clearly marked", () => {
    const rows = buildCustomerTimeline({
      sourceDate: "2026-08-10",
      createdAt: new Date("2026-08-10T08:00:00Z"),
      ownerName: "接粉 A",
      channelName: "短信粉",
      activities: [],
      order: {
        id: "order-1",
        openedOn: "2026-08-11",
        createdAt: new Date("2026-08-11T08:00:00Z"),
        initialDepositCents: 10_000,
        voidedAt: null,
        voidReason: null,
        enteredByName: "专家 A",
        events: [{ id: "withdraw-1", kind: "WITHDRAWAL", occurredOn: "2026-08-12", createdAt: new Date("2026-08-12T08:00:00Z"), amountCents: 1_000, continuationNumber: null, voidedAt: new Date("2026-08-13T08:00:00Z"), voidReason: "录错金额", enteredByName: "专家 A" }],
      },
    });
    expect(rows.at(-1)).toMatchObject({ label: "出金（已作废）", voided: true });
    expect(rows.at(-1)?.detail).toContain("录错金额");
  });
});
