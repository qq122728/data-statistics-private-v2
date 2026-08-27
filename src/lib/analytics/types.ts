import type { MemberPeriod } from "./member-periods";

export type ManagementRole = "ADMIN" | "RESOURCE_MANAGER" | "COMPANY_MANAGER" | "FINANCE" | "LEAD" | "GROUP_OPERATOR" | "EXPERT";
export type { MemberPeriod } from "./member-periods";

export type AnalysisFilters = {
  departmentId?: string;
  countryCode?: string;
  month?: string;
  batchId?: string;
  groupId?: string;
  memberId?: string;
  normalizedName?: string;
  period?: MemberPeriod;
  sourceDateFrom: string;
  sourceDateTo: string;
  includeInactive: boolean;
  showInsufficient?: boolean;
  filterWarning?: string;
};

export type AnalysisScope = AnalysisFilters & {
  actorId: string;
  role: ManagementRole;
  groupIds: string[];
  requestedForbiddenGroup: boolean;
  channelIds?: string[];
  showInsufficient: boolean;
};
