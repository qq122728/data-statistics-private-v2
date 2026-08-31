import { describe, expect, it } from "vitest";
import { getResourceChannelTypes } from "../../src/lib/resource-channel-access";

const channels = [
  { id: "sms-a", channelType: "SMS" as const },
  { id: "sms-b", channelType: "SMS" as const },
  { id: "ads-a", channelType: "ADS" as const },
  { id: "ads-b", channelType: "ADS" as const },
  { id: "rebate-a", channelType: "REBATE" as const },
];

describe("resource channel type classification", () => {
  it("classifies assigned channels without granting another same-type channel", () => {
    expect(getResourceChannelTypes(channels, ["ads-a"])).toEqual(["ADS"]);
  });

  it("returns only the types represented by explicitly assigned ids", () => {
    expect(getResourceChannelTypes(channels, ["sms-b", "rebate-a"])).toEqual(["SMS", "REBATE"]);
    expect(getResourceChannelTypes(channels, ["missing"])).toEqual([]);
  });
});
