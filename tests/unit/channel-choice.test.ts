import { describe, expect, it } from "vitest";
import { canOfferChannelCreation, channelQueryAfterSearchBlur, channelQueryForChoice, chooseExistingChannel, requiresChannelGroup, typeNewChannel } from "../../src/components/entry/ChannelCombobox";

describe("channel choice", () => {
  it("keeps only the selected existing channel after replacing a typed name", () => {
    expect(chooseExistingChannel({ channelName: "临时渠道" }, "channel-1")).toEqual({ channelId: "channel-1" });
  });

  it("keeps only the typed name after replacing an existing channel", () => {
    expect(typeNewChannel({ channelId: "channel-1" }, "新渠道")).toEqual({ channelName: "新渠道" });
  });

  it("does not offer creating a new channel when the setting is disabled", () => {
    expect(canOfferChannelCreation("新渠道", [], false)).toBe(false);
    expect(canOfferChannelCreation("新渠道", [], true)).toBe(true);
  });

  it("clears the display query when an external group change clears the channel choice", () => {
    const channels = [{ id: "channel-a", name: "A 组渠道", groupId: "group-a" }];
    expect(channelQueryForChoice({ channelId: "channel-a" }, channels)).toBe("A 组渠道");
    expect(channelQueryForChoice({}, channels)).toBe("");
  });

  it("requires administrators to select a group before choosing a channel", () => {
    expect(requiresChannelGroup(true, "")).toBe(true);
    expect(requiresChannelGroup(true, "group-a")).toBe(false);
    expect(requiresChannelGroup(false, "")).toBe(false);
  });

  it("restores the selected channel or blank after a search-only field loses focus", () => {
    const channels = [{ id: "channel-a", name: "已有渠道", groupId: "group-a" }];
    expect(channelQueryAfterSearchBlur("未选择的新名称", { channelId: "channel-a" }, channels, false)).toBe("已有渠道");
    expect(channelQueryAfterSearchBlur("未选择的新名称", {}, channels, false)).toBe("");
    expect(channelQueryAfterSearchBlur("可新建渠道", {}, channels, true)).toBe("可新建渠道");
  });
});
