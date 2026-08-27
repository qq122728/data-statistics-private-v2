"use client";

import { formatUsd } from "../../lib/money";
import {
  expertWorkflowStageLabel,
  resolveExpertWorkflowStage,
} from "../../lib/expert-workflow-stage";
import { Drawer } from "../ui/Drawer";
import type { EntryLead } from "./entry-types";

export function CustomerProfileDetails({ lead }: { lead: EntryLead }) {
  const groupOperator = lead.groupOperatorOwner?.name
    ?? lead.owner.receptionistAssignments[0]?.groupOperator.name
    ?? "待分配";
  return <>
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="mb-3 text-sm font-bold text-slate-900">客户基本资料</h3>
      <dl className="grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2">
        <ProfileItem label="客户编号" value={lead.phone} />
        <ProfileItem label="客户姓名" value={lead.customerName ?? "未填写"} />
        <ProfileItem label="客户邮箱" value={lead.customerEmail ?? "未填写"} />
        <ProfileItem label="前台接粉设备" value={lead.device?.code ?? "未填写"} />
        <ProfileItem label="客户金额" value={lead.lossAmountCents === null ? "未填写" : formatUsd(lead.lossAmountCents)} />
        <ProfileItem label="客户平台" value={lead.customerPlatform ?? "未填写"} />
        <ProfileItem label={lead.isHistoricalRecord ? "历史来源渠道" : "来源渠道"} value={`${lead.batch.sourceDate} · ${lead.isHistoricalRecord ? (lead.historicalSourceName || lead.batch.channel.name) : lead.batch.channel.name}`} />
        <ProfileItem label="粉的归属" value={lead.attributionOwner?.name ?? lead.owner.name} />
        <ProfileItem label="炒群负责人" value={groupOperator} />
      </dl>
      <div className="mt-3 border-t border-slate-200 pt-3 text-sm"><strong className="text-slate-700">客户情况（接粉填写）：</strong><span className="text-slate-600">{lead.notes ?? "未填写"}</span></div>
    </section>
    <section className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm">
      <h3 className="mb-3 text-sm font-bold text-slate-900">当前交接情况</h3>
      <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
        <ProfileItem label="炒群状态" value={lead.groupStatus === "JOINED" ? `在群 · ${lead.joinedOn ?? "—"}` : lead.groupStatus === "LEFT" ? `已退群 · ${lead.leftOn ?? "—"}` : "待入群"} />
        <ProfileItem label="专家负责人" value={lead.expertOwner?.name ?? "尚未分配"} />
        <ProfileItem
          label="专家进度"
          value={expertWorkflowStageLabel(resolveExpertWorkflowStage({
            expertWorkflowStage: lead.expertWorkflowStage,
            expertIntroducedOn: lead.expertIntroducedOn,
            expertContactedOn: lead.expertContactedOn,
            expertTrackingStartedAt: lead.expertTrackingStartedAt,
            registeredOn: lead.registeredOn,
            hasActiveOrder: Boolean(lead.customerOrder && !lead.customerOrder.voidedAt),
          }))}
        />
        <ProfileItem label="下一步计划" value={lead.nextPlan ?? "尚未填写"} />
      </div>
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <h3 className="mb-3 text-sm font-bold text-slate-900">回复操作记录</h3>
      {lead.activities.filter((activity) => activity.kind === "REPLIED" || activity.kind === "REPLY_UNDONE").length ? <ol className="space-y-2 pl-5">
        {lead.activities.filter((activity) => activity.kind === "REPLIED" || activity.kind === "REPLY_UNDONE").map((activity) => <li key={activity.id}>
          <strong className={activity.kind === "REPLY_UNDONE" ? "text-amber-700" : "text-emerald-700"}>{activity.kind === "REPLY_UNDONE" ? "已撤销回复" : "已标记回复"}</strong>
          <span className="text-slate-600"> · {activity.occurredOn} · {activity.actor.name}{activity.note ? ` · ${activity.note}` : ""}</span>
        </li>)}
      </ol> : <p className="m-0 text-slate-500">暂时没有回复操作记录。</p>}
    </section>
  </>;
}

function ProfileItem({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-0.5 break-words font-medium text-slate-800">{value}</dd></div>;
}

export function CustomerProfileDrawer({ lead, onClose }: { lead: EntryLead | null; onClose: () => void }) {
  return <Drawer title={lead ? `${lead.phone} · 客户资料` : "客户资料"} open={Boolean(lead)} onClose={onClose} className="max-w-xl">
    {lead ? <div className="space-y-4 p-5"><CustomerProfileDetails lead={lead} /></div> : null}
  </Drawer>;
}
