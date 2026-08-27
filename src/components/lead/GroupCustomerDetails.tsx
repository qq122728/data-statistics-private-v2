import { NotePencil } from "@phosphor-icons/react";
import { groupDayNumber } from "../../lib/group-progress";
import { assessGroupLeave, leaveOrderLabel } from "../../lib/group-leave";
import { formatUsd as money } from "../../lib/money";
import type { GroupCustomer } from "./group-customer-types";
import { groupCustomerExpertSituation, groupCustomerNet } from "./group-customer-view";
import { expertWorkflowStageLabel, expertWorkflowTrackingHours, expertWorkflowTrackingOverdue, resolveExpertWorkflowStage } from "../../lib/expert-workflow-stage";

export function GroupCustomerDetails({
  customer,
  canEdit,
  today,
  onClose,
  onProgress,
}: {
  customer: GroupCustomer | null;
  canEdit: boolean;
  today: string;
  onClose: () => void;
  onProgress: () => void;
}) {
  if (!customer) return null;
  const day = groupDayNumber(customer.joinedOn, customer.groupStatus === "LEFT" && customer.leftOn ? customer.leftOn : today);
  const leaveAssessment = assessGroupLeave(customer.joinedOn, customer.leftOn);
  const expertStage = resolveExpertWorkflowStage({ ...customer, hasActiveOrder: Boolean(customer.order && !customer.order.voided) });
  const trackingHours = expertWorkflowTrackingHours(customer);
  return <section className="panel">
    <div className="panel-header flex-wrap gap-3"><div><h2 className="panel-title">{customer.customerName ?? "未填写姓名"} · {customer.phone}{customer.isHistoricalRecord ? <span className="ml-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 align-middle text-xs font-semibold text-amber-800">历史补录</span> : null}</h2><p className="panel-subtitle">客户完整跟进记录</p></div><button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700" onClick={onClose}>收起详情</button></div>
    <div className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0">
      <div className="space-y-3 p-5 text-sm text-slate-700">
        <p className="m-0"><strong>粉的归属：</strong>{customer.attributionOwnerName ?? customer.ownerName}</p><p className="m-0"><strong>实际接粉：</strong>{customer.ownerName}</p><p className="m-0"><strong>{customer.isHistoricalRecord ? "历史来源渠道" : "来源"}：</strong>{customer.sourceDate} · {customer.channelName}</p><p className="m-0"><strong>客户邮箱：</strong>{customer.customerEmail ?? "未填写"}</p><p className="m-0"><strong>客户金额：</strong>{customer.lossAmountCents === null || customer.lossAmountCents === undefined ? "未填写" : money(customer.lossAmountCents)}</p><p className="m-0"><strong>客户平台：</strong>{customer.customerPlatform ?? "未填写"}</p><p className="m-0"><strong>接粉设备编号：</strong>{customer.deviceCode ?? "未登记"}</p><p className="m-0"><strong>炒群号码：</strong>{customer.groupDeviceAccountNumber ?? "未填写"}</p><p className="m-0"><strong>专家号码：</strong>{customer.expertDeviceAccountNumber ?? "未填写"}</p><div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3"><p className="m-0 text-xs font-bold tracking-wide text-blue-800">接粉情况</p><p className="mt-2 mb-0"><strong>联系日期：</strong>{customer.repliedOn ?? "未联系"}　<strong>回访：</strong>{customer.followUpCount} 次</p><p className="mt-1 mb-0"><strong>最近回访：</strong>{customer.lastFollowedUpOn ?? "—"}</p><p className="mt-1 mb-0"><strong>客户情况：</strong>{customer.notes ?? "前台暂未填写"}</p></div>
      </div>
      <div className="space-y-3 p-5 text-sm text-slate-700">
        <p className="m-0"><strong>群状态：</strong>{customer.groupStatus === "JOINED" ? "在群" : "已退群"}</p>
        <p className="m-0"><strong>入群：</strong>{customer.joinedOn ?? "—"}{day ? ` · ${customer.groupStatus === "JOINED" ? "当前进群" : "群内共"}第 ${day} 天` : ""}</p>
        <p className="m-0"><strong>退群：</strong>{customer.leftOn ?? "—"}</p>{customer.groupStatus === "LEFT" ? <><p className="m-0"><strong>退群判断：</strong>{leaveAssessment.dayNumber ? `第 ${leaveAssessment.dayNumber} 天 · ` : ""}{leaveAssessment.label}</p><p className="m-0"><strong>退群当时：</strong>{leaveOrderLabel(customer.leftWithOrder)}</p><p className="m-0"><strong>退群备注：</strong>{customer.leftNote ?? "未填写"}</p></> : null}<p className="m-0"><strong>推专家：</strong>{customer.expertIntroducedOn ?? "未完成"}</p><p className="m-0"><strong>专家负责人：</strong>{customer.expertOwnerName ?? "待选择负责人"}</p>
        <p className="m-0"><strong>专家阶段：</strong>{expertWorkflowStageLabel(expertStage)}{expertStage === "TRACKING" && trackingHours !== null ? <span className={expertWorkflowTrackingOverdue(customer) ? "font-semibold text-rose-700" : ""}> · 已追踪 {trackingHours} 小时{expertWorkflowTrackingOverdue(customer) ? "（超过 48 小时）" : ""}</span> : null}</p><p className="m-0"><strong>专家联系：</strong>{customer.expertContactedOn ? `${customer.expertContactedOn}${customer.expertContactNote ? ` · ${customer.expertContactNote}` : ""}` : customer.expertIntroducedOn ? "尚未开始接待" : "尚未推专家"}</p><p className="m-0"><strong>专家情况：</strong>{groupCustomerExpertSituation(customer)}</p>
        <p className="m-0"><strong>注册：</strong>{customer.registeredOn ?? "未完成"}</p><p className="m-0"><strong>开单：</strong>{customer.order && !customer.order.voided ? `${customer.order.openedOn} · 首充 ${money(customer.order.initialDepositCents)}` : "未开单"}</p>
        <p className="m-0"><strong>续充：</strong>{customer.order ? money(customer.order.rechargeCents) : "—"}　<strong>出金：</strong>{customer.order ? money(customer.order.withdrawalCents) : "—"}</p><p className="m-0 text-base"><strong>净业绩：</strong>{money(groupCustomerNet(customer))}</p>
      </div>
    </div>
        <div className="border-t border-slate-100 p-5"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="m-0 text-sm font-bold text-slate-800">炒群每日进度</h3>{canEdit ? <button type="button" onClick={onProgress} className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"><NotePencil size={14} weight="duotone" />{customer.groupProgress.some((item) => item.occurredOn === today) ? "继续填写今日进度" : "填写炒群情况"}</button> : null}</div>
      {customer.groupProgress.length ? <div className="overflow-hidden rounded-lg border border-slate-200">{customer.groupProgress.map((item) => <div key={item.id} className="grid gap-1 border-b border-slate-100 px-3 py-2.5 text-sm last:border-b-0 md:grid-cols-[110px_1fr_120px]"><strong className="text-slate-700">{item.occurredOn}</strong><span className="text-slate-700">{item.note}</span><span className="text-xs text-slate-500 md:text-right">{item.actorName}</span></div>)}</div> : <p className="m-0 rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-500">还没有每日进度记录。</p>}
    </div>
  </section>;
}
