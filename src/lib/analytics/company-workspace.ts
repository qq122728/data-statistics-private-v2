import type { ConversionGrade, RateBand } from "../conversion-standards";
import { gradeConversion, hasReachedBusinessDay, standardsFromGroup } from "../conversion-standards";
import { db } from "../db";
import type { AnalysisScope } from "./types";
import { loadResourceWorkspace, type ResourceGroupRow, type ResourceWorkspace } from "./resource-workspace";

export type CompanyRoleMetric = {
  eligible: number;
  completed: number;
  rate: number | null;
  grade: ConversionGrade;
  band: RateBand;
};

export type CompanyGroupHealth = {
  groupId: string;
  groupName: string;
  effectiveRate: number | null;
  resourceStatus: ResourceGroupRow["status"];
  reception: CompanyRoleMetric;
  operator: CompanyRoleMetric;
  expert: CompanyRoleMetric;
  netContributionCents: number | null;
  seriousOverdue: number;
  status: "NORMAL" | "WARNING" | "DANGER" | "INSUFFICIENT";
};

export type CompanyAttention = {
  key: string;
  tone: "danger" | "warning";
  title: string;
  detail: string;
  groupId: string;
};

export type CompanyWorkspace = {
  resource: ResourceWorkspace;
  seriousOverdue: { eligible: number; count: number; rate: number | null };
  groups: CompanyGroupHealth[];
  attention: CompanyAttention[];
};

type CompanyLead = {
  id: string;
  groupId: string;
  sourceDate: string;
  receptionCategory: "PENDING" | "VALID" | "INVALID" | "LOW_AMOUNT" | "NO_WS";
  invalid: boolean;
  repliedOn: string | null;
  joinedOn: string | null;
  groupStatus: "NOT_JOINED" | "JOINED" | "LEFT";
  expertIntroducedOn: string | null;
  expertContactedOn: string | null;
  expertOwnerId: string | null;
  registeredOn: string | null;
  hasActiveOrder: boolean;
};

const ratio = (completed: number, eligible: number) => eligible ? completed / eligible : null;

function metric(completed: number, eligible: number, band: RateBand): CompanyRoleMetric {
  return { completed, eligible, rate: ratio(completed, eligible), grade: gradeConversion(completed, eligible, band), band };
}

function dueAndSerious(lead: CompanyLead, today: string) {
  const due = [
    hasReachedBusinessDay(lead.sourceDate, today, 1),
    Boolean(lead.repliedOn && hasReachedBusinessDay(lead.repliedOn, today, 1)),
    Boolean(lead.joinedOn && lead.groupStatus === "JOINED" && hasReachedBusinessDay(lead.joinedOn, today, 2)),
    Boolean(lead.expertIntroducedOn && lead.expertOwnerId && hasReachedBusinessDay(lead.expertIntroducedOn, today, 1)),
    Boolean(lead.expertContactedOn && hasReachedBusinessDay(lead.expertContactedOn, today, 2)),
    Boolean(lead.registeredOn && hasReachedBusinessDay(lead.registeredOn, today, 2)),
  ].some(Boolean);
  const serious = [
    !lead.repliedOn && hasReachedBusinessDay(lead.sourceDate, today, 3),
    Boolean(lead.repliedOn && !lead.joinedOn && hasReachedBusinessDay(lead.repliedOn, today, 3)),
    Boolean(lead.joinedOn && lead.groupStatus === "JOINED" && !lead.expertIntroducedOn && hasReachedBusinessDay(lead.joinedOn, today, 3)),
    Boolean(lead.expertIntroducedOn && lead.expertOwnerId && !lead.expertContactedOn && hasReachedBusinessDay(lead.expertIntroducedOn, today, 3)),
    Boolean(lead.expertContactedOn && !lead.registeredOn && hasReachedBusinessDay(lead.expertContactedOn, today, 3)),
    Boolean(lead.registeredOn && !lead.hasActiveOrder && hasReachedBusinessDay(lead.registeredOn, today, 3)),
  ].some(Boolean);
  return { due, serious };
}

const gradeSeverity = (grade: ConversionGrade) => grade === "BELOW_PASS" ? 2 : grade === "PASS" ? 1 : 0;

export async function loadCompanyWorkspace(scope: AnalysisScope, today: string): Promise<CompanyWorkspace> {
  const resourcePromise = loadResourceWorkspace(scope, today, "source");
  if (scope.requestedForbiddenGroup || !scope.groupIds.length) {
    const resource = await resourcePromise;
    return { resource, seriousOverdue: { eligible: 0, count: 0, rate: null }, groups: [], attention: [] };
  }

  const batchScope = {
    groupId: { in: scope.groupIds },
    sourceDate: { gte: scope.sourceDateFrom, lte: scope.sourceDateTo },
    ...(scope.normalizedName ? { channel: { normalizedName: scope.normalizedName } } : {}),
  } as const;
  const [resource, groupRows, leadRows] = await Promise.all([
    resourcePromise,
    db.teamGroup.findMany({
      where: { id: { in: scope.groupIds } },
      select: {
        id: true, name: true,
        receptionJoinPassRate: true, receptionJoinGoodRate: true, receptionJoinExcellentRate: true,
        operatorExpertPassRate: true, operatorExpertGoodRate: true, operatorExpertExcellentRate: true,
        expertOrderPassRate: true, expertOrderGoodRate: true, expertOrderExcellentRate: true,
      },
    }),
    db.leadCustomer.findMany({
      // 健康度只判断常规流程；历史补录只留在开单与资金统计中。
      where: { isHistoricalRecord: false, batch: { ...batchScope, isHistoricalRecord: false } },
      select: {
        id: true, invalid: true, receptionCategory: true, groupStatus: true, repliedOn: true, joinedOn: true, expertIntroducedOn: true,
        expertContactedOn: true, expertOwnerId: true, registeredOn: true,
        batch: { select: { sourceDate: true, groupId: true } },
        customerOrder: { select: { voidedAt: true } },
      },
    }),
  ]);
  const leads: CompanyLead[] = leadRows.map((lead) => ({
    id: lead.id,
    groupId: lead.batch.groupId,
    sourceDate: lead.batch.sourceDate,
    receptionCategory: lead.receptionCategory,
    invalid: lead.invalid,
    repliedOn: lead.repliedOn,
    joinedOn: lead.joinedOn,
    groupStatus: lead.groupStatus,
    expertIntroducedOn: lead.expertIntroducedOn,
    expertContactedOn: lead.expertContactedOn,
    expertOwnerId: lead.expertOwnerId,
    registeredOn: lead.registeredOn,
    hasActiveOrder: Boolean(lead.customerOrder && !lead.customerOrder.voidedAt),
  }));
  const resourceByGroup = new Map(resource.groups.map((group) => [group.groupId, group]));

  const groups = groupRows.map((group): CompanyGroupHealth => {
    const groupLeads = leads.filter((lead) => lead.groupId === group.id);
    const standards = standardsFromGroup(group);
    const effectiveLeads = groupLeads.filter((lead) => !lead.invalid && lead.receptionCategory !== "INVALID" && lead.receptionCategory !== "LOW_AMOUNT" && lead.receptionCategory !== "NO_WS");
    const receptionEligibleRows = effectiveLeads.filter((lead) => Boolean(lead.repliedOn));
    const receptionEligible = receptionEligibleRows.length;
    const receptionCompleted = receptionEligibleRows.filter((lead) => Boolean(lead.joinedOn)).length;
    const operatorEligibleRows = effectiveLeads.filter((lead) => lead.groupStatus === "JOINED" && hasReachedBusinessDay(lead.joinedOn, today, 2));
    const operatorCompleted = operatorEligibleRows.filter((lead) => Boolean(lead.expertIntroducedOn)).length;
    const expertEligibleRows = effectiveLeads.filter((lead) => Boolean(lead.expertOwnerId && lead.expertIntroducedOn) && hasReachedBusinessDay(lead.expertIntroducedOn, today, 1));
    const expertCompleted = expertEligibleRows.filter((lead) => lead.hasActiveOrder).length;
    const reception = metric(receptionCompleted, receptionEligible, standards.receptionJoin);
    const operator = metric(operatorCompleted, operatorEligibleRows.length, standards.operatorExpert);
    const expert = metric(expertCompleted, expertEligibleRows.length, standards.expertOrder);
    const resourceRow = resourceByGroup.get(group.id);
    const seriousOverdue = effectiveLeads.filter((lead) => dueAndSerious(lead, today).serious).length;
    const severity = Math.max(gradeSeverity(reception.grade), gradeSeverity(operator.grade), gradeSeverity(expert.grade));
    const status = groupLeads.length === 0 ? "INSUFFICIENT" as const
      : severity >= 2 || seriousOverdue >= 5 || resourceRow?.status === "DANGER" ? "DANGER" as const
      : severity === 1 || seriousOverdue > 0 || resourceRow?.status === "WARNING" ? "WARNING" as const
      : "NORMAL" as const;
    return {
      groupId: group.id,
      groupName: group.name,
      effectiveRate: resourceRow?.effectiveRate ?? null,
      resourceStatus: resourceRow?.status ?? "INSUFFICIENT",
      reception,
      operator,
      expert,
      netContributionCents: resourceRow?.netContributionCents ?? null,
      seriousOverdue,
      status,
    };
  }).sort((left, right) => ({ DANGER: 0, WARNING: 1, INSUFFICIENT: 2, NORMAL: 3 })[left.status] - ({ DANGER: 0, WARNING: 1, INSUFFICIENT: 2, NORMAL: 3 })[right.status] || right.seriousOverdue - left.seriousOverdue || left.groupName.localeCompare(right.groupName, "zh-CN"));

  const dueLeads = leads.filter((lead) => dueAndSerious(lead, today).due);
  const seriousLeads = leads.filter((lead) => dueAndSerious(lead, today).serious);
  const attention = groups.filter((group) => group.status === "DANGER" || group.status === "WARNING").slice(0, 3).map((group): CompanyAttention => {
    const failing = [
      ["接粉入群", group.reception],
      ["炒群推专家", group.operator],
      ["专家开单", group.expert],
    ] as const;
    const worst = failing.find(([, value]) => value.grade === "BELOW_PASS") ?? failing.find(([, value]) => value.grade === "PASS");
    return {
      key: group.groupId,
      groupId: group.groupId,
      tone: group.status === "DANGER" ? "danger" : "warning",
      title: `${group.groupName}${worst ? ` · ${worst[0]}${worst[1].grade === "BELOW_PASS" ? "不及格" : "仅达及格"}` : "需要关注"}`,
      detail: `严重超时 ${group.seriousOverdue} 人${!worst || worst[1].rate === null ? " · 当前样本不足" : ` · 当前 ${(worst[1].rate * 100).toFixed(1)}%`}`,
    };
  });

  return {
    resource,
    seriousOverdue: { eligible: dueLeads.length, count: seriousLeads.length, rate: ratio(seriousLeads.length, dueLeads.length) },
    groups,
    attention,
  };
}
