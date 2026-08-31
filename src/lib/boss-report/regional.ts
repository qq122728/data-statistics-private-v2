import { db } from "../db";
import { businessTimezoneOption, localClockMinutes, resolveGroupBusinessTime } from "../business-time-config";
import { localDateYYYYMMDD } from "../dates";
import { formatUsd } from "../money";
import { loadDailyBossBrief } from "./data";
import type { BossAiAnalysis, DailyBossBrief } from "./types";

const stageOrder = ["QUEUED", "MATERIALS", "TRACKING", "PENDING_REGISTRATION", "PENDING_ORDER", "DECLINED_DEPOSIT", "ORDERED", "STALLED"] as const;
type ExpertStage = typeof stageOrder[number];

const stageLabels: Record<ExpertStage, string> = {
  QUEUED: "排队中",
  MATERIALS: "交资料",
  TRACKING: "追踪中",
  PENDING_REGISTRATION: "待注册",
  PENDING_ORDER: "待开单",
  DECLINED_DEPOSIT: "不愿充",
  ORDERED: "已开单",
  STALLED: "杀不动",
};

export type BossBriefRegion = {
  key: string;
  countryCode: string;
  timezone: string;
  countryLabel: string;
  timezoneLabel: string;
  workEndMinutes: number;
  groupIds: string[];
  groupNames: string[];
};

export type ExpertBriefMember = {
  name: string;
  roleLabel: "专家" | "组长兼专家";
  groupName: string;
  total: number;
  stages: Record<ExpertStage, number>;
  trackingOver48: number;
  trackingStartMissing: number;
};

export type RegionalExpertBrief = {
  region: BossBriefRegion;
  reportDate: string;
  total: number;
  stages: Record<ExpertStage, number>;
  members: ExpertBriefMember[];
  trackingOver48: number;
  trackingStartMissing: number;
};

function emptyStages(): Record<ExpertStage, number> {
  return Object.fromEntries(stageOrder.map((stage) => [stage, 0])) as Record<ExpertStage, number>;
}

function stageFor(lead: { expertWorkflowStage: ExpertStage | null; expertContactedOn: string | null; registeredOn: string | null; customerOrder: { voidedAt: Date | null } | null }): ExpertStage {
  if (lead.expertWorkflowStage) return lead.expertWorkflowStage;
  if (lead.customerOrder && !lead.customerOrder.voidedAt) return "ORDERED";
  if (lead.registeredOn) return "PENDING_ORDER";
  if (lead.expertContactedOn) return "TRACKING";
  return "QUEUED";
}

export async function listBossBriefRegions(): Promise<BossBriefRegion[]> {
  const groups = await db.teamGroup.findMany({
    where: { active: true, department: { active: true } },
    select: {
      id: true,
      name: true,
      countryCode: true,
      timezone: true,
      workStartMinutes: true,
      workEndMinutes: true,
      department: { select: { name: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true } },
    },
    orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
  });
  const regions = new Map<string, BossBriefRegion>();
  for (const group of groups) {
    const businessTime = resolveGroupBusinessTime(group);
    const option = businessTimezoneOption(businessTime.timezone);
    // 同一国家也可能有不一样的下班时间（例如美国东、西部，或不同班次）。
    // 因此这里不能只按“国家”合并，必须连下班时间一起区分。
    const key = `${businessTime.countryCode}:${businessTime.timezone}:${businessTime.workEndMinutes}`;
    const region = regions.get(key) ?? {
      key,
      countryCode: businessTime.countryCode,
      timezone: businessTime.timezone,
      countryLabel: option.countryLabel,
      timezoneLabel: option.label,
      workEndMinutes: businessTime.workEndMinutes,
      groupIds: [],
      groupNames: [],
    };
    region.groupIds.push(group.id);
    region.groupNames.push(`${group.department.name} / ${group.name}`);
    regions.set(key, region);
  }
  return [...regions.values()];
}

/** 22:30 由每个小组自己的下班时间加 30 分钟推导，不使用服务器或中国时间。 */
export function dueBossBriefRegions(regions: BossBriefRegion[], now = new Date()) {
  return regions.filter((region) => {
    const triggerAt = (region.workEndMinutes + 30) % (24 * 60);
    const localMinutes = localClockMinutes(now, region.timezone);
    // 定时器每 5 分钟执行一次；给 30 分钟的重试窗口，也能正确处理跨午夜的班次。
    const minutesSinceTrigger = (localMinutes - triggerAt + 24 * 60) % (24 * 60);
    return minutesSinceTrigger < 30;
  });
}

export async function loadRegionalExpertBrief(region: BossBriefRegion, reportDate: string, now = new Date()): Promise<RegionalExpertBrief> {
  const [people, leads] = await Promise.all([
    db.user.findMany({
      where: { active: true, groupId: { in: region.groupIds }, role: { in: ["EXPERT", "LEAD"] } },
      select: { id: true, name: true, role: true, group: { select: { name: true } } },
      orderBy: [{ group: { name: "asc" } }, { name: "asc" }],
    }),
    db.leadCustomer.findMany({
      where: { invalid: false, leftOn: null, expertIntroducedOn: { not: null }, batch: { groupId: { in: region.groupIds } } },
      select: {
        expertOwnerId: true,
        expertWorkflowStage: true,
        expertContactedOn: true,
        registeredOn: true,
        expertTrackingStartedAt: true,
        expertStageChangedAt: true,
        customerOrder: { select: { voidedAt: true } },
      },
    }),
  ]);
  const members = new Map<string, ExpertBriefMember>();
  for (const person of people) {
    members.set(person.id, {
      name: person.name,
      roleLabel: person.role === "LEAD" ? "组长兼专家" : "专家",
      groupName: person.group?.name ?? "未分组",
      total: 0,
      stages: emptyStages(),
      trackingOver48: 0,
      trackingStartMissing: 0,
    });
  }
  const unassignedId = "__unassigned__";
  const unassigned = (): ExpertBriefMember => {
    const existing = members.get(unassignedId);
    if (existing) return existing;
    const created: ExpertBriefMember = { name: "未分配专家", roleLabel: "专家", groupName: "待分配", total: 0, stages: emptyStages(), trackingOver48: 0, trackingStartMissing: 0 };
    members.set(unassignedId, created);
    return created;
  };
  const stages = emptyStages();
  let trackingOver48 = 0;
  let trackingStartMissing = 0;
  for (const lead of leads) {
    const stage = stageFor(lead as Parameters<typeof stageFor>[0]);
    const member = lead.expertOwnerId ? members.get(lead.expertOwnerId) ?? unassigned() : unassigned();
    member.total += 1;
    member.stages[stage] += 1;
    stages[stage] += 1;
    if (stage === "TRACKING") {
      const startedAt = lead.expertTrackingStartedAt ?? lead.expertStageChangedAt;
      if (!startedAt) {
        member.trackingStartMissing += 1;
        trackingStartMissing += 1;
      } else if (now.getTime() - startedAt.getTime() > 48 * 60 * 60 * 1000) {
        member.trackingOver48 += 1;
        trackingOver48 += 1;
      }
    }
  }
  return { region, reportDate, total: leads.length, stages, members: [...members.values()], trackingOver48, trackingStartMissing };
}

type OperatingTotals = DailyBossBrief["totals"];

function emptyOperatingTotals(): OperatingTotals {
  return { newFans: 0, effectiveFans: 0, replies: 0, groupJoin: 0, expertIntro: 0, expertContacted: 0, registration: 0, orders: 0, rechargeCents: 0, withdrawalCents: 0, netPerformanceCents: 0 };
}

function addGroupToTotals(totals: OperatingTotals, row: DailyBossBrief["groupRows"][number]) {
  totals.newFans += row.newFans;
  totals.effectiveFans += row.effectiveFans;
  totals.replies += row.replies;
  totals.groupJoin += row.groupJoin;
  totals.expertIntro += row.expertIntro;
  totals.expertContacted += row.expertContacted;
  totals.registration += row.registration;
  totals.orders += row.orders;
  totals.rechargeCents += row.rechargeCents;
  totals.withdrawalCents += row.withdrawalCents;
  totals.netPerformanceCents += row.netPerformanceCents;
  return totals;
}

function operatingLines(label: string, totals: OperatingTotals) {
  return [
    `${label}｜添加 ${totals.newFans}｜有效 ${totals.effectiveFans}｜回复 ${totals.replies}｜进群 ${totals.groupJoin}`,
    `推专家 ${totals.expertIntro}｜已联系 ${totals.expertContacted}｜注册 ${totals.registration}｜开单 ${totals.orders}`,
    `入金 ${formatUsd(totals.rechargeCents)}｜出金 ${formatUsd(totals.withdrawalCents)}｜净业绩 ${formatUsd(totals.netPerformanceCents)}`,
  ];
}

export function formatRegionalOperatingBrief(region: BossBriefRegion, brief: DailyBossBrief, _ai: BossAiAnalysis | null = null) {
  const departments = new Map<string, DailyBossBrief["groupRows"]>();
  for (const row of brief.groupRows) {
    const rows = departments.get(row.departmentName) ?? [];
    rows.push(row);
    departments.set(row.departmentName, rows);
  }
  const lines = [
    `📊 当日小组数据和业绩统计｜${region.countryLabel} · ${region.timezoneLabel}`,
    `业务日期：${brief.reportDate}`,
    "统计口径：只统计当天实际发生的数据与资金；每个部门先列小组，再做部门汇总。",
  ];
  for (const [departmentName, rows] of departments) {
    lines.push("", `【${departmentName}｜当日小组数据】`);
    for (const row of rows) lines.push(...operatingLines(row.name, row));
    const departmentTotals = rows.reduce(addGroupToTotals, emptyOperatingTotals());
    lines.push("", ...operatingLines(`${departmentName}汇总`, departmentTotals));
  }
  if (!departments.size) lines.push("", "今天暂无已生效的小组数据。");
  lines.push("", "【本地区总汇总】", ...operatingLines(`${region.countryLabel}合计`, brief.totals));
  return lines.join("\n");
}

export function formatRegionalExpertBrief(brief: RegionalExpertBrief) {
  const lines = [
    `👨‍💼 全部专家情况简报｜${brief.region.countryLabel} · ${brief.region.timezoneLabel}`,
    `业务日期：${brief.reportDate}｜小组：${brief.region.groupNames.join("、")}`,
    `当前专家客户库存：${brief.total}`,
    "",
    "【全体阶段】",
    stageOrder.map((stage) => `${stageLabels[stage]} ${brief.stages[stage]}`).join("｜"),
    "",
    "【专家逐人情况】",
    ...brief.members.map((member, index) => `${index + 1}. ${member.groupName} / ${member.name}（${member.roleLabel}）：负责 ${member.total}｜${stageOrder.filter((stage) => member.stages[stage] > 0).map((stage) => `${stageLabels[stage]} ${member.stages[stage]}`).join("｜") || "暂无客户"}`),
    "",
    "【必须处理】",
    `排队中 ${brief.stages.QUEUED}｜追踪中 ${brief.stages.TRACKING}｜待开单 ${brief.stages.PENDING_ORDER}`,
    `追踪超过 48 小时 ${brief.trackingOver48}｜追踪开始时间缺失 ${brief.trackingStartMissing}`,
    "处理规则：排队中先分配接待；追踪中必须填写开始时间和下一步计划；待开单客户当天补充跟进计划。",
  ];
  return lines.join("\n");
}

export async function prepareRegionalBossBriefs(region: BossBriefRegion, reportDate = localDateYYYYMMDD(new Date(), region.timezone), now = new Date()) {
  const [operating, experts] = await Promise.all([
    loadDailyBossBrief(reportDate, { groupIds: region.groupIds }),
    loadRegionalExpertBrief(region, reportDate, now),
  ]);
  // 地区推送改为可核对的部门/小组当日数据，不再消耗 AI 额度生成主观分析。
  const ai: BossAiAnalysis | null = null;
  return {
    region,
    reportDate,
    operating,
    ai,
    experts,
    operatingMessage: formatRegionalOperatingBrief(region, operating, ai),
    expertMessage: formatRegionalExpertBrief(experts),
  };
}
