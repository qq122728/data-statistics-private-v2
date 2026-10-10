import { describe, expect, it } from "vitest";
import { revisionForNumberTracking } from "../../src/lib/customer-number-tracking";

describe("号码自动统计汇总", () => {
  const revision = { joinCount: 3, expertIntroCount: 2, registrationCount: 1, orderCount: 1 };
  const scope = { businessDate: "2026-10-10", position: "RECEPTION", groupType: "HACKER" };

  it("保留号码自动统计行的后续进度", () => {
    expect(revisionForNumberTracking(revision, { ...scope, sourceMode: "NUMBER" })).toEqual(revision);
  });

  it("仍屏蔽旧手填行的后续进度", () => {
    expect(revisionForNumberTracking(revision, { ...scope, sourceMode: "MANUAL" })).toEqual({
      joinCount: 0, expertIntroCount: 0, registrationCount: 0, orderCount: 0,
      operatorReceivedCount: 0, normalLeaveCount: 0, abnormalLeaveCount: 0,
      currentInGroupCount: 0, expertReceivedCount: 0, expertContactedCount: 0,
    });
  });
});
