import { describe, expect, it } from "vitest";
import { sheetActiveAssignee } from "../../packages/customer-sheet/active-assignee";
import type { SheetData } from "../../packages/customer-sheet/schema";

describe("current sheet customer workload", () => {
  it("counts one responsible person as a customer advances", () => {
    expect(sheetActiveAssignee("front", {})).toBe("front");
    expect(sheetActiveAssignee("front", { joinedOn: "2025-04-03", operatorId: "group" })).toBe("group");
    expect(sheetActiveAssignee("front", { joinedOn: "2025-04-03", operatorId: "group", expertId: "expert" })).toBe("expert");
    expect(sheetActiveAssignee("front", { joinedOn: "2025-04-03" })).toBe("front");
  });
  it("excludes closed, paused, exited and invalid customers", () => {
    const inactive: SheetData[] = [{normalLeft:true}, {abnormalLeft:true}, {expertMode:"暂停跟进"}, {expertMode:"已结束"}, {quality:"撞粉"}, {quality:"人工无效"}];
    for (const data of inactive) {
      expect(sheetActiveAssignee("front", data)).toBeNull();
    }
    expect(sheetActiveAssignee("front", {expertId:"expert",firstDeposit:100,quality:"有效"})).toBe("expert");
  });
});
