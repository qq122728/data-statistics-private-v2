import { db } from "../db";
import { hasReachedBusinessDay, standardsFromGroup, type GroupConversionStandards } from "../conversion-standards";
import { getApprovedInvalidFanTotals } from "../invalid-fan-reports";
import { assessGroupLeave } from "../group-leave";

export type ReceptionRankingRow = {
  id: string;
  name: string;
  active: boolean;
  groupId: string;
  groupName: string;
  total?: number;
  lowAmount?: number;
  noWs?: number;
  duplicate?: number;
  invalid?: number;
  valid: number;
  replied: number;
  joined: number;
  left?: number;
  abnormalLeft?: number;
  expertIntroduced: number;
  expertContacted?: number;
  registered: number;
  orders: number;
  /** 同一笔首充会在协作岗位展示；小组总账仍只按客户计算一次。 */
  firstDepositCents: number;
  depositCents: number;
  withdrawalCents: number;
  netCents: number;
};

export type GroupOperatorRankingRow = {
  id: string;
  name: string;
  active: boolean;
  groupName: string;
  groupId: string;
  pairedReceptionCount: number;
  sharedCustomerCount: number;
  currentInGroup: number;
  introducedActions: number;
  leaveActions: number;
  abnormalLeaveActions?: number;
  downstreamRegistered: number;
  downstreamContacted?: number;
  downstreamOrders: number;
  /** 炒群实际接手的客户产生的首充，用于协作业绩展示。 */
  firstDepositCents: number;
  depositCents: number;
  withdrawalCents: number;
  netCents: number;
  eligibleForIntroduction: number;
  introducedEligible: number;
};

export type ExpertRankingRow = {
  id: string;
  name: string;
  active: boolean;
  groupName: string;
  groupId: string;
  role: "EXPERT" | "LEAD";
  assigned: number;
  contacted?: number;
  registered: number;
  orders: number;
  firstDepositCents: number;
  depositCents: number;
  withdrawalCents: number;
  netCents: number;
  eligibleForOrder: number;
  orderedEligible: number;
};

export type GroupRankingRow = {
  id: string;
  name: string;
  /** 仅用于总公司/公司跨小组对比的识别，不参与任何统计口径。 */
  departmentName?: string;
  countryCode?: string | null;
  valid: number;
  replied: number;
  joined: number;
  left?: number;
  abnormalLeft?: number;
  expertIntroduced: number;
  expertContacted?: number;
  registered: number;
  orders: number;
  firstDepositCents: number;
  depositCents: number;
  withdrawalCents: number;
  netCents: number;
};

export type RoleRankingsResult = {
  reception: ReceptionRankingRow[];
  /**
   * 代理线维度：客户的“粉的归属”而非实际录入人。
   * 仅财务导出使用它，岗位榜仍保留实际岗位的工作量，避免把两种口径混在一起。
   */
  fanOwners?: ReceptionRankingRow[];
  groupOperators: GroupOperatorRankingRow[];
  experts: ExpertRankingRow[];
  groups: GroupRankingRow[];
  standardsByGroup: Record<string, GroupConversionStandards>;
};

type LoadedLead = Awaited<ReturnType<typeof loadLeads>>[number];

async function loadLeads(groupIds: string[], sourceDateFrom: string, sourceDateTo: string, normalizedName?: string, channelIds?: string[]) {
  return db.leadCustomer.findMany({
    where: {
      batch: {
        groupId: { in: groupIds },
        sourceDate: { gte: sourceDateFrom, lte: sourceDateTo },
        ...(channelIds ? { channelId: { in: channelIds } } : {}),
        ...(normalizedName ? { channel: { normalizedName } } : {}),
      },
    },
    select: {
      id: true,
      ownerId: true,
      attributionOwnerId: true,
      expertOwnerId: true,
      groupOperatorOwnerId: true,
      isHistoricalRecord: true,
      invalid: true,
      receptionCategory: true,
      replyStatus: true,
      repliedOn: true,
      joinedOn: true,
      leftOn: true,
      groupStatus: true,
      expertIntroducedOn: true,
      expertContactedOn: true,
      registeredOn: true,
      batch: {
        select: {
          id: true,
          groupId: true,
          isHistoricalRecord: true,
        },
      },
      activities: {
        where: { kind: { in: ["EXPERT_INTRODUCED", "LEFT_GROUP"] } },
        select: { actorId: true, kind: true, occurredOn: true },
      },
      customerOrder: {
        select: {
          openedOn: true,
          initialDepositCents: true,
          voidedAt: true,
          events: {
            select: { kind: true, amountCents: true, continuationNumber: true, occurredOn: true, voidedAt: true },
          },
        },
      },
    },
  });
}

function happenedBy(value: string | null, today: string) {
  return value !== null && value <= today;
}

function activeOrder(lead: LoadedLead, today: string) {
  const voidedByToday = lead.customerOrder?.voidedAt
    ? lead.customerOrder.voidedAt.toISOString().slice(0, 10) <= today
    : false;
  return lead.customerOrder && !voidedByToday && lead.customerOrder.openedOn <= today
    ? lead.customerOrder
    : null;
}

/**
 * 需求文档6.1.1：当前在群是快照，只看截止日期，人群不能被报表的日期范围卡住——
 * 不管选的是哪个 sourceDateFrom，只要 joinedOn <= today 且还没退群，就该算在内。
 * 因此这里故意不复用 loadLeads 的 sourceDate 范围过滤，只按 group/channel 筛选。
 * 归属判定要跟主循环的三层 fallback（明确指派 → 最近一次推专家动作 → 当前配对组长）
 * 保持完全一致，否则明确指派为空、靠配对兜底的客户会在这里被漏算成0。
 */
async function loadUnboundedInGroupLeadsForOperator(groupIds: string[], today: string, channelIds?: string[], normalizedName?: string) {
  return db.leadCustomer.findMany({
    where: {
      isHistoricalRecord: false,
      joinedOn: { not: null, lte: today },
      batch: {
        groupId: { in: groupIds },
        isHistoricalRecord: false,
        ...(channelIds ? { channelId: { in: channelIds } } : {}),
        ...(normalizedName ? { channel: { normalizedName } } : {}),
      },
    },
    select: {
      ownerId: true,
      groupOperatorOwnerId: true,
      leftOn: true,
      activities: {
        where: { kind: "EXPERT_INTRODUCED", occurredOn: { lte: today } },
        select: { actorId: true, occurredOn: true },
      },
    },
  });
}

function isResourceEligible(lead: LoadedLead) {
  return !lead.invalid && lead.receptionCategory !== "INVALID" && lead.receptionCategory !== "LOW_AMOUNT" && lead.receptionCategory !== "NO_WS";
}

function isHistorical(lead: LoadedLead) {
  return lead.isHistoricalRecord || lead.batch.isHistoricalRecord;
}

function financials(leads: LoadedLead[], today: string) {
  let firstDepositCents = 0;
  let depositCents = 0;
  let withdrawalCents = 0;
  for (const lead of leads) {
    const order = activeOrder(lead, today);
    if (!order) continue;
    firstDepositCents += order.initialDepositCents;
    depositCents += order.initialDepositCents;
    for (const event of order.events) {
      if (event.occurredOn > today) continue;
      if (event.voidedAt && event.voidedAt.toISOString().slice(0, 10) <= today) continue;
      if (event.kind === "RECHARGE" && event.continuationNumber !== null)
        depositCents += event.amountCents ?? 0;
      if (event.kind === "WITHDRAWAL") withdrawalCents += event.amountCents ?? 0;
    }
  }
  return {
    firstDepositCents,
    depositCents,
    withdrawalCents,
    netCents: depositCents - withdrawalCents,
  };
}

function funnel(leads: LoadedLead[], today: string) {
  const validLeads = leads.filter((lead) => !isHistorical(lead) && isResourceEligible(lead));
  return {
    valid: validLeads.length,
    replied: validLeads.filter((lead) => happenedBy(lead.repliedOn, today)).length,
    joined: validLeads.filter((lead) => happenedBy(lead.joinedOn, today)).length,
    left: validLeads.filter((lead) => happenedBy(lead.leftOn, today)).length,
    abnormalLeft: validLeads.filter((lead) => happenedBy(lead.leftOn, today) && assessGroupLeave(lead.joinedOn, lead.leftOn).level === "EARLY").length,
    expertIntroduced: validLeads.filter((lead) => happenedBy(lead.expertIntroducedOn, today)).length,
    expertContacted: validLeads.filter((lead) => happenedBy(lead.expertContactedOn, today)).length,
    registered: validLeads.filter((lead) => happenedBy(lead.registeredOn, today)).length,
    orders: validLeads.filter((lead) => Boolean(activeOrder(lead, today))).length,
  };
}

function append<K, V>(map: Map<K, V[]>, key: K | null | undefined, value: V) {
  if (key === null || key === undefined) return;
  const rows = map.get(key) ?? [];
  rows.push(value);
  map.set(key, rows);
}

function distinctLeadCount(leads: LoadedLead[], predicate: (lead: LoadedLead) => boolean) {
  return new Set(leads.filter(predicate).map((lead) => lead.id)).size;
}

export async function loadRoleRankings(input: {
  groupIds: string[];
  sourceDateFrom: string;
  sourceDateTo: string;
  today?: string;
  normalizedName?: string;
  channelIds?: string[];
}): Promise<RoleRankingsResult> {
  if (!input.groupIds.length) return { reception: [], fanOwners: [], groupOperators: [], experts: [], groups: [], standardsByGroup: {} };
  const today = input.today ?? input.sourceDateTo;
  const [people, fanOwnerPeople, groups, leads, duplicateEvents, approvedInvalidReports, unboundedInGroupLeads] = await Promise.all([
    db.user.findMany({
      where: {
        OR: [
          { groupId: { in: input.groupIds } },
          { membershipHistory: { some: { groupId: { in: input.groupIds } } } },
        ],
      },
      select: {
        id: true, employeeCode: true,
        name: true,
        role: true,
        active: true,
        groupId: true,
        group: { select: { name: true } },
        membershipHistory: { where: { groupId: { in: input.groupIds } }, select: { groupId: true, role: true, secondaryRoles: true, group: { select: { name: true } } }, orderBy: { effectiveFrom: "asc" } },
        groupOperatorAssignments: { select: { receptionistId: true } },
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    // “粉的归属”可以选本组任意成员，不能只按前台接粉角色查询。
    // 这里也保留已停用成员，历史报表才不会因为离职或转岗而少一行。
    db.user.findMany({
      where: { OR: [{ groupId: { in: input.groupIds } }, { membershipHistory: { some: { groupId: { in: input.groupIds } } } }] },
      select: {
        id: true, employeeCode: true,
        name: true,
        active: true,
        groupId: true,
        group: { select: { name: true } },
        membershipHistory: { where: { groupId: { in: input.groupIds } }, select: { groupId: true, role: true, secondaryRoles: true, group: { select: { name: true } } }, orderBy: { effectiveFrom: "asc" } },
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    db.teamGroup.findMany({
      where: { id: { in: input.groupIds } },
      select: {
        id: true, name: true, countryCode: true,
        department: { select: { name: true, countryCode: true } },
        receptionJoinPassRate: true, receptionJoinGoodRate: true, receptionJoinExcellentRate: true,
        operatorExpertPassRate: true, operatorExpertGoodRate: true, operatorExpertExcellentRate: true,
        expertOrderPassRate: true, expertOrderGoodRate: true, expertOrderExcellentRate: true,
      },
      orderBy: { name: "asc" },
    }),
    loadLeads(input.groupIds, input.sourceDateFrom, input.sourceDateTo, input.normalizedName, input.channelIds),
    db.metricEvent.findMany({
      where: {
        kind: "DUPLICATE_FANS",
        voidedAt: null,
        batch: {
          groupId: { in: input.groupIds },
          sourceDate: { gte: input.sourceDateFrom, lte: input.sourceDateTo },
          ...(input.channelIds ? { channelId: { in: input.channelIds } } : {}),
        },
      },
      select: { enteredById: true, quantity: true },
    }),
    getApprovedInvalidFanTotals({
      groupIds: input.groupIds,
      sourceDateFrom: input.sourceDateFrom,
      sourceDateTo: input.sourceDateTo,
      normalizedChannelName: input.normalizedName,
      channelIds: input.channelIds,
    }),
    loadUnboundedInGroupLeadsForOperator(input.groupIds, today, input.channelIds, input.normalizedName),
  ]);

  const duplicateByReception = new Map<string, number>();
  for (const event of duplicateEvents)
    duplicateByReception.set(event.enteredById, (duplicateByReception.get(event.enteredById) ?? 0) + (event.quantity ?? 0));

  const approvedInvalidByReception = new Map<string, { noWs: number; lowAmount: number; collision: number; total: number }>();
  for (const report of approvedInvalidReports) {
    const current = approvedInvalidByReception.get(report.reporterId) ?? { noWs: 0, lowAmount: 0, collision: 0, total: 0 };
    current.noWs += report.noWsCount;
    current.lowAmount += report.lowAmountCount;
    current.collision += report.collisionCount;
    current.total += report.total;
    approvedInvalidByReception.set(report.reporterId, current);
  }

  const leadsByOwner = new Map<string, LoadedLead[]>();
  const leadsByFanOwner = new Map<string, LoadedLead[]>();
  const leadsByExpert = new Map<string, LoadedLead[]>();
  const leadsByGroup = new Map<string, LoadedLead[]>();
  const currentOperatorByReception = new Map<string, string>();
  for (const person of people) {
    const hasOperatorRole = person.role === "GROUP_OPERATOR"
      || person.membershipHistory.some((membership) => membership.role === "GROUP_OPERATOR" || membership.secondaryRoles?.split(",").includes("GROUP_OPERATOR"));
    if (!hasOperatorRole) continue;
    for (const assignment of person.groupOperatorAssignments)
      currentOperatorByReception.set(assignment.receptionistId, person.id);
  }
  const currentInGroupByOperator = new Map<string, number>();
  for (const lead of unboundedInGroupLeads) {
    if (lead.leftOn && lead.leftOn <= today) continue;
    const latestIntro = lead.activities
      .sort((left, right) => right.occurredOn.localeCompare(left.occurredOn))[0];
    const operatorId = lead.groupOperatorOwnerId ?? latestIntro?.actorId ?? currentOperatorByReception.get(lead.ownerId);
    if (!operatorId) continue;
    currentInGroupByOperator.set(operatorId, (currentInGroupByOperator.get(operatorId) ?? 0) + 1);
  }
  const leadsByOperator = new Map<string, LoadedLead[]>();
  const introducedActionsByActor = new Map<string, LoadedLead[]>();
  const leaveActionsByActor = new Map<string, LoadedLead[]>();
  for (const lead of leads) {
    append(leadsByOwner, lead.ownerId, lead);
    // 新数据保存明确归属；旧数据没有该字段时，兼容归到当时的实际接粉人。
    append(leadsByFanOwner, lead.attributionOwnerId ?? lead.ownerId, lead);
    append(leadsByExpert, lead.expertOwnerId, lead);
    append(leadsByGroup, lead.batch.groupId, lead);
    const latestIntro = lead.activities
      .filter((activity) => activity.kind === "EXPERT_INTRODUCED" && activity.occurredOn <= today)
      .sort((left, right) => right.occurredOn.localeCompare(left.occurredOn))[0];
    const operatorId = lead.groupOperatorOwnerId
      ?? latestIntro?.actorId
      ?? currentOperatorByReception.get(lead.ownerId);
    append(leadsByOperator, operatorId, lead);
    if (isHistorical(lead)) continue;
    for (const activity of lead.activities) {
      if (activity.occurredOn > today) continue;
      if (activity.kind === "EXPERT_INTRODUCED") append(introducedActionsByActor, activity.actorId, lead);
      if (activity.kind === "LEFT_GROUP") append(leaveActionsByActor, activity.actorId, lead);
    }
  }

  type RankedPerson = (typeof people)[number];
  function hasScopedRole(person: RankedPerson, role: "RECEPTION" | "GROUP_OPERATOR" | "EXPERT" | "LEAD") {
    return person.role === role || person.membershipHistory.some((membership) => membership.role === role || membership.secondaryRoles?.split(",").includes(role));
  }
  function displayScope(person: { groupId: string | null; group: { name: string } | null; membershipHistory: Array<{ groupId: string; group: { name: string } }> }) {
    const scopedGroups = new Map(person.membershipHistory.map((membership) => [membership.groupId, membership.group.name]));
    if (person.groupId && input.groupIds.includes(person.groupId) && person.group) scopedGroups.set(person.groupId, person.group.name);
    const entries = [...scopedGroups.entries()];
    if (!entries.length) return { groupId: person.groupId ?? "", groupName: person.group?.name ?? "未分组" };
    return {
      groupId: person.groupId && scopedGroups.has(person.groupId) ? person.groupId : entries[0][0],
      groupName: entries.length === 1 ? entries[0][1] : `${entries.map((entry) => entry[1]).join(" / ")}（个人合计）`,
    };
  }

  const reception = people
    .filter((person) => hasScopedRole(person, "RECEPTION") || leadsByOwner.has(person.id))
    .map((person) => {
      const owned = leadsByOwner.get(person.id) ?? [];
      const workflowOwned = owned.filter((lead) => !isHistorical(lead));
      const approvedInvalid = approvedInvalidByReception.get(person.id) ?? { noWs: 0, lowAmount: 0, collision: 0, total: 0 };
      return {
        id: person.id,
        name: person.name,
        active: person.active,
        ...displayScope(person),
        total: workflowOwned.length + approvedInvalid.total,
        lowAmount: workflowOwned.filter((lead) => lead.receptionCategory === "LOW_AMOUNT").length + approvedInvalid.lowAmount,
        noWs: workflowOwned.filter((lead) => lead.receptionCategory === "NO_WS").length + approvedInvalid.noWs,
        duplicate: (duplicateByReception.get(person.id) ?? 0) + approvedInvalid.collision,
        invalid: workflowOwned.filter((lead) => lead.receptionCategory === "INVALID").length,
        ...funnel(owned, today),
        ...financials(owned, today),
      };
    })
    .sort((left, right) => right.joined - left.joined || right.replied - left.replied || left.name.localeCompare(right.name, "zh-CN"));

  // 财务的“粉的归属”行：业绩跟随客户归属，不跟随具体由谁录入或联系。
  // 无效粉只有人工数字、没有单个客户可选归属，因此仍归提交该数字的接粉员。
  const fanOwnerIds = new Set([
    ...leadsByFanOwner.keys(),
    ...duplicateByReception.keys(),
    ...approvedInvalidByReception.keys(),
  ]);
  const fanOwners = fanOwnerPeople
    .filter((person) => fanOwnerIds.has(person.id))
    .map((person) => {
      const owned = leadsByFanOwner.get(person.id) ?? [];
      const workflowOwned = owned.filter((lead) => !isHistorical(lead));
      const approvedInvalid = approvedInvalidByReception.get(person.id) ?? { noWs: 0, lowAmount: 0, collision: 0, total: 0 };
      return {
        id: person.id,
        name: person.name,
        active: person.active,
        ...displayScope(person),
        total: workflowOwned.length + approvedInvalid.total,
        lowAmount: workflowOwned.filter((lead) => lead.receptionCategory === "LOW_AMOUNT").length + approvedInvalid.lowAmount,
        noWs: workflowOwned.filter((lead) => lead.receptionCategory === "NO_WS").length + approvedInvalid.noWs,
        duplicate: (duplicateByReception.get(person.id) ?? 0) + approvedInvalid.collision,
        invalid: workflowOwned.filter((lead) => lead.receptionCategory === "INVALID").length,
        ...funnel(owned, today),
        ...financials(owned, today),
      };
    })
    .sort((left, right) => right.netCents - left.netCents || right.joined - left.joined || left.name.localeCompare(right.name, "zh-CN"));

  const groupOperators = people
    // currentInGroupByOperator 是不受 sourceDateFrom/To 影响的快照——窄范围内 leadsByOperator
    // 查不到这个人时，如果只看角色和范围内的经手记录，快照归属到的人会连行都进不来，
    // 这个人的在群数就凭空消失了，答案照样跟着范围变（需求文档6.1.1）。
    .filter((person) => hasScopedRole(person, "GROUP_OPERATOR") || leadsByOperator.has(person.id) || currentInGroupByOperator.has(person.id))
    .map((person) => {
      const receptionistIds = new Set(person.groupOperatorAssignments.map((item) => item.receptionistId));
      const shared = leadsByOperator.get(person.id) ?? [];
      const workflowShared = shared.filter((lead) => !isHistorical(lead));
      const amounts = financials(shared, today);
      const eligible = workflowShared.filter((lead) => {
        if (!hasReachedBusinessDay(lead.joinedOn, today, 2)) return false;
        if (!lead.joinedOn) return false;
        const due = new Date(`${lead.joinedOn}T00:00:00Z`);
        due.setUTCDate(due.getUTCDate() + 2);
        const dueDate = due.toISOString().slice(0, 10);
        return !lead.leftOn || lead.leftOn >= dueDate;
      });
      return {
        id: person.id,
        name: person.name,
        active: person.active,
        ...displayScope(person),
        pairedReceptionCount: receptionistIds.size,
        sharedCustomerCount: workflowShared.length,
        currentInGroup: currentInGroupByOperator.get(person.id) ?? 0,
        introducedActions: distinctLeadCount(introducedActionsByActor.get(person.id) ?? [], (lead) => happenedBy(lead.expertIntroducedOn, today)),
        leaveActions: distinctLeadCount(leaveActionsByActor.get(person.id) ?? [], (lead) => happenedBy(lead.leftOn, today)),
        abnormalLeaveActions: distinctLeadCount(leaveActionsByActor.get(person.id) ?? [], (lead) => happenedBy(lead.leftOn, today) && assessGroupLeave(lead.joinedOn, lead.leftOn).level === "EARLY"),
        downstreamRegistered: workflowShared.filter((lead) => happenedBy(lead.registeredOn, today)).length,
        downstreamContacted: workflowShared.filter((lead) => happenedBy(lead.expertContactedOn, today)).length,
        downstreamOrders: shared.filter((lead) => Boolean(activeOrder(lead, today))).length,
        firstDepositCents: amounts.firstDepositCents,
        depositCents: amounts.depositCents,
        withdrawalCents: amounts.withdrawalCents,
        netCents: amounts.depositCents - amounts.withdrawalCents,
        eligibleForIntroduction: eligible.length,
        introducedEligible: eligible.filter((lead) => happenedBy(lead.expertIntroducedOn, today)).length,
      };
    })
    .sort((left, right) => right.introducedEligible - left.introducedEligible || right.currentInGroup - left.currentInGroup || left.name.localeCompare(right.name, "zh-CN"));

  const experts = people
    .filter((person) => hasScopedRole(person, "EXPERT") || hasScopedRole(person, "LEAD") && leads.some((lead) => lead.expertOwnerId === person.id) || leadsByExpert.has(person.id))
    .map((person) => {
      const assigned = (leadsByExpert.get(person.id) ?? []).filter((lead) => happenedBy(lead.expertIntroducedOn, today));
      const workflowAssigned = assigned.filter((lead) => !isHistorical(lead));
      const eligible = workflowAssigned.filter((lead) => hasReachedBusinessDay(lead.expertIntroducedOn, today, 1));
      const amounts = financials(assigned, today);
      return {
        id: person.id,
        name: person.name,
        active: person.active,
        ...displayScope(person),
        role: person.role === "LEAD" ? "LEAD" as const : "EXPERT" as const,
        assigned: workflowAssigned.length,
        contacted: workflowAssigned.filter((lead) => happenedBy(lead.expertContactedOn, today)).length,
        registered: workflowAssigned.filter((lead) => happenedBy(lead.registeredOn, today)).length,
        orders: assigned.filter((lead) => Boolean(activeOrder(lead, today))).length,
        firstDepositCents: amounts.firstDepositCents,
        depositCents: amounts.depositCents,
        withdrawalCents: amounts.withdrawalCents,
        netCents: amounts.depositCents - amounts.withdrawalCents,
        eligibleForOrder: eligible.length,
        orderedEligible: eligible.filter((lead) => Boolean(activeOrder(lead, today))).length,
      };
    })
    .sort((left, right) => right.netCents - left.netCents || right.orders - left.orders);

  const groupRows = groups
    .map((group) => {
      const groupLeads = leadsByGroup.get(group.id) ?? [];
      return {
        id: group.id,
        name: group.name,
        departmentName: group.department.name,
        countryCode: group.countryCode ?? group.department.countryCode,
        ...funnel(groupLeads, today),
        ...financials(groupLeads, today),
      };
    })
    .sort((left, right) => right.netCents - left.netCents);

  return { reception, fanOwners, groupOperators, experts, groups: groupRows, standardsByGroup: Object.fromEntries(groups.map((group) => [group.id, standardsFromGroup(group)])) };
}
