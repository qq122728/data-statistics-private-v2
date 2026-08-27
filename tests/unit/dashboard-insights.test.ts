import { describe, expect, it } from "vitest";
import { buildDashboardTrend, findDailyReplyAnomalies } from "../../src/lib/dashboard-insights";

describe("dashboard insights", () => {
  it("groups trend metrics by event occurrence date", () => {
    expect(buildDashboardTrend([
      { occurredOn: "2026-08-10", kind: "NEW_FANS", quantity: 10 },
      { occurredOn: "2026-08-11", kind: "GROUP_JOIN", quantity: 4 },
      { occurredOn: "2026-08-11", kind: "REGISTRATION", quantity: 2 },
      { occurredOn: "2026-08-12", kind: "ORDER", quantity: 1 },
    ])).toEqual([
      { date: "2026-08-10", newFans: 10, groupJoin: 0, registration: 0, orders: 0 },
      { date: "2026-08-11", newFans: 0, groupJoin: 4, registration: 2, orders: 0 },
      { date: "2026-08-12", newFans: 0, groupJoin: 0, registration: 0, orders: 1 },
    ]);
  });

  it("flags replies when same-day new-fans total is zero", () => {
    const anomalies = findDailyReplyAnomalies([
      { batchId: "batch-a", occurredOn: "2026-08-10", channelName: "抖音", kind: "REPLIES", quantity: 3 },
      { batchId: "batch-a", occurredOn: "2026-08-10", channelName: "抖音", kind: "NEW_FANS", quantity: 0 },
      { batchId: "batch-a", occurredOn: "2026-08-11", channelName: "抖音", kind: "REPLIES", quantity: 4 },
      { batchId: "batch-a", occurredOn: "2026-08-11", channelName: "抖音", kind: "NEW_FANS", quantity: 2 },
      { batchId: "batch-b", occurredOn: "2026-08-11", channelName: "视频号", kind: "REPLIES", quantity: 5 },
      { batchId: "batch-b", occurredOn: "2026-08-11", channelName: "视频号", kind: "NEW_FANS", quantity: 9 },
    ]);

    expect(anomalies).toEqual([
      { id: "batch-a:2026-08-10", label: "2026-08-10 · 抖音", replies: 3 },
    ]);
  });
});
