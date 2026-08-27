import { describe, expect, it } from "vitest";
import { normalizeChannelName } from "../../src/lib/channel-names";
import { buildChannelFilterOptions, buildRecentActivityFilters, resolveChannelFilterSelection } from "../../src/lib/report-filters";

describe("channel name normalization", () => {
  it("trims and collapses whitespace in Chinese channel names", () => {
    expect(normalizeChannelName("  抖音   直播 ")).toBe("抖音 直播");
  });

  it("normalizes Latin channel names case-insensitively", () => {
    expect(normalizeChannelName("TELEGRAM")).toBe("telegram");
  });
});

describe("channel report filters", () => {
  const channels = [
    { id: "channel-a", name: " 抖音直播 ", normalizedName: "抖音直播", active: false, groupId: "group-a" },
    { id: "channel-b", name: "抖音直播", normalizedName: "抖音直播", active: true, groupId: "group-b" },
    { id: "channel-c", name: "旧渠道", normalizedName: "旧渠道", active: false, groupId: "group-a" },
  ];

  it("deduplicates normalized sources across groups and orders active sources first", () => {
    expect(buildChannelFilterOptions(channels)).toEqual([
      { normalizedName: "抖音直播", name: "抖音直播", active: true },
      { normalizedName: "旧渠道", name: "旧渠道", active: false },
    ]);
  });

  it("limits normalized source options to a selected group and keeps inactive sources", () => {
    expect(buildChannelFilterOptions(channels, "group-a")).toEqual([
      { normalizedName: "抖音直播", name: "抖音直播", active: false },
      { normalizedName: "旧渠道", name: "旧渠道", active: false },
    ]);
  });

  it("converts an unambiguous legacy channel id into the normalized source selection", () => {
    expect(resolveChannelFilterSelection(channels, { channelId: "channel-a", groupId: "group-a" })).toEqual({
      normalizedName: "抖音直播",
      unresolvedLegacyChannelId: undefined,
      blockResults: false,
    });
  });

  it("does not guess when a legacy channel id means different sources across groups", () => {
    const duplicatedIdChannels = [
      ...channels,
      { id: "channel-a", name: "其他渠道", normalizedName: "其他渠道", active: true, groupId: "group-b" },
    ];
    expect(resolveChannelFilterSelection(duplicatedIdChannels, { channelId: "channel-a" })).toEqual({
      normalizedName: undefined,
      unresolvedLegacyChannelId: "channel-a",
      blockResults: true,
    });
  });

  it("maps every dashboard filter into the recent activity query", () => {
    expect(buildRecentActivityFilters({
      groupIds: ["group-a", "group-b"],
      memberId: "member-a",
      normalizedName: " 抖音直播 ",
      sourceDateFrom: "2026-08-01",
      sourceDateTo: "2026-08-10",
      occurredDateFrom: "2026-08-08",
      occurredDateTo: "2026-08-09",
    })).toEqual({
      enteredById: "member-a",
      occurredOn: { gte: "2026-08-08", lte: "2026-08-09" },
      batch: {
        groupId: { in: ["group-a", "group-b"] },
        sourceDate: { gte: "2026-08-01", lte: "2026-08-10" },
        channel: { normalizedName: "抖音直播" },
      },
    });
  });

  it("caps dashboard event filters at today even when a future end date is requested", () => {
    expect(buildRecentActivityFilters({
      groupIds: ["group-a"],
      occurredDateFrom: "2026-08-10",
      occurredDateTo: "2026-08-20",
      today: "2026-08-11",
    })).toMatchObject({ occurredOn: { gte: "2026-08-10", lte: "2026-08-11" } });
  });
});
