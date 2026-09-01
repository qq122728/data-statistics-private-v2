import { Prisma } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { statisticsDate } from "../../../lib/statistics-date";
import { db } from "../../../lib/db";
import { getSystemSettings } from "../../../lib/settings";
import { LeadDateRangeFilter } from "../../../components/lead/LeadDateRangeFilter";
import { resolveDateRangeWithDefault } from "../../../lib/lead-date-range";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => typeof value === "string" ? value : "";
const dayNumber = (joinedOn: string, today: string) => Math.max(1, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${joinedOn}T00:00:00Z`)) / 86_400_000) + 1);

const stages = ["JOINED", "INTRODUCED", "CONTACTED", "REGISTERED", "ORDERED"] as const;
type Stage = typeof stages[number];
const stageLabels: Record<Stage, string> = { JOINED: "已入群", INTRODUCED: "已推专家", CONTACTED: "已联系专家", REGISTERED: "已注册", ORDERED: "已开单" };

function exactStageWhere(stage: Stage): Prisma.LeadCustomerWhereInput {
  if (stage === "ORDERED") return { customerOrder: { is: { voidedAt: null } } };
  if (stage === "REGISTERED") return { registeredOn: { not: null }, OR: [{ customerOrder: { is: null } }, { customerOrder: { is: { voidedAt: { not: null } } } }] };
  if (stage === "CONTACTED") return { expertContactedOn: { not: null }, registeredOn: null };
  if (stage === "INTRODUCED") return { expertIntroducedOn: { not: null }, expertContactedOn: null };
  return { joinedOn: { not: null }, expertIntroducedOn: null };
}

function currentStage(lead: { expertIntroducedOn: string | null; expertContactedOn: string | null; registeredOn: string | null; customerOrder: { voidedAt: Date | null } | null }): Stage {
  if (lead.customerOrder && !lead.customerOrder.voidedAt) return "ORDERED";
  if (lead.registeredOn) return "REGISTERED";
  if (lead.expertContactedOn) return "CONTACTED";
  if (lead.expertIntroducedOn) return "INTRODUCED";
  return "JOINED";
}

function pageHref(params: URLSearchParams, page: number) {
  const next = new URLSearchParams(params);
  if (page <= 1) next.delete("page"); else next.set("page", String(page));
  return `/resource-conversion?${next.toString()}`;
}

export default async function ResourceConversionPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let user;
  try { user = await requireUser(); }
  catch (error) { if (error instanceof AuthenticationError) redirect("/login?next=/resource-conversion"); throw error; }
  if (user.role !== "RESOURCE_MANAGER") redirect("/dashboard");
  const allowedChannelIds = user.resourceChannelAccess?.map((access) => access.channelId) ?? [];

  const [raw, settings, groups, departments] = await Promise.all([
    searchParams,
    getSystemSettings(),
    db.teamGroup.findMany({ where: { active: true }, select: { id: true, name: true, departmentId: true, department: { select: { name: true } } }, orderBy: [{ department: { name: "asc" } }, { name: "asc" }] }),
    db.department.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const today = statisticsDate();
  const rawValues = Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => {
    const current = first(value);
    return current ? [[key, current]] : [];
  }));
  const dateRange = resolveDateRangeWithDefault(rawValues, today, "month");
  const from = dateRange.from;
  const to = dateRange.to;
  const departmentId = first(raw.departmentId);
  const requestedGroupId = first(raw.groupId);
  const visibleGroups = departmentId ? groups.filter((group) => group.departmentId === departmentId) : groups;
  const groupId = visibleGroups.some((group) => group.id === requestedGroupId) ? requestedGroupId : "";
  const normalizedName = first(raw.normalizedName);
  const tail = first(raw.tail).replace(/\D/g, "").slice(-6);
  const requestedStage = first(raw.stage);
  const stage = stages.includes(requestedStage as Stage) ? requestedStage as Stage : undefined;
  const page = Math.max(1, Number.parseInt(first(raw.page), 10) || 1);
  const take = 50;
  const groupIds = groupId ? [groupId] : visibleGroups.map((group) => group.id);
  const baseWhere: Prisma.LeadCustomerWhereInput = {
    invalid: false,
    isHistoricalRecord: false,
    joinedOn: { not: null },
    ...(tail ? { phone: { endsWith: tail } } : {}),
    batch: {
      groupId: { in: groupIds.length ? groupIds : ["__none__"] },
      channelId: { in: allowedChannelIds },
      isHistoricalRecord: false,
      sourceDate: { gte: from, lte: to },
      ...(normalizedName ? { channel: { normalizedName } } : {}),
    },
  };
  const where: Prisma.LeadCustomerWhereInput = stage ? { AND: [baseWhere, exactStageWhere(stage)] } : baseWhere;
  const [total, leads, counts, rawChannels] = await Promise.all([
    db.leadCustomer.count({ where }),
    db.leadCustomer.findMany({
      where,
      select: {
        id: true, joinedOn: true, expertIntroducedOn: true, expertContactedOn: true, registeredOn: true,
        owner: { select: { name: true, receptionistAssignments: { where: { groupOperator: { active: true } }, select: { groupOperator: { select: { name: true } } } } } },
        expertOwner: { select: { name: true } },
        batch: { select: { sourceDate: true, group: { select: { name: true } }, channel: { select: { name: true } } } },
        customerOrder: { select: { openedOn: true, voidedAt: true } },
        activities: { where: { kind: "GROUP_PROGRESS_UPDATED" }, select: { occurredOn: true }, orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }], take: 1 },
      },
      orderBy: [{ joinedOn: "desc" }, { updatedAt: "desc" }],
      skip: (page - 1) * take,
      take,
    }),
    Promise.all(stages.map(async (item) => [item, await db.leadCustomer.count({ where: { AND: [baseWhere, exactStageWhere(item)] } })] as const)),
    db.channel.findMany({ where: { groupId: { in: groupIds.length ? groupIds : ["__none__"] }, id: { in: allowedChannelIds } }, select: { normalizedName: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const countMap = Object.fromEntries(counts) as Record<Stage, number>;
  const channels = [...new Map(rawChannels.map((channel) => [channel.normalizedName, channel])).values()];
  const pages = Math.max(1, Math.ceil(total / take));
  const preserved = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) { const item = first(value); if (item && key !== "page") preserved.set(key, item); }
  preserved.set("range", dateRange.preset);
  preserved.set("sourceDateFrom", dateRange.from);
  preserved.set("sourceDateTo", dateRange.to);
  const allStagesParams = new URLSearchParams(preserved);
  allStagesParams.delete("stage");
  // 不从 ORM 读取完整号码。数据库只返回最后 6 位，避免完整号码进入
  // React Server Components 的传输内容，即使查看网页源码也拿不到。
  const phoneTails = leads.length ? await db.$queryRaw<Array<{ id: string; phoneTail: string }>>(Prisma.sql`
    SELECT "id", substr("phone", -6) AS "phoneTail"
    FROM "LeadCustomer"
    WHERE "id" IN (${Prisma.join(leads.map((lead) => lead.id))})
  `) : [];
  const phoneTailById = new Map(phoneTails.map((item) => [item.id, item.phoneTail]));
  const safeRows = leads.map((lead) => ({
    id: lead.id,
    shortId: lead.id.slice(-4).toUpperCase(),
    phoneTail: phoneTailById.get(lead.id) ?? "------",
    joinedOn: lead.joinedOn!,
    groupName: lead.batch.group.name,
    channelName: lead.batch.channel.name,
    sourceDate: lead.batch.sourceDate,
    stage: currentStage(lead),
    receptionistName: lead.owner.name,
    operatorNames: [...new Set(lead.owner.receptionistAssignments.map((assignment) => assignment.groupOperator.name))],
    expertName: lead.expertOwner?.name ?? "未分配",
    lastProgressOn: lead.activities[0]?.occurredOn ?? null,
  }));

  return <main className="page-shell space-y-3">
    <div className="page-heading"><div><h1 className="page-title">入群后跟进</h1><p className="page-description">只看已入群及后续客户；号码固定只显示后 6 位，页面没有修改按钮。</p></div></div>
    <LeadDateRangeFilter pathname="/resource-conversion" range={dateRange} today={today} preserve={{ departmentId, groupId, normalizedName, tail, stage }} ariaLabel="入群后跟进时间范围" />
    <form action="/resource-conversion" className="panel resource-filter-bar">
      <input type="hidden" name="range" value={dateRange.preset} />
      <input type="hidden" name="sourceDateFrom" value={dateRange.from} />
      <input type="hidden" name="sourceDateTo" value={dateRange.to} />
      <label><span>公司</span><select className="control" name="departmentId" defaultValue={departmentId}><option value="">全部公司</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
      <label><span>小组</span><select className="control" name="groupId" defaultValue={groupId}><option value="">全部小组</option>{visibleGroups.map((group) => <option key={group.id} value={group.id}>{group.department.name} / {group.name}</option>)}</select></label>
      <label><span>渠道</span><select className="control" name="normalizedName" defaultValue={normalizedName}><option value="">全部渠道</option>{channels.map((channel) => <option key={channel.normalizedName} value={channel.normalizedName}>{channel.name}</option>)}</select></label>
      <label><span>号码后6位</span><input className="control" name="tail" inputMode="numeric" defaultValue={tail} maxLength={6} placeholder="例如 123456" /></label>
      <button className="resource-filter-submit" type="submit">查询</button>
      <Link className="resource-filter-reset" href="/resource-conversion">重置</Link>
    </form>
    <section className="panel overflow-hidden">
      <div className="resource-stage-tabs"><Link href={pageHref(allStagesParams, 1)} data-active={!stage}>全部 <strong>{Object.values(countMap).reduce((sum, value) => sum + value, 0)}</strong></Link>{stages.map((item) => { const params = new URLSearchParams(preserved); params.set("stage", item); return <Link key={item} href={pageHref(params, 1)} data-active={stage === item}>{stageLabels[item]} <strong>{countMap[item]}</strong></Link>; })}</div>
      <div className="data-table-wrap"><table className="data-table resource-conversion-table"><thead><tr><th>号码</th><th>小组</th><th>来源</th><th>入群进度</th><th>当前阶段</th><th>接粉 / 炒群 / 专家</th><th>最后群内进度</th></tr></thead><tbody>{safeRows.map((lead) => <tr key={lead.id}><td><strong>•••• {lead.phoneTail}</strong><small className="block text-slate-400">编号 {lead.shortId}</small></td><td>{lead.groupName}</td><td>{lead.sourceDate}<small className="block text-slate-500">{lead.channelName}</small></td><td>{lead.joinedOn}<small className="block text-slate-500">进群第 {dayNumber(lead.joinedOn, today)} 天</small></td><td><span className="analysis-status" data-tone={lead.stage === "ORDERED" ? "success" : lead.stage === "JOINED" ? "warning" : "neutral"}>{stageLabels[lead.stage]}</span></td><td>{lead.receptionistName}<small className="block text-slate-500">{lead.operatorNames.join("、") || "未配置炒群"} / {lead.expertName}</small></td><td>{lead.lastProgressOn ?? "尚未填写"}</td></tr>)}{!safeRows.length ? <tr><td colSpan={7} className="empty-state">当前筛选下没有已入群客户</td></tr> : null}</tbody></table></div>
      <div className="resource-pagination"><span>共 {total} 条 · 第 {Math.min(page, pages)} / {pages} 页</span><div>{page > 1 ? <Link href={pageHref(preserved, page - 1)}>上一页</Link> : <span>上一页</span>}{page < pages ? <Link href={pageHref(preserved, page + 1)}>下一页</Link> : <span>下一页</span>}</div></div>
    </section>
  </main>;
}
