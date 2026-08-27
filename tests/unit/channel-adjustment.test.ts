import { describe, expect, it } from "vitest";
import { calculateChannelAdjustedEfficiency } from "../../src/lib/analytics/channel-adjustment";

describe("channel-adjusted member efficiency", () => {
  it("weights each channel by the member sample and excludes the member from peer baselines", () => {
    const result = calculateChannelAdjustedEfficiency({
      memberId: "member-a",
      channels: [
        {
          groupId: "group-a",
          normalizedName: "douyin",
          effectiveFans: 100,
          orders: 10,
          peers: [
            { memberId: "member-a", effectiveFans: 1_000, orders: 1_000 },
            { memberId: "peer-a", effectiveFans: 200, orders: 20 },
          ],
        },
        {
          groupId: "group-a",
          normalizedName: "wechat",
          effectiveFans: 50,
          orders: 10,
          peers: [{ memberId: "peer-b", effectiveFans: 100, orders: 10 }],
        },
      ],
      minMemberEffectiveFans: 100,
      minPeerEffectiveFans: 100,
    });

    expect(result).toEqual({
      actualOrders: 20,
      expectedOrders: 15,
      efficiency: 20 / 15,
      state: "READY",
    });
  });

  it("merges matching channel slices without mixing the same normalized name across groups", () => {
    const result = calculateChannelAdjustedEfficiency({
      memberId: "member-a",
      channels: [
        {
          groupId: "group-a",
          normalizedName: "shared",
          effectiveFans: 40,
          orders: 4,
          peers: [{ memberId: "peer-a-1", effectiveFans: 50, orders: 5 }],
        },
        {
          groupId: "group-a",
          normalizedName: "shared",
          effectiveFans: 60,
          orders: 6,
          peers: [{ memberId: "peer-a-2", effectiveFans: 50, orders: 5 }],
        },
        {
          groupId: "group-b",
          normalizedName: "shared",
          effectiveFans: 300,
          orders: 30,
          peers: [{ memberId: "peer-b", effectiveFans: 100, orders: 90 }],
        },
      ],
      minMemberEffectiveFans: 100,
      minPeerEffectiveFans: 100,
    });

    expect(result.actualOrders).toBe(40);
    expect(result.expectedOrders).toBe(280);
    expect(result.efficiency).toBeCloseTo(40 / 280);
    expect(result.state).toBe("READY");
  });

  it("keeps a member out of evaluation until both member and peer samples are sufficient", () => {
    const channel = {
      groupId: "group-a",
      normalizedName: "douyin",
      effectiveFans: 99,
      orders: 10,
      peers: [{ memberId: "peer-a", effectiveFans: 100, orders: 10 }],
    };

    expect(calculateChannelAdjustedEfficiency({
      memberId: "member-a",
      channels: [channel],
      minMemberEffectiveFans: 100,
      minPeerEffectiveFans: 100,
    })).toEqual({ actualOrders: 10, expectedOrders: null, efficiency: null, state: "INSUFFICIENT_SAMPLE" });

    expect(calculateChannelAdjustedEfficiency({
      memberId: "member-a",
      channels: [{ ...channel, effectiveFans: 100, peers: [{ memberId: "peer-a", effectiveFans: 99, orders: 10 }] }],
      minMemberEffectiveFans: 100,
      minPeerEffectiveFans: 100,
    })).toEqual({ actualOrders: 10, expectedOrders: null, efficiency: null, state: "INSUFFICIENT_PEERS" });
  });

  it("does not create infinite efficiency when a valid peer sample has zero orders", () => {
    expect(calculateChannelAdjustedEfficiency({
      memberId: "member-a",
      channels: [{
        groupId: "group-a",
        normalizedName: "douyin",
        effectiveFans: 100,
        orders: 10,
        peers: [{ memberId: "peer-a", effectiveFans: 100, orders: 0 }],
      }],
      minMemberEffectiveFans: 100,
      minPeerEffectiveFans: 100,
    })).toEqual({ actualOrders: 10, expectedOrders: 0, efficiency: null, state: "INSUFFICIENT_PEERS" });
  });
});
