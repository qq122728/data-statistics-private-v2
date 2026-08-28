import { describe, expect, it } from "vitest";
import { expertCohortFunnel, operatorCohortFunnel, type PersonalLead } from "../../src/app/(app)/personal-data/page";
import type { LeadDateRange } from "../../src/lib/lead-date-range";

const range = (from: string, to: string): LeadDateRange => ({ preset: "custom", from, to, label: "自定义" });

function lead(overrides: Partial<PersonalLead>): PersonalLead {
  return {
    isHistoricalRecord: false,
    invalid: false,
    receptionCategory: "VALID",
    repliedOn: null,
    joinedOn: null,
    leftOn: null,
    groupStatus: "NOT_JOINED",
    expertIntroducedOn: null,
    expertContactedOn: null,
    registeredOn: null,
    expertStalledOn: null,
    noInitialDepositOn: null,
    batch: { sourceDate: "2026-08-01", isHistoricalRecord: false },
    customerOrder: null,
    ...overrides,
  };
}

describe("个人数据页转化率同批口径", () => {
  it("组长推专家率：分子分母都来自本区间进群的同一批客户", () => {
    const leads = [
      // 区间内进群，区间截止前推了专家——计入分子和分母
      lead({ joinedOn: "2026-08-05", expertIntroducedOn: "2026-08-10" }),
      // 区间内进群，还没推专家——只计入分母
      lead({ joinedOn: "2026-08-06", expertIntroducedOn: null }),
      // 区间内进群，但推专家动作发生在区间截止之后——按截止日评估，不计入分子
      lead({ joinedOn: "2026-08-07", expertIntroducedOn: "2026-09-01" }),
      // 早于区间进群——不属于这批人，不计入分母（即使区间内被推了专家）
      lead({ joinedOn: "2026-07-20", expertIntroducedOn: "2026-08-08" }),
    ];
    const result = operatorCohortFunnel(leads, range("2026-08-01", "2026-08-31"));
    expect(result).toEqual({ cohortSize: 3, introduced: 1 });
  });

  it("专家联系率/注册率/开单率：每一步分母都来自本区间被推给我的同一批客户", () => {
    const leads = [
      // 区间内被推给我，联系、注册、开单全部在截止日前完成
      lead({
        expertIntroducedOn: "2026-08-03",
        expertContactedOn: "2026-08-04",
        registeredOn: "2026-08-05",
        customerOrder: { openedOn: "2026-08-06", initialDepositCents: 10000, voidedAt: null, events: [] },
      }),
      // 区间内被推给我，只联系了，没注册
      lead({ expertIntroducedOn: "2026-08-10", expertContactedOn: "2026-08-11" }),
      // 区间内被推给我，联系动作发生在截止日之后——按截止日评估不算
      lead({ expertIntroducedOn: "2026-08-20", expertContactedOn: "2026-09-01" }),
      // 早于区间被推给我——不属于这批人
      lead({ expertIntroducedOn: "2026-07-01", expertContactedOn: "2026-08-05", registeredOn: "2026-08-06" }),
    ];
    const result = expertCohortFunnel(leads, range("2026-08-01", "2026-08-31"));
    expect(result).toEqual({ cohortSize: 3, contacted: 2, registered: 1, orders: 1 });
  });
});
