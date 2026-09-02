import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { allocateCustomerStageNumber, formatCustomerStageNumber, parseCustomerStageNumberQuery } from "../../src/lib/customer-stage-number";

describe("客户阶段日期编号", () => {
  it("按阶段、月、日和三位流水号显示", () => {
    expect(formatCustomerStageNumber("GROUP", "2026-09-01", 1)).toBe("G-9-1-001");
    expect(formatCustomerStageNumber("EXPERT", "2026-09-01", 12)).toBe("E-9-1-012");
    expect(formatCustomerStageNumber("REGISTRATION", "2026-09-02", 3)).toBe("R-9-2-003");
    expect(formatCustomerStageNumber("ORDER", "2026-09-02", 4)).toBe("O-9-2-004");
    expect(formatCustomerStageNumber("LEAVE", "2026-09-02", 5)).toBe("L-9-2-005");
  });

  it("能解析新版编号，并兼容旧 G/E 编号搜索", () => {
    expect(parseCustomerStageNumberQuery("g-9-1-001")).toEqual({ prefix: "G", month: 9, day: 1, value: 1 });
    expect(parseCustomerStageNumberQuery("O-9-2-014")).toEqual({ prefix: "O", month: 9, day: 2, value: 14 });
    expect(parseCustomerStageNumberQuery("E-007")).toEqual({ prefix: "E", month: null, day: null, value: 7 });
    expect(parseCustomerStageNumberQuery("G-13-1-001")).toBeNull();
  });

  it("同组同日递增，换日期和换阶段都重新从 001 开始", async () => {
    const groupId = `stage-test-${randomUUID()}`;
    const values = await db.$transaction(async (tx) => [
      await allocateCustomerStageNumber(tx, groupId, "GROUP", "2026-09-01"),
      await allocateCustomerStageNumber(tx, groupId, "GROUP", "2026-09-01"),
      await allocateCustomerStageNumber(tx, groupId, "GROUP", "2026-09-02"),
      await allocateCustomerStageNumber(tx, groupId, "EXPERT", "2026-09-01"),
    ]);
    expect(values).toEqual([1, 2, 1, 1]);
    await db.customerDailyStageSequence.deleteMany({ where: { groupId } });
  });
});
