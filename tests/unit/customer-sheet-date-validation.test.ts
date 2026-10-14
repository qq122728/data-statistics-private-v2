import { describe, expect, it } from "vitest";
import { normalize, prepareNumberData } from "../../src/lib/customer-sheet";

const intakeColumn = [{ id: "intakeOn", name: "接粉日期", kind: "date", stage: "base" }];

describe("客户接粉日期", () => {
  it("拦住导入时误写成 1902 年的日期，避免客户从当天列表消失", async () => {
    await expect(normalize({} as never, "group", { intakeOn: "1902-10-13" }, intakeColumn))
      .rejects.toThrow("接粉日期的年份是 1902");
    await expect(normalize({} as never, "group", { intakeOn: "2026-10-13" }, intakeColumn))
      .resolves.toMatchObject({ intakeOn: "2026-10-13" });
  });
});

describe("首充自动补注册", () => {
  it("有首充但漏点注册时，按首充日期补记；已有真实注册日期保留", () => {
    const missingRegistration = {
      intakeOn: "2026-09-01", channelId: "channel", joinedOn: "2026-09-02",
      expertOn: "2026-09-03", firstDeposit: 100, firstDepositOn: "2026-09-04",
    };
    prepareNumberData(missingRegistration);
    expect(missingRegistration).toMatchObject({ registeredOn: "2026-09-04" });

    const registeredEarlier = { ...missingRegistration, registeredOn: "2026-09-03" };
    prepareNumberData(registeredEarlier);
    expect(registeredEarlier.registeredOn).toBe("2026-09-03");
  });

  it("首充日期早于推专家时不自动生成矛盾的注册记录", () => {
    expect(() => prepareNumberData({
      intakeOn: "2026-09-01", channelId: "channel", joinedOn: "2026-09-02",
      expertOn: "2026-09-04", firstDeposit: 100, firstDepositOn: "2026-09-03",
    })).toThrow("加专家日期");
  });

  it("黑客组缺推专家日期时拦住注册和首充，退群记录不妨碍后续跟进", () => {
    const base = {
      intakeOn: "2026-09-01", channelId: "channel", joinedOn: "2026-09-02",
      normalLeft: true, normalLeftOn: "2026-09-03",
    };
    expect(() => prepareNumberData({ ...base, registeredOn: "2026-09-04" }, {}, true))
      .toThrow("请先填写推专家日期");
    expect(() => prepareNumberData({ ...base, firstDeposit: 100, firstDepositOn: "2026-09-04" }, {}, true))
      .toThrow("请先填写推专家日期");
    const completed = { ...base, expertOn: "2026-09-04", firstDeposit: 100, firstDepositOn: "2026-09-04" };
    prepareNumberData(completed, {}, true);
    expect(completed).toMatchObject({ registeredOn: "2026-09-04" });
  });
});
