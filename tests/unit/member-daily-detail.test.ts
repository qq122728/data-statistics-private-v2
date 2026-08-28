import { readFileSync } from "node:fs";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberDailyDetail } from "../../src/components/analytics/member/MemberDailyDetail";

const row = {
  date: "2026-08-18",
  added: 12,
  lowAmount: 2,
  noWs: 1,
  invalid: 1,
  valid: 8,
  replied: 4,
  joined: 2,
  left: 1,
  inGroup: 8,
  eligibleForExpert: 5,
  introduced: 3,
  contacted: 4,
  registered: 2,
  ordered: 1,
  depositCents: 500000,
  withdrawalCents: 125000,
  netCents: 375000,
};

describe("member daily detail", () => {
  it("uses the reception metric names as plain daily activity counts, with no misleading same-day rate columns", () => {
    const html = renderToStaticMarkup(createElement(MemberDailyDetail, { detail: { member: { id: "r", name: "接粉 A", role: "RECEPTION", groupName: "A 组" }, from: row.date, to: row.date, rows: [row] } }));
    for (const label of ["添加数据", "撞粉", "低金额", "无 WS 号码", "有效数据", "回复", "进群"]) expect(html).toContain(label);
    expect(html).not.toContain("人工无效");
    // 回复/进群按事件发生日归类，跟"添加"的导入日不是同一批人，不能包装成百分比展示。
    expect(html).not.toContain("回复率");
    expect(html).not.toContain("进群率");
    expect(html).toContain("添加与有效数据按导入日统计；回复、进群按实际发生日统计。");
  });

  it("shows the operator's raw daily counts without a same-day abnormal-leave or day-3 introduction rate", () => {
    const html = renderToStaticMarkup(createElement(MemberDailyDetail, { detail: { member: { id: "o", name: "炒群 A", role: "GROUP_OPERATOR", groupName: "A 组" }, from: row.date, to: row.date, rows: [row] } }));
    expect(html).not.toContain("异常退群率");
    expect(html).not.toContain("第3天推专家率");
    expect(html).toContain("已进群满 2 天、当天仍在群且尚未推专家");
  });

  it("makes expert net performance a funds-only number, with no same-day registration or order rate", () => {
    const html = renderToStaticMarkup(createElement(MemberDailyDetail, { detail: { member: { id: "e", name: "专家 A", role: "EXPERT", groupName: "A 组" }, from: row.date, to: row.date, rows: [row] } }));
    expect(html).toContain("净业绩 = 入金 − 出金。");
    expect(html).toContain("$3,750.00");
    expect(html).not.toContain("注册率");
    expect(html).not.toContain("开单率");
  });

  it("allows a manager to select the matching role member and defaults to the current real month", () => {
    const source = readFileSync("src/app/(app)/anomaly-ranking/page.tsx", "utf8");
    expect(source).toContain('roleAssignments: { some: { role: dailyRole } }');
    expect(source).toContain('memberEmptyLabel={dailyRole ? "请选择成员" : undefined}');
    expect(source).toContain("先选择岗位，再在下方选择成员");
    expect(source).toContain("请先在上方选择成员");
    expect(source).not.toContain("前往完整榜单");
    expect(source).toContain('member: Boolean(dailyRole) || activeTab === "risk"');
    expect(source).toContain('resolveDateRangeWithDefault(rawValues, today, "month")');
    expect(source).toContain('<LeadDateRangeFilter');
    expect(source).toContain('period: "custom" as const');
    expect(source).toContain('user.role !== "RESOURCE_MANAGER"');
    expect(source).toContain('user.role !== "COMPANY_MANAGER"');
  });

  it("does not subtract data cost from daily net performance", () => {
    const source = readFileSync("src/lib/analytics/member-daily-detail.ts", "utf8");
    expect(source).toContain("row.netCents = row.depositCents - row.withdrawalCents");
  });

  it("allows a dual-role member to load the daily detail for the selected role", () => {
    const source = readFileSync("src/lib/analytics/member-daily-detail.ts", "utf8");
    expect(source).toContain('roleAssignments: { some: { role: input.role } }');
    expect(source).toContain('input.role === "EXPERT" ? [{ role: "LEAD" as const }]');
  });
});
