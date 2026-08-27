export type AppNavigationRole = "ADMIN" | "RESOURCE_MANAGER" | "COMPANY_MANAGER" | "FINANCE" | "HR" | "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
export type AppNavigationRoles = AppNavigationRole | readonly AppNavigationRole[];

export type VisibleAppNavigationItem = {
  href:
    | "/dashboard"
    | "/device-accounts"
    | "/entry"
    | "/entry?workspace=intake"
    | "/entry?workspace=handoff"
    | "/entry?tab=invalid"
    | "/attendance"
    | "/notifications"
    | "/history"
    | "/reports"
    | "/personal-data"
    | "/team-members"
    | "/admin"
    | "/admin?section=departments"
    | "/company-organization"
    | "/team-performance"
    | "/group-daily-detail"
    | "/channel-analysis"
    | "/anomaly-ranking"
    | "/anomaly-ranking?tab=reception"
    | "/anomaly-ranking?tab=risk"
    | "/batch-tracking"
    | "/group-customers"
    | "/expert-customers"
    | "/customer-follow-up"
    | "/customer-timeline"
    | "/resource-conversion"
    | "/resource-channels"
    | "/performance-leaderboard"
    | "/management-rankings"
    | "/role-rankings"
    | "/finance-reports"
    | "/personnel";
  label:
    | "今日待办"
    | "工作台"
    | "管理概览"
    | "总公司工作台"
    | "资源工作台"
    | "公司工作台"
    | "组长工作台"
    | "接粉明细"
    | "客户跟进"
    | "接粉处理"
    | "接粉工作台"
    | "入群交接"
    | "号码查询"
    | "设备账号"
    | "上下班打卡"
    | "考勤管理"
    | "通知中心"
    | "数据录入"
    | "客户记录"
    | "历史记录"
    | "群内客户"
    | "炒群明细"
    | "专家客户情况"
    | "我的业绩"
    | "个人数据"
    | "转化报表"
    | "团队表现"
    | "公司数据汇总"
    | "数据汇总"
    | "小组每日明细"
    | "组员对比"
    | "渠道分析"
    | "渠道表现"
    | "渠道对比"
    | "渠道与批次"
    | "入群后跟进"
    | "无效粉审核"
    | "渠道与单价"
    | "精英榜"
    | "全部门完整榜单"
    | "组员数据总览"
    | "成员每日明细"
    | "风险预警"
    | "完整榜单"
    | "批次追踪"
    | "组员管理"
    | "专家管理"
    | "管理员中心"
    | "公司组织管理"
    | "财务报表"
    | "每日数据报表"
    | "人员档案";
};

export type AppNavigationSection = {
  label: string;
  items: VisibleAppNavigationItem[];
  /** Keep related destinations available without making the sidebar a long flat list. */
  collapsible?: boolean;
};

const memberNavigation: VisibleAppNavigationItem[] = [
  { href: "/device-accounts", label: "设备账号" },
  { href: "/attendance", label: "上下班打卡" },
  { href: "/notifications", label: "通知中心" },
  { href: "/entry?workspace=intake", label: "接粉工作台" },
  { href: "/personal-data", label: "个人数据" },
  { href: "/performance-leaderboard", label: "精英榜" },
];

const groupOperatorNavigation: VisibleAppNavigationItem[] = [
  { href: "/dashboard", label: "今日待办" },
  { href: "/device-accounts", label: "设备账号" },
  { href: "/attendance", label: "上下班打卡" },
  { href: "/notifications", label: "通知中心" },
  { href: "/group-customers", label: "群内客户" },
  { href: "/personal-data", label: "个人数据" },
  { href: "/performance-leaderboard", label: "精英榜" },
];

const expertNavigation: VisibleAppNavigationItem[] = [
  { href: "/dashboard", label: "今日待办" },
  { href: "/device-accounts", label: "设备账号" },
  { href: "/attendance", label: "上下班打卡" },
  { href: "/notifications", label: "通知中心" },
  { href: "/expert-customers", label: "专家客户情况" },
  { href: "/personal-data", label: "个人数据" },
  { href: "/performance-leaderboard", label: "精英榜" },
];

function frontlineDualRoleSections(roles: readonly AppNavigationRole[]): AppNavigationSection[] | null {
  const hasReception = roles.includes("RECEPTION");
  const hasGroupOperator = roles.includes("GROUP_OPERATOR");
  if (!hasReception || !hasGroupOperator) return null;

  return [
    {
      label: "日常工作",
      items: [
        { href: "/device-accounts", label: "设备账号" },
        { href: "/attendance", label: "上下班打卡" },
        { href: "/notifications", label: "通知中心" },
        { href: "/entry?workspace=intake", label: "接粉工作台" },
        { href: "/group-customers", label: "群内客户" },
      ],
    },
    {
      label: "数据分析",
      items: [
        { href: "/personal-data", label: "个人数据" },
        { href: "/performance-leaderboard", label: "精英榜" },
      ],
    },
  ];
}

const analysisItems: VisibleAppNavigationItem[] = [
  { href: "/performance-leaderboard", label: "精英榜" },
  { href: "/team-performance", label: "团队表现" },
  { href: "/channel-analysis", label: "渠道分析" },
  { href: "/role-rankings", label: "完整榜单" },
  { href: "/group-daily-detail", label: "小组每日明细" },
  { href: "/anomaly-ranking?tab=risk", label: "风险预警" },
  { href: "/batch-tracking", label: "批次追踪" },
];

function managementSections(role: "ADMIN" | "LEAD"): AppNavigationSection[] {
  if (role === "ADMIN") return [
    { label: "日常工作", items: [{ href: "/dashboard", label: "总公司工作台" }, { href: "/attendance", label: "上下班打卡" }, { href: "/notifications", label: "通知中心" }] },
    { label: "客户流程", collapsible: true, items: [
      { href: "/group-customers", label: "炒群明细" },
      { href: "/expert-customers", label: "专家管理" },
    ] },
    { label: "经营分析", collapsible: true, items: [
      { href: "/team-performance", label: "数据汇总" },
      { href: "/role-rankings", label: "完整榜单" },
      { href: "/group-daily-detail", label: "小组每日明细" },
    ] },
    { label: "渠道分析", collapsible: true, items: [
      { href: "/channel-analysis", label: "渠道表现" },
    ] },
    { label: "", items: [{ href: "/performance-leaderboard", label: "精英榜" }] },
    { label: "组织与系统", collapsible: true, items: [
      { href: "/admin?section=departments", label: "公司组织管理" },
      { href: "/admin", label: "管理员中心" },
      { href: "/device-accounts", label: "设备账号" },
    ] },
  ];
  return [
    {
      label: "日常工作",
      items:
        role === "LEAD"
          ? [
              { href: "/dashboard", label: "组长工作台" },
              { href: "/history", label: "接粉明细" },
              { href: "/entry?tab=invalid", label: "无效粉审核" },
              { href: "/expert-customers", label: "专家管理" },
              { href: "/group-customers", label: "炒群明细" },
              { href: "/customer-timeline", label: "号码查询" },
              { href: "/device-accounts", label: "设备账号" },
              { href: "/attendance", label: "上下班打卡" },
              { href: "/notifications", label: "通知中心" },
            ]
          : [],
    },
    {
      label: "数据分析",
      items:
        role === "LEAD"
          ? [
              { href: "/performance-leaderboard", label: "精英榜" },
              { href: "/team-performance", label: "团队表现" },
              { href: "/channel-analysis", label: "渠道与批次" },
              { href: "/anomaly-ranking?tab=risk", label: "风险预警" },
              { href: "/finance-reports", label: "每日数据报表" },
            ]
          : [],
    },
    {
      label: "人员管理",
      items: role === "LEAD"
        ? [
            { href: "/team-members", label: "组员管理" },
          ]
        : [{ href: "/admin", label: "管理员中心" }],
    },
  ];
}

export function getVisibleAppNavigationSections(
  roleInput: AppNavigationRoles,
): AppNavigationSection[] {
  const roles = Array.isArray(roleInput) ? roleInput : [roleInput];
  const dualRoleSections = frontlineDualRoleSections(roles);
  if (dualRoleSections) return dualRoleSections;
  const role = roles[0];
  if (!role) return [];
  if (role === "RESOURCE_MANAGER") return [
    { label: "日常工作", items: [{ href: "/dashboard", label: "资源工作台" }, { href: "/notifications", label: "通知中心" }] },
    { label: "数据分析", items: [
      { href: "/performance-leaderboard", label: "精英榜" },
      { href: "/channel-analysis", label: "渠道表现" },
      { href: "/resource-conversion", label: "入群后跟进" },
      { href: "/role-rankings", label: "完整榜单" },
      { href: "/anomaly-ranking", label: "成员每日明细" },
      { href: "/anomaly-ranking?tab=risk", label: "风险预警" },
    ] },
    { label: "资源管理", items: [{ href: "/resource-channels", label: "渠道与单价" }] },
  ];
  if (role === "COMPANY_MANAGER") return [
    { label: "", items: [{ href: "/dashboard", label: "公司工作台" }, { href: "/attendance", label: "上下班打卡" }, { href: "/notifications", label: "通知中心" }] },
    { label: "客户管理", collapsible: true, items: [
      { href: "/group-customers", label: "炒群明细" },
      { href: "/expert-customers", label: "专家管理" },
    ] },
    { label: "数据中心", collapsible: true, items: [
      { href: "/team-performance", label: "数据汇总" },
      { href: "/role-rankings", label: "完整榜单" },
      { href: "/group-daily-detail", label: "小组每日明细" },
    ] },
    { label: "渠道分析", collapsible: true, items: [
      { href: "/channel-analysis", label: "渠道表现" },
    ] },
    { label: "", items: [{ href: "/performance-leaderboard", label: "精英榜" }] },
    { label: "资源设置", items: [{ href: "/resource-channels", label: "渠道与单价" }] },
    { label: "", items: [{ href: "/company-organization", label: "公司组织管理" }] },
  ];
  if (role === "FINANCE") return [
    { label: "数据查看", items: [{ href: "/team-performance", label: "公司数据汇总" }, { href: "/channel-analysis", label: "渠道表现" }, { href: "/finance-reports", label: "财务报表" }, { href: "/attendance", label: "考勤管理" }, { href: "/notifications", label: "通知中心" }] },
  ];
  if (role === "HR") return [
    { label: "行政工作", items: [{ href: "/personnel", label: "人员档案" }, { href: "/attendance", label: "考勤管理" }] },
  ];
  if (role === "RECEPTION" || role === "GROUP_OPERATOR" || role === "EXPERT") {
    const frontlineItems = role === "GROUP_OPERATOR" ? groupOperatorNavigation : role === "EXPERT" ? expertNavigation : memberNavigation;
    const dailyCount = role === "RECEPTION" ? 4 : 5;
    const sections: AppNavigationSection[] = [
      { label: "日常工作", items: frontlineItems.slice(0, dailyCount) },
    ];
    const analysis = frontlineItems.slice(dailyCount);
    if (analysis.length > 0)
      sections.push({ label: "数据分析", items: analysis });
    return sections;
  }
  return managementSections(role);
}

export function getVisibleAppNavigation(
  role: AppNavigationRoles,
): VisibleAppNavigationItem[] {
  return getVisibleAppNavigationSections(role).flatMap(
    (section) => section.items,
  );
}
