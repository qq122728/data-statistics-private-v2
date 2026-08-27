import { describe, expect, it } from "vitest";
import { expandResourceChannelIdsByType, getResourceChannelTypes } from "../../src/lib/resource-channel-access";

const channels = [
  { id: "sms-a", channelType: "SMS" as const },
  { id: "sms-b", channelType: "SMS" as const },
  { id: "ads-a", channelType: "ADS" as const },
  { id: "ads-b", channelType: "ADS" as const },
  { id: "rebate-a", channelType: "REBATE" as const },
];

describe("resource channel type access", () => {
  it("expands one persisted channel into every channel of the same type", () => {
    expect(getResourceChannelTypes(channels, ["ads-a"])).toEqual(["ADS"]);
    expect(expandResourceChannelIdsByType(channels, ["ads-a"])).toEqual(["ads-a", "ads-b"]);
  });

  it("keeps SMS, ads and rebate permissions isolated", () => {
    expect(expandResourceChannelIdsByType(channels, ["sms-b", "rebate-a"])).toEqual(["sms-a", "sms-b", "rebate-a"]);
    expect(expandResourceChannelIdsByType(channels, ["missing"])).toEqual([]);
  });
});
