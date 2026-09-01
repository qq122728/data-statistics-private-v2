import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { localDateYYYYMMDD } from "../../src/lib/dates";

describe("财务日报按小组时区切日", () => {
  it("同一时刻在中国已是次日，在美国小组仍属于前一天", () => {
    const instant = new Date("2026-09-01T02:00:00.000Z");
    expect(localDateYYYYMMDD(instant, "Asia/Shanghai")).toBe("2026-09-01");
    expect(localDateYYYYMMDD(instant, "America/New_York")).toBe("2026-08-31");
  });

  it("财务页面按选中小组决定默认日期，切换小组时同步切换当地今天", () => {
    const page = readFileSync("src/app/(app)/finance-reports/page.tsx", "utf8");
    const toolbar = readFileSync("src/components/finance/FinanceDailyReportToolbar.tsx", "utf8");
    expect(page).toContain("const selectedTimezone");
    expect(page).toContain("readableTimezones.length === 1 ? readableTimezones[0] : accountTimezone");
    expect(page).toContain("localDateYYYYMMDD(new Date(), selectedTimezone)");
    expect(toolbar).toContain("localDateYYYYMMDD(new Date(), nextTimezone)");
    expect(toolbar).toContain("按 {timezone} 切日");
  });
});
