import { describe, expect, it } from "vitest";
import { intakeQuality } from "../../src/lib/intake-quality";

const row = (intakeOn: string, firstDepositOn?: string, extra: Record<string, unknown> = {}) => ({
  groupId: "group-a",
  data: JSON.stringify({ intakeOn, channelId: "channel-a", quality: "有效", firstDeposit: firstDepositOn ? 100 : 0, firstDepositOn, ...extra }),
});

describe("接粉批次开单率", () => {
  it("只比较两段中均已满观察天数的接粉日期，并按接粉后开单时间计入", () => {
    const result = intakeQuality([
      row("2026-10-01", "2026-10-05"),
      row("2026-10-03", "2026-10-11"), // 已满7天，但第8天才开单
      row("2026-10-05", "2026-10-06"), // 截至10月10日尚未满7天
      row("2026-09-20", "2026-09-25"), // 与10月1日对齐的上期接粉
      row("2026-09-24", "2026-09-25"), // 与10月5日对齐，未纳入比较
      row("2026-10-01", "2026-10-03", { quality: "撞粉" }),
      row("2026-10-01", "2026-10-03", { __deletedAt: "2026-10-04" }),
    ], new Set(["group-a"]), "2026-10-01", "2026-10-11", "2026-10-10");
    expect(result.previousFrom).toBe("2026-09-20");
    expect(result.previousTo).toBe("2026-09-30");
    expect(result.rows).toEqual([{
      groupId: "group-a",
      sevenDay: { current: { eligible: 2, ordered: 1 }, previous: { eligible: 1, ordered: 1 } },
      thirtyDay: { current: { eligible: 0, ordered: 0 }, previous: { eligible: 0, ordered: 0 } },
    }]);
  });

  it("满30天后才显示30天转化，并沿用调组前的统计归属", () => {
    const result = intakeQuality([
      { ...row("2026-09-01", "2026-09-25", { __statisticsGroupId: "group-a" }), groupId: "group-b" },
      row("2026-08-02", "2026-09-01"),
    ], new Set(["group-a"]), "2026-09-01", "2026-09-30", "2026-10-11");
    expect(result.rows[0].thirtyDay.current).toEqual({ eligible: 1, ordered: 1 });
    expect(result.rows[0].thirtyDay.previous).toEqual({ eligible: 1, ordered: 1 });
  });
});
