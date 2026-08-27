import { redirect } from "next/navigation";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { buildCustomerTimeline } from "../../../lib/customer-timeline";
import { deriveCustomerFollowUpStage, customerFollowUpStageLabels } from "../../../lib/customer-follow-up";
import { db } from "../../../lib/db";

type SearchParams = { phone?: string | string[] };
const first = (value: string | string[] | undefined) => typeof value === "string" ? value : "";
const cleanPhone = (value: string) => value.replace(/\D/g, "").slice(0, 32);

export default async function CustomerTimelinePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) redirect("/login?next=/customer-timeline");
    throw error;
  }
  if (user.role !== "ADMIN" && user.role !== "LEAD") redirect("/dashboard");

  const params = await searchParams;
  const phone = cleanPhone(first(params.phone));
  const searchReady = phone.length >= 4;
  const leads = searchReady ? await db.leadCustomer.findMany({
    where: {
      phone: { contains: phone },
      ...(user.role === "LEAD" ? { batch: { groupId: user.groupId ?? "__none__" } } : {}),
    },
    select: {
      id: true,
      phone: true,
      customerName: true,
      invalid: true,
      invalidReason: true,
      replyStatus: true,
      groupStatus: true,
      expertIntroducedOn: true,
      registeredOn: true,
      expertOwnerId: true,
      nextPlan: true,
      nextFollowUpOn: true,
      notes: true,
      createdAt: true,
      owner: {
        select: {
          name: true,
          receptionistAssignments: {
            where: { groupOperator: { active: true } },
            select: { groupOperator: { select: { name: true } } },
          },
        },
      },
      expertOwner: { select: { name: true } },
      device: { select: { code: true } },
      batch: { select: { sourceDate: true, channel: { select: { name: true } }, group: { select: { name: true } } } },
      activities: {
        select: { id: true, kind: true, occurredOn: true, createdAt: true, note: true, actor: { select: { name: true } } },
        orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }],
      },
      customerOrder: {
        select: {
          id: true, openedOn: true, createdAt: true, initialDepositCents: true, voidedAt: true, voidReason: true,
          enteredBy: { select: { name: true } },
          events: {
            select: { id: true, kind: true, occurredOn: true, createdAt: true, amountCents: true, continuationNumber: true, voidedAt: true, voidReason: true, enteredBy: { select: { name: true } } },
            orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }],
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
  }) : [];

  return <main className="page-shell space-y-3">
    <div className="page-heading"><div><h1 className="page-title">号码查询</h1><p className="page-description">输入完整号码或后 6/8 位，一次查看提交号码、回复、入群、炒群、专家、注册、开单和资金记录。</p></div></div>
    <form action="/customer-timeline" className="toolbar">
      <label className="field-label min-w-[280px] flex-1">客户号码<input name="phone" inputMode="numeric" defaultValue={phone} placeholder="输入完整号码、后 8 位或后 6 位" className="control" /></label>
      <button className="inline-flex min-h-10 items-center rounded-lg bg-[#0b66ff] px-5 py-2 text-sm font-semibold text-white hover:bg-[#0757dc]">查询时间线</button>
      {phone ? <a href="/customer-timeline" className="pb-2 text-sm text-slate-500">清除</a> : null}
    </form>
    {phone && !searchReady ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">至少输入 4 位数字，建议使用后 6 位或后 8 位，避免匹配到太多号码。</p> : null}
    {searchReady && leads.length > 1 ? <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">后几位匹配到 {leads.length} 位客户，下面分别展示，不会合并记录。</p> : null}
    {searchReady && !leads.length ? <section className="panel"><div className="empty-state">没有找到这个号码。组长只能查询自己小组的客户。</div></section> : null}
    {!phone ? <section className="panel"><div className="empty-state">请输入号码开始查询。号码不会因为跨天而消失。</div></section> : null}
    {leads.map((lead) => {
      const stage = deriveCustomerFollowUpStage({ invalid: lead.invalid, groupStatus: lead.groupStatus, replyStatus: lead.replyStatus, expertIntroducedOn: lead.expertIntroducedOn, registeredOn: lead.registeredOn, expertOwnerId: lead.expertOwnerId, order: lead.customerOrder });
      const timeline = buildCustomerTimeline({
        sourceDate: lead.batch.sourceDate,
        createdAt: lead.createdAt,
        ownerName: lead.owner.name,
        channelName: lead.batch.channel.name,
        activities: lead.activities.map((activity) => ({ ...activity, actorName: activity.actor.name })),
        order: lead.customerOrder ? {
          id: lead.customerOrder.id,
          openedOn: lead.customerOrder.openedOn,
          createdAt: lead.customerOrder.createdAt,
          initialDepositCents: lead.customerOrder.initialDepositCents,
          voidedAt: lead.customerOrder.voidedAt,
          voidReason: lead.customerOrder.voidReason,
          enteredByName: lead.customerOrder.enteredBy.name,
          events: lead.customerOrder.events.map((event) => ({ ...event, enteredByName: event.enteredBy.name })),
        } : null,
      });
      const operators = [...new Set(lead.owner.receptionistAssignments.map((item) => item.groupOperator.name))];
      return <section key={lead.id} className="panel overflow-hidden">
        <div className="panel-header"><div><h2 className="panel-title">{lead.phone} <span className="ml-2 text-sm font-normal text-slate-500">{lead.customerName || "未填姓名"}</span></h2><p className="panel-subtitle">{lead.batch.group.name} · {lead.batch.sourceDate} · {lead.batch.channel.name}</p></div><span className="analysis-status" data-tone={stage === "ORDERED" ? "success" : lead.invalid ? "danger" : "neutral"}>{customerFollowUpStageLabels[stage]}</span></div>
        <div className="grid divide-y divide-slate-100 border-b border-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-5">
          {[["接粉负责人", lead.owner.name], ["炒群负责人", operators.join("、") || "未配置"], ["专家负责人", lead.expertOwner?.name || "未分配"], ["设备号", lead.device?.code || "未填写"], ["下一步", lead.nextPlan || "未填写"]].map(([label, value]) => <div key={label} className="px-4 py-3"><span className="block text-xs text-slate-500">{label}</span><strong className="mt-1 block text-sm text-slate-800">{value}</strong></div>)}
        </div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>日期</th><th>流程动作</th><th>操作人</th><th>说明</th><th>状态</th></tr></thead><tbody>{timeline.map((event) => <tr key={event.key} className={event.voided ? "opacity-60" : ""}><td>{event.occurredOn}</td><td><strong>{event.label}</strong></td><td>{event.actorName}</td><td>{event.detail}</td><td><span className="analysis-status" data-tone={event.voided ? "danger" : "success"}>{event.voided ? "已作废" : "有效"}</span></td></tr>)}</tbody></table></div>
        <div className="flex flex-wrap justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm"><span className="text-slate-500">共 {timeline.length} 条记录{lead.nextFollowUpOn ? ` · 下次跟进 ${lead.nextFollowUpOn}` : ""}</span><div className="flex gap-4"><a className="font-semibold text-blue-700" href="/group-customers">查看群内跟进</a><a className="font-semibold text-blue-700" href="/expert-customers">查看专家跟进</a></div></div>
      </section>;
    })}
  </main>;
}
