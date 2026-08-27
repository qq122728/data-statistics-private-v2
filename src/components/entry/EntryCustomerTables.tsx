import { Check, Eye, SignIn } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { TableActionMenu } from "../ui/TableActionMenu";
import { EntryWorkflowNextStep, EntryWorkflowStatus } from "./EntryWorkflowStatus";
import type { EntryLead } from "./entry-types";
import { groupDayNumber } from "../../lib/group-progress";
import { expertWorkflowStageLabel, resolveExpertWorkflowStage } from "../../lib/expert-workflow-stage";
import { receptionReplyArchiveType } from "../../lib/reception-reply-queue";

type SharedTableProps = {
  rows: EntryLead[];
  notes: (lead: EntryLead) => ReactNode;
  actionDisabled: (lead: EntryLead) => boolean;
  onAction: (lead: EntryLead, action: string) => void;
  context: (lead: EntryLead) => ReactNode;
  empty: (text: string) => ReactNode;
};

export function EntryGroupTable({
  rows,
  mode,
  actionDisabled,
  onAction,
  context,
  notes,
  empty,
  today,
  onViewProgress,
  onViewProfile,
  onVoidErroneousEntry,
  onReceptionStatus,
  onArchive,
}: SharedTableProps & {
  mode: "pending" | "joined" | "left";
  today: string;
  onViewProgress: (lead: EntryLead) => void;
  onViewProfile: (lead: EntryLead) => void;
  onVoidErroneousEntry?: (lead: EntryLead) => void;
  onReceptionStatus: (lead: EntryLead, status: "NORMAL_CHAT" | "READY_TO_JOIN") => void;
  onArchive: (lead: EntryLead) => void;
}) {
  const operatorName = (lead: EntryLead) => lead.groupOperatorOwner?.name
    ?? lead.owner.receptionistAssignments[0]?.groupOperator.name
    ?? "待自动分配";
  const expertStatus = (lead: EntryLead) => {
    return expertWorkflowStageLabel(resolveExpertWorkflowStage({ ...lead, hasActiveOrder: Boolean(lead.customerOrder && !lead.customerOrder.voidedAt) }));
  };
  const leftResult = (lead: EntryLead) => {
    const days = groupDayNumber(lead.joinedOn, lead.leftOn ?? today);
    if (lead.customerOrder && !lead.customerOrder.voidedAt) return "已开单后退群";
    if (days && days <= 8) return `提前退群 · 第 ${days} 天`;
    if (days && days >= 14) return `正常退群 · 第 ${days} 天`;
    return days ? `退群 · 第 ${days} 天` : "已退群";
  };
  return <div className="member-table-wrap">
    <table className={mode === "pending" ? "member-table member-role-table member-group-pending-table" : "member-table member-role-table"}>
      {mode === "pending" ? <colgroup>
        <col className="member-group-pending-customer-column" />
        <col className="member-group-pending-source-column" />
        <col className="member-group-pending-replied-column" />
        <col className="member-group-pending-operator-column" />
        <col className="member-group-pending-notes-column" />
        <col className="member-group-pending-status-column" />
        <col className="member-group-pending-actions-column" />
      </colgroup> : null}
      <thead>{mode === "pending" ? <tr><th>客户</th><th>来源</th><th>已回复</th><th>炒群负责人</th><th>客户情况</th><th>当前状态</th><th>交接操作</th></tr> : <tr><th>客户</th><th>来源</th><th>{mode === "joined" ? "入群日期" : "退群日期"}</th><th>{mode === "joined" ? "在群天数" : "退群情况"}</th><th>炒群负责人</th><th>炒群最新进度</th><th>专家进度</th><th>下一步</th><th>查看</th></tr>}</thead>
      <tbody>
        {rows.map((lead) => mode === "pending" ? <tr key={lead.id} data-ready-to-join={lead.receptionChatStatus === "READY_TO_JOIN" || undefined}>
          <td><strong className="member-phone">{lead.phone}</strong>{lead.isHistoricalRecord ? <span className="ml-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">历史补录</span> : null}<span className="member-muted block">{lead.customerName ?? "未填写姓名"}</span></td>
          <td>{context(lead)}</td><td>{lead.repliedOn ?? "—"}</td><td>{operatorName(lead)}</td><td>{notes(lead)}</td><td><select aria-label={`${lead.phone} 当前状态`} value={lead.receptionChatStatus} disabled={actionDisabled(lead)} onChange={(event) => onReceptionStatus(lead, event.target.value as "NORMAL_CHAT" | "READY_TO_JOIN")} className="member-reception-status-select"><option value="NORMAL_CHAT">正常聊天</option><option value="READY_TO_JOIN">准备拉群</option></select></td>
          <td><div className="member-group-pending-actions"><button type="button" className="member-secondary small" onClick={() => onViewProfile(lead)}>查看资料</button><button type="button" className="member-primary small inline-flex items-center gap-1" disabled={actionDisabled(lead)} onClick={() => onAction(lead, "joinGroup")}><SignIn size={15} weight="duotone" />确认入群</button><TableActionMenu items={[{ label: "手动归档", tone: "danger", disabled: actionDisabled(lead), onSelect: () => onArchive(lead) }, { label: "撤销回复", tone: "danger", disabled: actionDisabled(lead), onSelect: () => onAction(lead, "undoReply") }, ...(onVoidErroneousEntry ? [{ label: "标记误录", tone: "danger" as const, disabled: actionDisabled(lead), onSelect: () => onVoidErroneousEntry(lead) }] : [])]} /></div></td>
        </tr> : <tr key={lead.id}>
          <td><strong className="member-phone">{lead.phone}</strong>{lead.isHistoricalRecord ? <span className="ml-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">历史补录</span> : null}<span className="member-muted block">{lead.customerName ?? "未填写姓名"}</span></td>
          <td>{context(lead)}</td><td>{mode === "joined" ? lead.joinedOn : lead.leftOn}</td>
          <td>{mode === "joined" ? (groupDayNumber(lead.joinedOn, today) ? `第 ${groupDayNumber(lead.joinedOn, today)} 天` : "—") : leftResult(lead)}</td>
          <td>{operatorName(lead)}</td>
          <td>{lead.activities.find((activity) => activity.kind === "GROUP_PROGRESS_UPDATED")?.note ?? (mode === "joined" ? "暂无每日进度" : "—")}</td>
          <td><span className="member-stage" data-tone={lead.customerOrder && !lead.customerOrder.voidedAt ? "success" : "info"}>{expertStatus(lead)}</span></td>
          <td>{lead.nextPlan ?? (lead.expertIntroducedOn ? "等待专家更新计划" : "炒群继续跟进")}</td>
          <td><div className="flex flex-col items-start gap-1"><button type="button" className="inline-flex items-center gap-1" onClick={() => onViewProfile(lead)}>查看资料</button><button type="button" className="inline-flex items-center gap-1" onClick={() => onViewProgress(lead)}><Eye size={15} />查看进度</button></div></td>
        </tr>)}
        {!rows.length && <tr><td colSpan={mode === "pending" ? 7 : 9}>{empty(mode === "pending" ? "没有待入群客户" : mode === "joined" ? "当前没有群内客户" : "没有退群记录")}</td></tr>}
      </tbody>
    </table>
  </div>;
}

export function EntryReceptionArchiveTable({ rows, context, empty }: { rows: EntryLead[]; context: (lead: EntryLead) => ReactNode; empty: (text: string) => ReactNode }) {
  return <div className="member-table-wrap"><table className="member-table member-role-table member-reception-archive-table">
    <thead><tr><th>客户</th><th>来源</th><th>归档类型</th><th>回复日期</th><th>回访次数</th><th>归档原因</th><th>归档时间</th></tr></thead>
    <tbody>{rows.map((lead) => {
      const type = receptionReplyArchiveType(lead);
      const manual = type === "NOT_JOINED";
      const archivedOn = manual && lead.receptionArchivedAt ? new Date(lead.receptionArchivedAt).toISOString().slice(0, 10) : lead.lastFollowedUpOn;
      return <tr key={lead.id}><td><strong className="member-phone">{lead.phone}</strong><span className="member-muted block">{lead.customerName ?? "未填写姓名"}</span></td><td>{context(lead)}</td><td><span className="member-stage" data-tone={manual ? "warning" : "muted"}>{manual ? "未进群归档" : "未回复归档"}</span></td><td>{lead.repliedOn ?? "未回复"}</td><td>{manual ? lead.receptionArchiveVisitCount : lead.followUpCount} 次</td><td>{manual ? lead.receptionArchiveReason : "连续回访 5 次仍未回复"}</td><td>{archivedOn ?? "—"}</td></tr>;
    })}{!rows.length ? <tr><td colSpan={7}>{empty("当前没有归档客户")}</td></tr> : null}</tbody>
  </table></div>;
}

export function EntryExpertTable({
  rows,
  mode,
  notes,
  actionDisabled,
  onAction,
  onCorrect,
  context,
  empty,
}: SharedTableProps & {
  mode: "intro" | "register" | "done";
  onCorrect: (lead: EntryLead, action: "undoIntroduceExpert" | "undoRegister", label: string) => void;
}) {
  const label = mode === "intro" ? "推专家" : mode === "register" ? "注册" : "注册日期";
  return <div className="member-table-wrap">
    <table className="member-table member-role-table">
      <thead><tr><th>手机号</th><th>客户姓名</th><th>来源 / 设备</th><th>{mode === "intro" ? "入群日期" : mode === "register" ? "介绍日期" : "注册日期"}</th><th>备注</th><th>当前状态</th><th>下一步</th><th>操作</th></tr></thead>
      <tbody>
        {rows.map((lead) => <tr key={lead.id}>
          <td className="member-phone">{lead.phone}</td><td>{lead.customerName ?? "—"}</td><td>{context(lead)}</td>
          <td>{mode === "intro" ? lead.joinedOn : mode === "register" ? lead.expertIntroducedOn : lead.registeredOn}</td>
          <td>{notes(lead)}</td><td><EntryWorkflowStatus lead={lead} /></td><td><EntryWorkflowNextStep lead={lead} /></td>
          <td className="member-actions">
            {mode === "done" ? <><span className="member-done"><Check size={15} />已注册</span><button type="button" className="member-text-action danger" disabled={actionDisabled(lead)} onClick={() => onCorrect(lead, "undoRegister", "撤销注册")}>纠错</button></>
              : <><button type="button" className="member-primary small" disabled={actionDisabled(lead)} onClick={() => onAction(lead, mode === "intro" ? "introduceExpert" : "register")}>标记{label}</button>{mode === "register" && <button type="button" className="member-text-action danger" disabled={actionDisabled(lead)} onClick={() => onCorrect(lead, "undoIntroduceExpert", "撤销推专家")}>纠错</button>}</>}
          </td>
        </tr>)}
        {!rows.length && <tr><td colSpan={8}>{empty(mode === "intro" ? "没有待推专家的客户" : mode === "register" ? "没有待注册客户" : "没有已注册记录")}</td></tr>}
      </tbody>
    </table>
  </div>;
}
