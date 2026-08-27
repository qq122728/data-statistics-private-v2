import { ArrowCounterClockwise, NotePencil, Receipt, Trash, UserCheck, Wallet } from "@phosphor-icons/react";
import { formatUsd as money } from "../../lib/money";
import { TableActionMenu, type TableActionMenuItem } from "../ui/TableActionMenu";
import { ReceptionSituationCell } from "./ReceptionSituationCell";
import { expertStallReasonLabel } from "./ExpertStallDialog";
import type { ExpertCustomerTab } from "./ExpertCustomerFilters";
import { expertCustomerGroupSituationDisplay, expertCustomerProgress, expertCustomerSituationDisplay, expertCustomerStage, expertCustomerStageClass, hasActiveOrder, trackingElapsedHours, trackingOverdue } from "./expert-customer-view";
import type { ExpertAssigneeOption, ExpertCustomer, ExpertFinancialEvent } from "./expert-customer-types";
import { groupDayNumber } from "../../lib/group-progress";

export function ExpertCustomerDataTable({
  customers,
  today,
  tab,
  canEdit,
  canAssign,
  assignees,
  busy,
  onAssign,
  onStage,
  onRegistration,
  onOpenOrder,
  onFinance,
  onEdit,
  onCorrection,
  onVoidFinance,
  onStall,
  onRestoreStalled,
  onNoInitialDeposit,
  onRestoreNoInitialDeposit,
}: {
  customers: ExpertCustomer[];
  today: string;
  tab: ExpertCustomerTab;
  canEdit: boolean;
  canAssign: boolean;
  assignees: ExpertAssigneeOption[];
  busy: string;
  onAssign: (customer: ExpertCustomer, expertOwnerId: string) => void;
  onStage: (customer: ExpertCustomer, action: "beginExpertReception" | "beginExpertTracking" | "markPendingRegistration") => void;
  onRegistration: (customer: ExpertCustomer) => void;
  onOpenOrder: (customer: ExpertCustomer) => void;
  onFinance: (customer: ExpertCustomer) => void;
  onEdit: (customer: ExpertCustomer) => void;
  onCorrection: (customer: ExpertCustomer, action: "undoRegister") => void;
  onVoidFinance: (customer: ExpertCustomer, event: ExpertFinancialEvent) => void;
  onStall: (customer: ExpertCustomer) => void;
  onRestoreStalled: (customer: ExpertCustomer) => void;
  onNoInitialDeposit: (customer: ExpertCustomer) => void;
  onRestoreNoInitialDeposit: (customer: ExpertCustomer) => void;
}) {
  return (
    <div className="data-table-wrap">
      <table className="data-table lead-customer-wide-table expert-customer-table min-w-[1280px]">
        <thead><tr><th>客户</th><th>粉归属 / 接粉 / 专家</th><th>接粉情况</th><th>当前状态</th><th>群状态 / 天数</th><th>炒群情况</th><th>专家情况</th><th>{tab === "stalled" ? "杀不动原因" : "资金情况"}</th><th>操作</th></tr></thead>
        <tbody>
          {customers.map((customer) => {
            const activeOrder = hasActiveOrder(customer);
            const workflowStage = expertCustomerStage(customer);
            const trackingHours = trackingElapsedHours(customer);
            const groupSituation = expertCustomerGroupSituationDisplay(customer);
            const expertSituation = expertCustomerSituationDisplay(customer);
            const groupDays = groupDayNumber(customer.joinedOn ?? null, customer.groupStatus === "LEFT" && customer.leftOn ? customer.leftOn : today);
            const correctionItems: TableActionMenuItem[] = [
              ...(customer.registeredOn && !activeOrder ? [{ label: "撤销注册", icon: <ArrowCounterClockwise size={15} />, tone: "danger" as const, disabled: busy === customer.id, onSelect: () => onCorrection(customer, "undoRegister") }] : []),
            ];
            return (
              <tr key={customer.id} className={expertCustomerRowClass(customer)}>
                <td><strong>{customer.phone}</strong><span className="ml-2 text-xs text-slate-500">{customer.customerName ?? "未填姓名"}</span>{customer.isHistoricalRecord ? <span className="ml-2 inline-flex rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-800">历史补录</span> : null}<span className="mt-1 block text-xs text-slate-500">{[customer.isHistoricalRecord ? `历史来源：${customer.historicalSourceName || customer.source}` : customer.source ? `来源：${customer.source}` : null, customer.customerPlatform ? `平台：${customer.customerPlatform}` : null, customer.lossAmountCents !== null && customer.lossAmountCents !== undefined ? `客户金额：${money(customer.lossAmountCents)}` : null].filter(Boolean).join(" · ") || "接粉资料：待补充"}</span></td>
                <td><span className="block text-sm font-semibold text-slate-800">粉归属：{customer.attributionOwnerName ?? customer.ownerName}</span><span className="mt-1 block text-xs text-slate-600">接粉：{customer.ownerName}</span><span className="mt-1 block text-xs text-slate-500">接粉号：{customer.deviceCode ?? "未填写"}</span>{customer.groupName ? <span className="mt-1 block text-xs text-slate-500">小组：{customer.groupName}</span> : null}{canAssign ? <select aria-label={`分配 ${customer.phone} 的专家负责人`} value={customer.expertOwnerId ?? ""} disabled={busy === customer.id} onChange={(event) => onAssign(customer, event.target.value)} className="mt-1 max-w-48 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"><option value="">专家：待分配</option>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.label}</option>)}</select> : <span className="mt-1 block text-xs text-slate-500">专家：{customer.expertOwnerName ?? "—"}</span>}</td>
                <ReceptionSituationCell repliedOn={customer.repliedOn} followUpCount={customer.followUpCount} lastFollowedUpOn={customer.lastFollowedUpOn} notes={customer.notes} />
                <td><span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-xs font-semibold ${expertCustomerStageClass(customer)}`}>{expertCustomerProgress(customer)}</span>{workflowStage === "TRACKING" ? <span className={`mt-1 block text-xs ${trackingOverdue(customer) ? "font-semibold text-rose-700" : "text-slate-500"}`}>{trackingHours === null ? "追踪时间待确认" : trackingOverdue(customer) ? `已追踪 ${trackingHours} 小时 · 超过 48 小时` : `已追踪 ${trackingHours} / 48 小时`}</span> : <span className="mt-1 block text-xs text-slate-500">接待 {customer.expertContactedOn ?? "未开始"} · 注册 {customer.registeredOn ?? "未完成"}</span>}</td>
                <td><strong className="block text-sm">{customer.groupStatus === "LEFT" ? "已退群" : customer.groupStatus === "JOINED" ? "在群" : "未入群"}{customer.leftAutomatically ? " · 系统到期" : ""}</strong><span className="mt-1 block text-xs text-slate-500">{groupDays ? `${customer.groupStatus === "LEFT" ? "群内共" : "当前"}第 ${groupDays} 天` : "尚无入群日期"}</span></td>
                <td><div className="lead-situation-cell"><p className="lead-situation-summary" title={groupSituation.title}>{groupSituation.summary}</p>{groupSituation.meta ? <span className="lead-situation-meta">{groupSituation.meta}</span> : null}{customer.groupDeviceAccountNumber ? <span className="lead-situation-account">炒群号：{customer.groupDeviceAccountNumber}</span> : null}{customer.groupStatus === "LEFT" ? <span className="lead-situation-account">已退群 {customer.leftOn ?? ""}{customer.leftNote ? ` · 备注：${customer.leftNote}` : " · 未填备注"}</span> : null}</div></td>
                <td><div className="lead-situation-cell"><p className="lead-situation-summary" title={expertSituation.title}>{expertSituation.summary}</p>{expertSituation.meta ? <span className="lead-situation-meta">{expertSituation.meta}</span> : null}{customer.expertDeviceAccountNumber ? <span className="lead-situation-account">专家号：{customer.expertDeviceAccountNumber}</span> : null}{canEdit ? <button type="button" onClick={() => onEdit(customer)} className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100" title={customer.expertNotes || "填写专家情况"}><NotePencil size={14} weight="duotone" /><span>{customer.expertNotes ? "更新专家情况" : "填写专家情况"}</span></button> : customer.expertNotes ? <span className="lead-situation-note" title={customer.expertNotes}>{customer.expertNotes}</span> : null}</div></td>
                <td>
                  {tab === "stalled" ? <><strong>{expertStallReasonLabel(customer.expertStalledReason)}</strong><span className="mt-1 block text-xs text-slate-500">{customer.expertStalledOn}{customer.expertStalledNote ? ` · ${customer.expertStalledNote}` : ""}</span></> : activeOrder && customer.order ? <>
                    <strong>{customer.order.openedOn} · 首充 {money(customer.order.initialDepositCents)} · {depositMethodLabel(customer.order.initialDepositMethod)}</strong>
                    <span className="mt-1 block text-xs text-slate-500">续充 {money(customer.order.rechargeCents)} · 出金 {money(customer.order.withdrawalCents)}</span>
                    {customer.order.events.length ? <div className="mt-2 grid gap-1 border-t border-slate-100 pt-2">{customer.order.events.map((event) => <div key={event.id} className="flex items-center justify-between gap-2 text-xs text-slate-600"><span>{event.occurredOn} · {event.kind === "RECHARGE" ? `第 ${event.continuationNumber} 次续充 · ${depositMethodLabel(event.depositMethod)}` : "出金"} {money(event.amountCents)}</span>{canEdit ? <button type="button" disabled={busy === `finance-${event.id}`} onClick={() => onVoidFinance(customer, event)} className="inline-flex items-center gap-1 font-semibold text-red-600 disabled:opacity-50"><Trash size={13} />作废</button> : null}</div>)}</div> : null}
                  </> : <span className="text-sm text-slate-500">暂未开单</span>}
                </td>
                <td>{!canEdit ? "—" : <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {customer.expertStalledOn ? <button type="button" disabled={busy === customer.id} onClick={() => onRestoreStalled(customer)} className="inline-flex h-7 items-center gap-1 rounded-md border border-rose-300 bg-white px-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">恢复跟进</button>
                  : customer.noInitialDepositOn ? <button type="button" disabled={busy === customer.id} onClick={() => onRestoreNoInitialDeposit(customer)} className="inline-flex h-7 items-center gap-1 rounded-md border border-orange-300 bg-white px-2.5 text-xs font-semibold text-orange-700 hover:bg-orange-50 disabled:opacity-50">恢复首充跟进</button>
                  : !customer.expertOwnerId ? <span className="text-xs text-amber-700">请先分配专家</span>
                    : workflowStage === "QUEUED" ? <button type="button" disabled={busy === customer.id} onClick={() => onStage(customer, "beginExpertReception")} className="inline-flex h-7 items-center gap-1 rounded-md bg-blue-600 px-2.5 text-xs font-semibold text-white disabled:opacity-50">开始接待</button>
                    : workflowStage === "MATERIALS" ? <button type="button" disabled={busy === customer.id} onClick={() => onStage(customer, "beginExpertTracking")} className="inline-flex h-7 items-center gap-1 rounded-md bg-blue-600 px-2.5 text-xs font-semibold text-white disabled:opacity-50">资料已交 · 开始追踪</button>
                    : workflowStage === "TRACKING" ? <button type="button" disabled={busy === customer.id} onClick={() => onStage(customer, "markPendingRegistration")} className="inline-flex h-7 items-center gap-1 rounded-md bg-blue-600 px-2.5 text-xs font-semibold text-white disabled:opacity-50">转为待注册</button>
                    : workflowStage === "PENDING_REGISTRATION" ? <button type="button" disabled={busy === customer.id} onClick={() => onRegistration(customer)} className="inline-flex h-7 items-center gap-1 rounded-md bg-blue-600 px-2.5 text-xs font-semibold text-white disabled:opacity-50"><UserCheck size={14} weight="duotone" />标记已注册</button>
                    : workflowStage === "PENDING_ORDER" ? <button type="button" disabled={busy === customer.id} onClick={() => onOpenOrder(customer)} className="inline-flex h-7 items-center gap-1 rounded-md bg-blue-600 px-2.5 text-xs font-semibold text-white disabled:opacity-50"><Receipt size={14} weight="duotone" />登记开单</button>
                    : activeOrder ? <button type="button" disabled={busy === customer.id} onClick={() => onFinance(customer)} className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"><Wallet size={14} weight="duotone" />登记续充 / 出金</button>
                    : <span className="text-xs text-slate-500">当前阶段无需操作</span>}
                  {customer.expertOwnerId && customer.registeredOn && !activeOrder && !customer.noInitialDepositOn ? <button type="button" disabled={busy === customer.id} onClick={() => onNoInitialDeposit(customer)} className="h-7 rounded-md border border-orange-200 bg-orange-50 px-2.5 text-xs font-semibold text-orange-700 hover:bg-orange-100 disabled:opacity-50">不首充</button> : null}
                  {customer.expertOwnerId && activeOrder && !customer.expertStalledOn ? <button type="button" disabled={busy === customer.id} onClick={() => onStall(customer)} className="h-7 rounded-md border border-rose-200 bg-rose-50 px-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50">杀不动</button> : null}
                  {correctionItems.length ? <TableActionMenu items={correctionItems} /> : null}
                </div>}</td>
              </tr>
            );
          })}
          {!customers.length ? <tr><td colSpan={9} className="empty-state">{tab === "ordered" ? "暂时没有已开单的专家客户。" : tab === "stalled" ? "暂时没有杀不动客户。" : "暂时没有需要继续跟进的专家客户。"}</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function depositMethodLabel(method: "CRYPTO" | "BANK" | null | undefined) {
  return method === "CRYPTO" ? "加密货币" : method === "BANK" ? "银行卡" : "历史未分类";
}

/** 用整行底色提示当前处理阶段；文字保持统一深色，避免员工误把颜色当成字段内容。 */
function expertCustomerRowClass(customer: ExpertCustomer) {
  const stage = expertCustomerStage(customer);
  if (stage === "STALLED") return "bg-rose-50/70";
  if (stage === "NO_INITIAL_DEPOSIT") return "bg-orange-50/70";
  if (stage === "RECHARGING" || stage === "FIRST_DEPOSIT") return "bg-emerald-50/50";
  if (stage === "PENDING_ORDER") return "bg-amber-50/60";
  if (stage === "PENDING_REGISTRATION") return "bg-blue-50/50";
  return undefined;
}
