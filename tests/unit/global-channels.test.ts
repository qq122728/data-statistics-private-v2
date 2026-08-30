import { describe, expect, it, vi } from "vitest";
import { copyGlobalChannelsToGroup } from "../../src/lib/global-channels";

describe("copyGlobalChannelsToGroup", () => {
  it("copies each channel identity and normalized name only once when historical copies drifted", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const client = {
      channel: {
        findMany: vi.fn().mockResolvedValue([
          { id: "shared-id", name: "旧名称", normalizedName: "旧名称", active: true, createdById: null, channelType: "ADS" },
          { id: "shared-id", name: "新名称", normalizedName: "新名称", active: true, createdById: null, channelType: "ADS" },
          { id: "second-id", name: "旧名称", normalizedName: "旧名称", active: true, createdById: null, channelType: "SMS" },
          { id: "third-id", name: "第三渠道", normalizedName: "第三渠道", active: true, createdById: null, channelType: "REBATE" },
        ]),
        createMany,
      },
      teamGroup: {},
    };

    await expect(copyGlobalChannelsToGroup(client as never, "new-group")).resolves.toBe(2);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ id: "shared-id", normalizedName: "旧名称", groupId: "new-group" }),
        expect.objectContaining({ id: "third-id", normalizedName: "第三渠道", groupId: "new-group" }),
      ],
    });
  });
});
