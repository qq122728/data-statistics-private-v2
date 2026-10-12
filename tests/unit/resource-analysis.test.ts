import { describe, expect, it } from "vitest";
import { analyzeResources, type AnalysisRow, renderAnalysis } from "../../src/lib/resource-bot/analysis";
import { analysisWorkbook } from "../../src/lib/resource-bot/analysis-workbook";
import { enforceHermesScope } from "../../src/lib/resource-bot/hermes";
import { querySchema } from "../../src/lib/resource-bot/query";
import { mentionsQueryName } from "../../src/lib/resource-bot/query-names";
const extras = { pending: 0, ambiguous: 0, spendRecords: 0, importCount: 0 };
const r = (data: AnalysisRow["data"], more: Partial<AnalysisRow> = {}): AnalysisRow => ({ id: "r", phone: "00123456789", group: "测试组", channel: "FB-Q", channelId: "q", buyer: "QQ", country: "DE", material: "", type: "ADS", attributed: true, data, ...more });
const entries = (...items: Array<[string, number, string?]>) => JSON.stringify(items.map(([date, amountCents, kind], i) => ({ id: String(i), date, amountCents, kind: kind || "recharge" })));
const october = { from: "2026-10-01", to: "2026-10-12" };

describe("resource analysis accounting and warning gates", () => {
  it("keeps intake, opening cohort and cash dates distinct, without recounting orders", () => {
    const a = analyzeResources([
      r({ intakeOn: "2026-08-01", firstDepositOn: "2026-09-02", firstDeposit: 100, __recharges: entries(["2026-09-10", 5000], ["2026-10-02", 30000], ["2026-10-03", 2000, "withdrawal"], ["2026-10-13", 99999]) }),
      r({ intakeOn: "2026-09-01", firstDepositOn: "2026-10-04", firstDeposit: 200, __recharges: entries(["2026-10-08", 10000]) }, { id: "new", attributed: false, buyer: "" }),
      r({ intakeOn: "2026-07-01", __recharges: entries(["2026-10-05", 7000]) }, { id: "unknown", attributed: false, buyer: "" }),
    ], october, extras);
    expect(a.totals).toMatchObject({ firstCents: 20000, rechargeCents: 47000, withdrawalCents: 2000, netCents: 65000, newOrders: 1 });
    expect(a.buckets["上月开单"].netCents).toBe(28000);
    expect(a.buckets["本月开单"].netCents).toBe(30000);
    expect(a.buckets["开单日期缺失或矛盾"].netCents).toBe(7000);
    expect(a.attribution["未归属或归属冲突"].netCents).toBe(37000);
    expect(a.previous.netCents).toBe(15000);
    expect(a.coverage.eventsAfterCutoffExcluded).toBe(1);
    expect(Object.values(a.buckets).reduce((n,c)=>n+c.netCents,0)).toBe(a.totals.netCents);
  });
  it("excludes missing and impossible dates, flags them instead of pretending zero performance", () => {
    const a = analyzeResources([r({ firstDeposit: 10, __recharges: entries(["", 3000], ["2026-02-30", 2000], ["2026-10-02", 5000]) })], october, extras);
    expect(a.totals.netCents).toBe(5000);
    expect(a.coverage.missingFirstDateCents).toBe(1000);
    expect(a.coverage.undatedRechargeCents).toBe(5000);
    expect(a.warnings.some(w=>w.key==="opening-data")).toBe(true);
  });
  it("only includes complete 7/30/60 day windows and ignores later recharges", () => {
    const a = analyzeResources([r({ firstDepositOn: "2026-10-06", firstDeposit: 100, __recharges: entries(["2026-10-12", 500], ["2026-10-13", 99999]) })], october, extras, "2026-10-11");
    expect(a.maturity.find(c=>c.windowDays===7)).toMatchObject({ eligible: 0, immature: 1, renewed: 0 });
    const b = analyzeResources([r({ firstDepositOn: "2026-09-01", firstDeposit: 100, __recharges: entries(["2026-09-07", 500], ["2026-09-08", 1000], ["2026-10-01", 2000]) })], october, extras);
    expect(b.maturity.find(c=>c.windowDays===7)).toMatchObject({ eligible: 1, rechargeCents: 500, renewed: 1 });
    expect(b.maturity.find(c=>c.windowDays===30)).toMatchObject({ eligible: 1, rechargeCents: 1500 });
    expect(b.maturity.find(c=>c.windowDays===60)).toMatchObject({ eligible: 0, immature: 1 });
  });
  it("trims both comparison windows for unequal month lengths", () => {
    const a=analyzeResources([], {from:"2026-03-01",to:"2026-03-31"}, extras);
    expect(a.comparisonRange).toEqual({currentFrom:"2026-03-01",currentTo:"2026-03-28",previousFrom:"2026-02-01",previousTo:"2026-02-28"});
    expect(()=>analyzeResources([], {from:"2026-09-01",to:"2026-10-12"},extras)).toThrow(/自然月/);
  });
  it("warns on same-age decline only with sufficient comparable samples", () => {
    const make = (n:number, missing=false) => [
      ...Array.from({length:n},(_,i)=>r({intakeOn:"2026-09-25", repliedOn: i<5 ? "2026-09-26" : "", ...(missing ? {replied:true} : {})},{id:"new"+i})),
      ...Array.from({length:n},(_,i)=>r({intakeOn:"2026-09-10", repliedOn:"2026-09-11"},{id:"old"+i})),
    ];
    expect(analyzeResources(make(30),october,extras).warnings.some(w=>w.title.includes("回复率下降"))).toBe(true);
    expect(analyzeResources(make(5),october,extras).warnings.some(w=>w.key.startsWith("trend:"))).toBe(false);
    expect(analyzeResources(make(30,true),october,extras).warnings.some(w=>w.title.includes("回复率下降"))).toBe(false);
    expect(analyzeResources(make(30).map(r=>({...r,country:""})),october,extras).warnings.some(w=>w.key.startsWith("trend:"))).toBe(false);
  });
  it("does not assert budget changes or continuous deterioration from one snapshot", () => {
    const a=analyzeResources([],october,{...extras,spendRecords:12});
    expect(a.rules).toMatchObject({sustainedDeclineVerified:false,budgetAutomation:false});
    expect(a.warnings.find(w=>w.key==="spend")?.evidence).toContain("完整性");
    expect(renderAnalysis(a,"测试")).toContain("未自动调整预算");
  });
  it("keeps analysis intent and SMS restrictions in the real authorization layer", () => {
    const c={channels:["FB-Q"],buyers:["QQ"],materials:[],groups:[]};
    expect(enforceHermesScope(querySchema.parse({view:"analysis"}),"本月投手效果分析日报",c).view).toBe("analysis");
    expect(()=>enforceHermesScope(querySchema.parse({view:"analysis",dimension:"material"}),"短信素材分析",c)).toThrow(/短信/);
  });
  it("does not turn Excel into buyer C and keeps an explicit SMS-only followup", () => {
    const c={channels:["FB-Q"],buyers:["C","QQ","QQ1"],materials:[],groups:[]};
    expect(mentionsQueryName("导出 Excel", "C")).toBe(false);
    expect(mentionsQueryName("查QQ1的粉", "QQ")).toBe(false);
    expect(mentionsQueryName("查QQ1的粉", "QQ1")).toBe(true);
    const q=enforceHermesScope(querySchema.parse({view:"effects",type:"ALL"}),"短信分析日报，导出 Excel。不看投流",c);
    expect(q).toMatchObject({view:"analysis",type:"SMS",buyer:""});
    expect(()=>enforceHermesScope(querySchema.parse({view:"analysis",buyer:"C"}),"导出 Excel",c)).toThrow(/不能确认/);
  });
  it("exports real money and string phone identifiers, including unknown ownership", async () => {
    const a=analyzeResources([r({intakeOn:"2026-09-01",firstDeposit:25,firstDepositOn:"2026-10-01"},{attributed:false,buyer:""})],october,extras);
    const book=analysisWorkbook(a,"测试范围");
    expect(book.getWorksheet("本期资金号码")!.getCell("A2").value).toBe("00123456789");
    expect(book.getWorksheet("本期资金号码")!.getCell("L2").value).toBe(25);
    expect(book.getWorksheet("本期资金号码")!.getCell("D2").value).toBe("未归属");
    expect((await book.xlsx.writeBuffer()).byteLength).toBeGreaterThan(1000);
  });
});
