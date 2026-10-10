import { WORKSPACE_LABELS as labels, NAV_GROUPS } from "../../../packages/workspace/navigation";
import { IconBell, IconChart, IconDevice, IconRoute, IconSearch, IconTrophy, IconUsers } from "../components/Icons";

export type Role = "LEAD" | "DEPT_MANAGER" | "COMPANY_MANAGER" | "HQ_MANAGER" | "RESOURCE_TRAFFIC" | "RESOURCE_SMS";

export const ADMIN_PAGES = {
  "followup": { title: labels.customers, section: NAV_GROUPS.work, Icon: IconRoute },
  "expert-daily": { title: labels.daily, section: NAV_GROUPS.work, Icon: IconChart },
  "summary": { title: labels.summary, section: NAV_GROUPS.data, Icon: IconChart },
  "channel": { title: labels.channelReview, section: NAV_GROUPS.data, Icon: IconSearch },
  "notice": { title: labels.notifications, section: NAV_GROUPS.work, Icon: IconBell },
  "members": { title: labels.groups, section: NAV_GROUPS.organization, Icon: IconUsers },
  "devices": { title: labels.devices, section: NAV_GROUPS.resources, Icon: IconDevice },
  "dashboard": { title: labels.myDashboard, section: NAV_GROUPS.data, Icon: IconChart },
  "leaderboard": { title: labels.rankings, section: NAV_GROUPS.data, Icon: IconTrophy },
  "team-overview": { title: labels.departmentDashboard, section: NAV_GROUPS.work, Icon: IconChart },
  "team-detail": { title: labels.summary, section: NAV_GROUPS.data, Icon: IconSearch },
  "management-customer-progress": { title: labels.customers, section: NAV_GROUPS.work, Icon: IconRoute },
  "management-group-detail": { title: labels.groupDataDetail, section: NAV_GROUPS.work, Icon: IconChart },
  "dept-notice": { title: labels.notifications, section: NAV_GROUPS.work, Icon: IconBell },
  "group-leadership": { title: labels.groupLeadership, section: NAV_GROUPS.organization, Icon: IconUsers },
  "dept-leaderboard": { title: labels.rankings, section: NAV_GROUPS.data, Icon: IconTrophy },
  "company-overview": { title: labels.companyDashboard, section: NAV_GROUPS.work, Icon: IconChart },
  "company-detail": { title: labels.departmentDetail, section: NAV_GROUPS.data, Icon: IconSearch },
  "company-notice": { title: labels.notifications, section: NAV_GROUPS.work, Icon: IconBell },
  "company-leadership": { title: labels.companyLeadership, section: NAV_GROUPS.organization, Icon: IconUsers },
  "company-leaderboard": { title: labels.rankings, section: NAV_GROUPS.data, Icon: IconTrophy },
  "hq-overview": { title: labels.hqDashboard, section: NAV_GROUPS.work, Icon: IconChart },
  "hq-detail": { title: labels.companyDetail, section: NAV_GROUPS.data, Icon: IconSearch },
  "hq-notice": { title: labels.notifications, section: NAV_GROUPS.work, Icon: IconBell },
  "hq-leadership": { title: labels.organization, section: NAV_GROUPS.organization, Icon: IconUsers },
  "channel-settings": { title: labels.channelSettings, section: NAV_GROUPS.resources, Icon: IconSearch },
  "hq-leaderboard": { title: labels.rankings, section: NAV_GROUPS.data, Icon: IconTrophy },
  "resource-summary": { title: labels.resourceSummary, section: NAV_GROUPS.data, Icon: IconChart },
  "resource-group-detail": { title: labels.groupDetail, section: NAV_GROUPS.data, Icon: IconSearch },
  "resource-notice": { title: labels.notifications, section: NAV_GROUPS.work, Icon: IconBell },
} as const;
export type View = keyof typeof ADMIN_PAGES;

const VIEWS_BY_ROLE: Record<Role, readonly View[]> = {
  LEAD: ["followup", "expert-daily", "summary", "channel", "notice", "members", "devices", "dashboard", "leaderboard"],
  DEPT_MANAGER: ["team-overview", "team-detail", "management-customer-progress", "management-group-detail", "dept-notice", "group-leadership", "dept-leaderboard"],
  COMPANY_MANAGER: ["company-overview", "company-detail", "management-customer-progress", "management-group-detail", "company-notice", "company-leadership", "company-leaderboard"],
  HQ_MANAGER: ["hq-overview", "hq-detail", "management-customer-progress", "management-group-detail", "hq-notice", "hq-leadership", "channel-settings", "hq-leaderboard"],
  RESOURCE_TRAFFIC: ["resource-summary", "resource-group-detail", "resource-notice"],
  RESOURCE_SMS: ["resource-summary", "resource-group-detail", "resource-notice"],
};

export function adminNavigation(role: Role) {
  return Object.values(NAV_GROUPS).map(group => ({
    group,
    items: VIEWS_BY_ROLE[role].filter(id => ADMIN_PAGES[id].section === group).map(id => ({ id, ...ADMIN_PAGES[id] })),
  })).filter(section => section.items.length > 0);
}
