import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("lead workflow navigation consolidation", () => {
  it("keeps the compact sidebar and exposes炒群明细 and expert management directly", () => {
    const navigation = read("src/lib/app-navigation.ts");
    for (const label of ["组长工作台", "炒群明细", "设备账号", "团队表现", "渠道与批次", "组员管理", "专家管理"]) expect(navigation).toContain(label);
    const tabs = read("src/components/lead/LeadWorkspaceTabs.tsx");
    for (const label of ["接粉明细", "炒群明细", "专家与开单", "数据汇总", "完整榜单", "成员每日明细", "渠道表现", "批次追踪"]) expect(tabs).toContain(label);
  });

  it("redirects the removed customer-conversion route to炒群明细 so old bookmarks remain usable", () => {
    const page = read("src/app/(app)/customer-conversion/page.tsx");
    expect(page).toContain('redirect(query ? `/group-customers?${query}` : "/group-customers")');
    expect(page).toContain("URLSearchParams");
  });

  it("keeps reception details as a no-phone member summary and keeps group customers separate", () => {
    const overview = read("src/app/(app)/group-customers/page.tsx");
    expect(overview).toContain("查看本组全部炒群客户");
    expect(overview).toContain("GroupCustomerTable");
    expect(overview).toContain("const selectedGroupId = isManager");
    expect(overview).toContain("groupId: selectedGroupId");

    const reception = read("src/components/lead/ReceptionPerformanceTable.tsx");
    expect(reception).toContain("不展示客户电话号码");
    expect(reception).not.toContain("已进群号码");
    expect(reception).not.toContain("查看客户");
    const groupOperator = read("src/components/lead/GroupOperatorPerformanceTable.tsx");
    expect(groupOperator).toContain("已推专家号码");
  });

  it("gives company and headquarters a read-only group and expert view with scoped group filters", () => {
    const access = read("src/lib/role-access.ts");
    const groupPage = read("src/app/(app)/group-customers/page.tsx");
    const expertPage = read("src/app/(app)/expert-customers/page.tsx");
    const expertTable = read("src/components/lead/ExpertCustomerTable.tsx");
    const rankingsPage = read("src/app/(app)/role-rankings/page.tsx");

    expect(access).toContain('groupCustomerPageRoles = ["ADMIN", "COMPANY_MANAGER", "LEAD", "GROUP_OPERATOR"]');
    expect(access).toContain('expertCustomerPageRoles = ["ADMIN", "COMPANY_MANAGER", "LEAD", "EXPERT"]');
    for (const page of [groupPage, expertPage]) {
      expect(page).toContain("resolveReadableReportGroups");
      expect(page).toContain('aria-label="筛选小组"');
    }
    expect(groupPage).toContain("canEdit={isLead || isGroupOperator}");
    expect(expertPage).toContain("canEdit={isLead || isExpert}");
    expect(expertTable).toContain("customer.expertOwnerName");
    expect(rankingsPage).toContain('user.role !== "COMPANY_MANAGER"');
    expect(rankingsPage).toContain("resolveReadableReportGroups(user, allGroups)");
  });

  it("applies the compact table layout across lead workspaces", () => {
    const styles = read("src/app/globals.css");
    expect(styles).toContain("组长业务页：统一紧凑表格与列表布局");
    expect(styles).toContain("main.page-shell:has(.lead-workspace-tabs)");
    expect(styles).toContain(".lead-date-toolbar");
    expect(styles).toContain(".lead-follow-up-table");
  });

  it("keeps group and expert actions visible while their wide tables scroll", () => {
    const styles = read("src/app/globals.css");
    const groupCustomers = read("src/components/lead/GroupCustomerDataTable.tsx");
    const expertCustomers = read("src/components/lead/ExpertCustomerDataTable.tsx");

    expect(groupCustomers).toContain("lead-customer-wide-table");
    expect(expertCustomers).toContain("lead-customer-wide-table");
    expect(styles).toContain(".lead-customer-wide-table th:last-child");
    expect(styles).toContain("position: sticky");
    expect(styles).toContain("right: 0");
  });
});
