import { NotePencil } from "@phosphor-icons/react";
import { groupDayNumber } from "../../lib/group-progress";
import { assessGroupLeave, leaveOrderLabel } from "../../lib/group-leave";
import { formatUsd as money } from "../../lib/money";
import { TableActionMenu, type TableActionMenuItem } from "../ui/TableActionMenu";
import { ReceptionSituationCell } from "./ReceptionSituationCell";
import type { GroupCustomerView } from "./GroupCustomerFilters";
import { groupCustomerExpertSituationDisplay, groupCustomerNet, groupCustomerSituationDisplay, groupCustomerStage, groupCustomerStageClass } from "./group-customer-view";
import type { GroupCustomer, GroupCustomerAction } from "./group-customer-types";

export function GroupCustomerDataTable({
  customers, groupStatus, view = groupStatus === "LEFT" ? "left" : "inGroup", canEdit, busy, today, onDetail, onProgress, onAssignment, onContact, onEdit, onAction,
}: {
  customers: GroupCustomer[];
  /** 兼容旧调用；新页面使用 view 选择工作分类。 */
  groupStatus?: "JOINED" | "LEFT";
  view?: GroupCustomerView;
  canEdit: boolean;
  busy: string;
  today: string;
  onDetail: (customer: GroupCustomer) => void;
  onProgress: (customer: GroupCustomer) => void;
  onAssignment: (customer: GroupCustomer) => void;
  onContact: (customer: GroupCustomer) => void;
  onEdit?: (customer: GroupCustomer) => void;
  onAction: (customer: GroupCustomer, action: GroupCustomerAction) => void;
}) {
  const headings = view === "inGroup"
    ? ["客户", "粉的归属 / 接粉", "接粉情况", "群状态 / 天数", "炒群情况", "专家情况", "操作"]
    : view === "introduced"
      ? ["客户", "粉的归属 / 接粉", "接粉情况", "群状态 / 天数", "专家负责人", "当前进度", "炒群情况", "专家情况", "操作"]
      : view === "expertProgress"
        ? ["客户", "粉的归属 / 接粉", "接粉情况", "群状态 / 天数", "专家负责人", "当前进度", "注册情况", "炒群情况", "专家情况", "操作"]
        : view === "ordered"
          ? ["客户", "粉的归属 / 接粉", "接粉情况", "群状态 / 天数", "专家负责人", "当前专家阶段", "开单日期", "首充 / 续充 / 出金", "当前净业绩", "炒群情况", "专家情况", "操作"]
          : ["客户", "粉的归属 / 接粉", "接粉情况", "进群情况", "退群日期", "退群判断", "退群备注", "后续进度", "炒群情况", "专家情况", "操作"];

  return <div className="data-table-wrap"><table className="data-table lead-customer-wide-table min-w-[920px]">
    <thead><tr>{headings.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead>
    <tbody>{customers.map((customer) => {
      const currentDay = groupDayNumber(customer.joinedOn, customer.groupStatus === "LEFT" && customer.leftOn ? customer.leftOn : today);
      const latestGroupProgress = customer.groupProgress[0];
      const groupSituation = groupCustomerSituationDisplay(customer);
      const expertSituation = groupCustomerExpertSituationDisplay(customer);
      const leaveAssessment = assessGroupLeave(customer.joinedOn, customer.leftOn);
      const corrections: TableActionMenuItem[] = [
        ...(onEdit ? [{ label: "编辑客户资料", disabled: busy === customer.id, onSelect: () => onEdit(customer) }] : []),
        ...(customer.groupStatus === "LEFT" ? [{ label: "撤销退群", tone: "danger" as const, disabled: busy === customer.id, onSelect: () => onAction(customer, "undoLeaveGroup") }] : []),
        ...(customer.expertIntroducedOn && !customer.registeredOn ? [{ label: "撤销介绍专家", tone: "danger" as const, disabled: busy === customer.id, onSelect: () => onAction(customer, "undoIntroduceExpert") }] : []),
        ...(customer.expertContactedOn && !customer.registeredOn ? [{ label: "撤销已联系", tone: "danger" as const, disabled: busy === customer.id, onSelect: () => onAction(customer, "undoExpertContacted") }] : []),
      ];
      const progressBadge = <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${groupCustomerStageClass(customer)}`}>{groupCustomerStage(customer)}</span>;
      const actionMenu = canEdit && corrections.length ? <TableActionMenu items={corrections} /> : null;
      const canAdvanceToExpert = canEdit && !customer.invalid;
      const leaveButton = canEdit && customer.groupStatus === "JOINED" ? <button type="button" disabled={busy === customer.id} onClick={() => onAction(customer, "leaveGroup")} className="h-7 rounded-md border border-rose-300 bg-white px-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">退群</button> : null;
      const details = <button type="button" onClick={() => onDetail(customer)} className="text-xs font-semibold text-[#0b66ff]">查看详情</button>;
      const groupSituationCell = <td>{latestGroupProgress ? <div className="lead-situation-cell"><p className="lead-situation-summary" title={groupSituation.title}>{groupSituation.summary}</p><span className="lead-situation-meta">{groupSituation.meta}</span>{customer.groupDeviceAccountNumber ? <span className="lead-situation-account">炒群号：{customer.groupDeviceAccountNumber}</span> : null}{canEdit ? <button type="button" onClick={() => onProgress(customer)} className="lead-situation-update"><NotePencil size={14} />更新炒群情况</button> : null}</div> : canEdit ? <button type="button" onClick={() => onProgress(customer)} className="lead-situation-update"><NotePencil size={14} />填写炒群情况</button> : <span className="text-sm text-slate-400">暂无炒群更新</span>}</td>;
      // 专家情况只读展示给接粉、炒群、组长和管理层；填写入口只留在专家工作台与组长权限内。
      const expertSituationCell = <td><div className="lead-situation-cell"><p className="lead-situation-summary" title={expertSituation.title}>{expertSituation.summary}</p><span className="lead-situation-meta">{expertSituation.meta}</span>{customer.expertDeviceAccountNumber ? <span className="lead-situation-account">专家号：{customer.expertDeviceAccountNumber}</span> : null}</div></td>;
      return <tr key={customer.id} className={groupCustomerRowClass(customer)}>
        <td><strong>{customer.phone}</strong><span className="ml-2 text-xs text-slate-600">{customer.customerName ?? "未填姓名"}</span>{customer.isHistoricalRecord ? <span className="ml-2 inline-flex rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-xs font-semibold text-violet-800">历史补录</span> : null}{customer.invalid ? <span className="ml-2 inline-flex rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800">扣粉统计转入</span> : null}<span className="mt-1 block text-xs text-slate-500">{[customer.isHistoricalRecord ? `历史来源：${customer.historicalSourceName || customer.channelName}` : null, customer.customerPlatform ? `平台：${customer.customerPlatform}` : null, customer.lossAmountCents !== null && customer.lossAmountCents !== undefined ? `客户金额：${money(customer.lossAmountCents)}` : null].filter(Boolean).join(" · ") || "接粉资料：待补充"}</span></td>
        <td>
          <strong className="block font-semibold text-slate-800">粉归属：{customer.attributionOwnerName ?? customer.ownerName}</strong>
          <span className="mt-1 block text-xs text-slate-600">接粉：{customer.ownerName}</span>
          {customer.deviceCode
            ? <span className="mt-1 inline-flex rounded-md bg-blue-50 px-1.5 py-0.5 text-xs font-semibold text-blue-700">接粉设备：{customer.deviceCode}</span>
            : <span className="mt-1 block text-xs text-slate-400">接粉设备：未登记</span>}
          {customer.groupName ? <span className="mt-1 block text-xs text-slate-500">{customer.groupName}</span> : null}
        </td>
        <ReceptionSituationCell repliedOn={customer.repliedOn} followUpCount={customer.followUpCount} lastFollowedUpOn={customer.lastFollowedUpOn} notes={customer.notes} />
        <td><span className="block font-semibold">{customer.groupStatus === "LEFT" ? "已退群" : "在群"}{customer.leftAutomatically ? " · 系统到期" : ""}</span><span className="mt-1 block text-xs text-slate-950">{currentDay ? `${customer.groupStatus === "LEFT" ? "群内共" : "当前"}第 ${currentDay} 天` : "—"}</span></td>
        {view === "inGroup" ? <>
          {groupSituationCell}
          {expertSituationCell}
          <td><div className="flex items-center gap-2 whitespace-nowrap">{details}{canAdvanceToExpert ? <button type="button" disabled={busy === customer.id} onClick={() => onAssignment(customer)} className="h-7 rounded-md border border-blue-300 bg-white px-2.5 text-xs font-semibold text-blue-700">推专家</button> : null}{leaveButton}{actionMenu}</div></td>
        </> : null}
        {view === "introduced" ? <>
          <td>{customer.expertOwnerName ?? "待分配"}</td><td>{progressBadge}</td>{groupSituationCell}{expertSituationCell}
          <td><div className="flex items-center gap-2 whitespace-nowrap">{details}{canAdvanceToExpert && !customer.expertOwnerName ? <button type="button" disabled={busy === customer.id} onClick={() => onAssignment(customer)} className="h-7 rounded-md border border-blue-300 bg-white px-2.5 text-xs font-semibold text-blue-700">选择专家</button> : customer.expertOwnerName ? <span className="text-xs font-semibold text-slate-500">已交专家排队</span> : null}{leaveButton}{actionMenu}</div></td>
        </> : null}
        {view === "expertProgress" ? <>
          <td>{customer.expertOwnerName ?? "待分配"}</td><td>{progressBadge}</td><td>{customer.registeredOn ? `已注册 · ${customer.registeredOn}` : "已联系，待注册"}</td>{groupSituationCell}{expertSituationCell}
          <td><div className="flex items-center gap-2 whitespace-nowrap">{details}{canEdit && onEdit ? <button type="button" disabled={busy === customer.id} onClick={() => onEdit(customer)} className="h-7 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-950">编辑资料</button> : null}{leaveButton}{actionMenu}</div></td>
        </> : null}
        {view === "ordered" ? <>
          <td>{customer.expertOwnerName ?? "—"}</td><td>{progressBadge}</td><td>{customer.order?.openedOn ?? "—"}</td>
          <td>{customer.order ? <><span>首充 {money(customer.order.initialDepositCents)}</span><span className="mt-1 block text-xs">续充 {money(customer.order.rechargeCents)} · 出金 {money(customer.order.withdrawalCents)}</span></> : "—"}</td><td><strong>{money(groupCustomerNet(customer))}</strong></td>{groupSituationCell}{expertSituationCell}
          <td><div className="flex items-center gap-2 whitespace-nowrap">{details}{canEdit && onEdit ? <button type="button" disabled={busy === customer.id} onClick={() => onEdit(customer)} className="h-7 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-950">编辑资料</button> : null}{leaveButton}{actionMenu}</div></td>
        </> : null}
        {view === "left" ? <>
          <td>{customer.leftOn ?? "—"}</td><td><span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-950">{leaveAssessment.dayNumber ? `第 ${leaveAssessment.dayNumber} 天 · ` : ""}{leaveAssessment.label}</span><span className="mt-1 block text-xs text-slate-950">{leaveOrderLabel(customer.leftWithOrder)}</span></td><td className="max-w-64 whitespace-normal text-sm text-slate-700">{customer.leftNote ?? "—"}</td><td>{progressBadge}</td><td><div className="lead-situation-cell"><p className="lead-situation-summary" title={groupSituation.title}>{groupSituation.summary}</p>{groupSituation.meta ? <span className="lead-situation-meta">{groupSituation.meta}</span> : null}</div></td>{expertSituationCell}
          <td><div className="flex items-center gap-2 whitespace-nowrap">{details}{actionMenu}</div></td>
        </> : null}
      </tr>;
    })}{!customers.length ? <tr><td colSpan={headings.length} className="empty-state">当前分类没有客户。</td></tr> : null}</tbody>
  </table></div>;
}

/** 行底色仅表达当前状态；客户信息和状态文字统一用深色。 */
function groupCustomerRowClass(customer: GroupCustomer) {
  if (customer.invalid) return "bg-amber-50/45";
  if (customer.expertStalledOn) return "bg-rose-50/70";
  if (customer.noInitialDepositOn) return "bg-orange-50/70";
  if (customer.order && !customer.order.voided) return "bg-emerald-50/50";
  if (customer.registeredOn) return "bg-amber-50/60";
  if (customer.expertContactedOn) return "bg-blue-50/50";
  if (customer.expertIntroducedOn) return "bg-violet-50/60";
  if (customer.groupStatus === "LEFT") return "bg-slate-100/80";
  return "bg-emerald-50/45";
}
