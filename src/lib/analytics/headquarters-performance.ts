import type { ManagementOverview } from "./overview";

export type HeadquartersGroupPerformance = NonNullable<ManagementOverview["groupComparison"]>[number] & {
  rank: number;
};

export type HeadquartersCompanyPerformance = {
  rank: number;
  departmentId: string;
  departmentName: string;
  groupCount: number;
  orders: number;
  rechargeCents: number;
  withdrawalCents: number;
  netPerformanceCents: number;
  costCents: number | null;
  profitCents: number | null;
  matureNewFans: number;
  matureOrders: number;
  matureOrderRate: number | null;
  newFans: number;
  effectiveFans: number;
  replies: number;
  groupJoin: number;
  groupLeave: number;
  abnormalGroupLeave: number;
  expertIntro: number;
  expertContacted: number;
  registration: number;
  noNumber: number;
  duplicateFans: number;
};

const performanceSort = <T extends { profitCents: number | null; netPerformanceCents: number; rechargeCents: number }>(left: T, right: T) =>
  (right.profitCents ?? Number.NEGATIVE_INFINITY) - (left.profitCents ?? Number.NEGATIVE_INFINITY)
  || right.netPerformanceCents - left.netPerformanceCents
  || right.rechargeCents - left.rechargeCents;

export function buildHeadquartersPerformance(
  rows: NonNullable<ManagementOverview["groupComparison"]>,
): { companies: HeadquartersCompanyPerformance[]; groups: HeadquartersGroupPerformance[] } {
  const companiesById = new Map<string, Omit<HeadquartersCompanyPerformance, "rank"> & { hasPendingCost: boolean }>();

  for (const row of rows) {
    const current = companiesById.get(row.departmentId) ?? {
      departmentId: row.departmentId,
      departmentName: row.departmentName,
      groupCount: 0,
      orders: 0,
      rechargeCents: 0,
      withdrawalCents: 0,
      netPerformanceCents: 0,
      costCents: 0,
      profitCents: 0,
      matureNewFans: 0,
      matureOrders: 0,
      matureOrderRate: null,
      newFans: 0,
      effectiveFans: 0,
      replies: 0,
      groupJoin: 0,
      groupLeave: 0,
      abnormalGroupLeave: 0,
      expertIntro: 0,
      expertContacted: 0,
      registration: 0,
      noNumber: 0,
      duplicateFans: 0,
      hasPendingCost: false,
    };
    current.groupCount += 1;
    current.orders += row.orders;
    current.rechargeCents += row.rechargeCents;
    current.withdrawalCents += row.withdrawalCents;
    current.netPerformanceCents += row.netPerformanceCents;
    current.matureNewFans += row.matureNewFans;
    current.matureOrders += row.matureOrders;
    current.newFans += row.newFans ?? 0;
    current.effectiveFans += row.effectiveFans;
    current.replies += row.replies ?? 0;
    current.groupJoin += row.groupJoin ?? 0;
    current.groupLeave += row.groupLeave ?? 0;
    current.abnormalGroupLeave += row.abnormalGroupLeave ?? 0;
    current.expertIntro += row.expertIntro ?? 0;
    current.expertContacted += row.expertContacted ?? 0;
    current.registration += row.registration ?? 0;
    current.noNumber += row.noNumber ?? 0;
    current.duplicateFans += row.duplicateFans ?? 0;
    if (row.costCents === null || row.profitCents === null) current.hasPendingCost = true;
    else {
      current.costCents = (current.costCents ?? 0) + row.costCents;
      current.profitCents = (current.profitCents ?? 0) + row.profitCents;
    }
    companiesById.set(row.departmentId, current);
  }

  const companies = [...companiesById.values()]
    .map(({ hasPendingCost, ...company }) => ({
      ...company,
      costCents: hasPendingCost ? null : company.costCents,
      profitCents: hasPendingCost ? null : company.profitCents,
      matureOrderRate: company.matureNewFans ? company.matureOrders / company.matureNewFans : null,
    }))
    .sort((left, right) => performanceSort(left, right) || left.departmentName.localeCompare(right.departmentName, "zh-CN"))
    .map((company, index) => ({ ...company, rank: index + 1 }));

  const groups = [...rows]
    .sort((left, right) => performanceSort(left, right)
      || left.departmentName.localeCompare(right.departmentName, "zh-CN")
      || left.groupName.localeCompare(right.groupName, "zh-CN"))
    .map((group, index) => ({ ...group, rank: index + 1 }));

  return { companies, groups };
}
