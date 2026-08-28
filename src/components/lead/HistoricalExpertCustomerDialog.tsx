"use client";

import { useState } from "react";
import type { ExpertWorkflowStage } from "../../lib/expert-workflow-stage";

export type HistoricalExpertCustomerValues = {
  phone: string;
  customerName: string;
  historicalSourceName: string;
  receptionOwnerId: string;
  groupOperatorOwnerId: string;
  expertOwnerId: string;
  contactedOn: string;
  joinedOn: string;
  expertIntroducedOn: string;
  expertStage: ExpertWorkflowStage;
  stageChangedOn: string;
  registeredOn: string;
  openedOn: string;
  initialDepositCents?: number;
  initialDepositMethod?: "CRYPTO" | "BANK";
  stalledReason: string;
  notes: string;
};

const stages: Array<{ id: ExpertWorkflowStage; label: string }> = [
  { id: "QUEUED", label: "排队中" },
  { id: "MATERIALS", label: "交资料" },
  { id: "TRACKING", label: "追踪中" },
  { id: "PENDING_REGISTRATION", label: "待注册" },
  { id: "PENDING_ORDER", label: "待开单" },
  { id: "DECLINED_DEPOSIT", label: "不愿充" },
  { id: "ORDERED", label: "已开单" },
  { id: "STALLED", label: "杀不动" },
];

export function HistoricalExpertCustomerDialog({
  open,
  today,
  busy,
  error,
  canChooseExpert,
  receptionOwners,
  groupOperators,
  expertOwners,
  sourceChannels,
  defaultExpertOwnerId,
  onClose,
  onSubmit,
}: {
  open: boolean;
  today: string;
  busy: boolean;
  error: string;
  canChooseExpert: boolean;
  receptionOwners: Array<{ id: string; name: string }>;
  groupOperators: Array<{ id: string; name: string }>;
  expertOwners: Array<{ id: string; name: string; label: string }>;
  sourceChannels: Array<{ id: string; name: string }>;
  defaultExpertOwnerId: string;
  onClose: () => void;
  onSubmit: (values: HistoricalExpertCustomerValues) => void;
}) {
  const [expertStage, setExpertStage] = useState<ExpertWorkflowStage>("QUEUED");
  const [sourceMode, setSourceMode] = useState<"existing" | "manual">("existing");
  const [selectedSourceName, setSelectedSourceName] = useState("");
  const [manualSourceName, setManualSourceName] = useState("");
  if (!open) return null;
  const needsRegistration = ["PENDING_ORDER", "DECLINED_DEPOSIT", "ORDERED"].includes(expertStage);
  const needsOrder = expertStage === "ORDERED";
  const selectedExpertId = defaultExpertOwnerId || expertOwners[0]?.id || "";

  return <div className="fixed inset-0 z-[80] overflow-y-auto bg-slate-950/45 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="historical-expert-title" className="mx-auto my-6 w-full max-w-3xl rounded-2xl bg-white shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
        <div><h2 id="historical-expert-title" className="text-xl font-bold text-slate-950">导入历史专家客户</h2><p className="mt-1 text-sm text-slate-600">只补系统启用前的旧客户。归属、来源和专家阶段会按真实历史保存；不计粉数、进群数或流程转化，只计开单与资金。</p></div>
        <button type="button" disabled={busy} onClick={onClose} className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">关闭</button>
      </header>
      <form onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const amount = String(data.get("initialDeposit") ?? "").trim();
        onSubmit({
          phone: String(data.get("phone") ?? ""), customerName: String(data.get("customerName") ?? ""),
          historicalSourceName: sourceMode === "existing" ? selectedSourceName.trim() : manualSourceName.trim(),
          receptionOwnerId: String(data.get("receptionOwnerId") ?? ""), groupOperatorOwnerId: String(data.get("groupOperatorOwnerId") ?? ""), expertOwnerId: String(data.get("expertOwnerId") ?? selectedExpertId),
          contactedOn: String(data.get("contactedOn") ?? ""), joinedOn: String(data.get("joinedOn") ?? ""), expertIntroducedOn: String(data.get("expertIntroducedOn") ?? ""),
          expertStage, stageChangedOn: String(data.get("stageChangedOn") ?? ""), registeredOn: String(data.get("registeredOn") ?? ""), openedOn: String(data.get("openedOn") ?? ""),
          ...(amount ? { initialDepositCents: Math.round(Number(amount) * 100), initialDepositMethod: String(data.get("initialDepositMethod") ?? "CRYPTO") as "CRYPTO" | "BANK" } : {}), stalledReason: String(data.get("stalledReason") ?? ""), notes: String(data.get("notes") ?? ""),
        });
      }} className="space-y-6 px-6 py-5">
        <fieldset className="grid gap-4 md:grid-cols-2"><legend className="mb-2 font-semibold text-slate-900">1. 客户与归属</legend>
          <label className="grid gap-1 text-sm font-medium text-slate-700">客户号码<input required name="phone" placeholder="例如 17770001006" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">客户姓名（可选）<input name="customerName" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
          <div className="grid gap-2 text-sm font-medium text-slate-700">
            <span>历史来源（可选）</span>
            <div className="inline-flex w-fit rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs">
              <button type="button" onClick={() => setSourceMode("existing")} className={`rounded-md px-2.5 py-1.5 font-semibold transition ${sourceMode === "existing" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>选择已有渠道</button>
              <button type="button" onClick={() => setSourceMode("manual")} className={`rounded-md px-2.5 py-1.5 font-semibold transition ${sourceMode === "manual" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>手动填写</button>
            </div>
            {sourceMode === "existing" ? <select value={selectedSourceName} onChange={(event) => setSelectedSourceName(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="">不填写历史来源</option>
              {sourceChannels.map((channel) => <option key={channel.id} value={channel.name}>{channel.name}</option>)}
            </select> : <input value={manualSourceName} onChange={(event) => setManualSourceName(event.target.value)} maxLength={100} placeholder="例如：旧 FB 投流 / 老名单" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />}
            <span className="text-xs font-normal text-slate-500">仅记录历史来源，选择已有渠道不会改变该渠道的粉数或报表。</span>
          </div>
          <label className="grid gap-1 text-sm font-medium text-slate-700">历史接粉归属<select required name="receptionOwnerId" defaultValue="" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="" disabled>请选择当时实际接粉人</option>{receptionOwners.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select><span className="text-xs font-normal text-slate-500">可选择本组全部成员；按历史实际负责人填写。</span></label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">历史炒群归属<select required name="groupOperatorOwnerId" defaultValue="" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="" disabled>请选择当时实际炒群人</option>{groupOperators.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select><span className="text-xs font-normal text-slate-500">可选择本组全部成员；保存后会在该成员的炒群客户中显示。</span></label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">专家归属<select name="expertOwnerId" defaultValue={selectedExpertId} disabled={!canChooseExpert} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100">{expertOwners.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}</select>{canChooseExpert ? <span className="text-xs font-normal text-slate-500">可选择本人，或指定本组其他在职专家继续跟进。</span> : <span className="text-xs font-normal text-slate-500">专家只能导入到自己名下。</span>}</label>
        </fieldset>
        <fieldset className="grid gap-4 md:grid-cols-2"><legend className="mb-2 font-semibold text-slate-900">2. 历史流程</legend>
          <label className="grid gap-1 text-sm font-medium text-slate-700">实际接粉日期<input required type="date" name="contactedOn" defaultValue={today} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">实际入群日期<input required type="date" name="joinedOn" defaultValue={today} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">实际推专家日期<input required type="date" name="expertIntroducedOn" defaultValue={today} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">当前专家阶段<select value={expertStage} onChange={(event) => setExpertStage(event.target.value as ExpertWorkflowStage)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">{stages.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">当前阶段更新日期<input required type="date" name="stageChangedOn" defaultValue={today} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
          {needsRegistration ? <label className="grid gap-1 text-sm font-medium text-slate-700">实际注册日期<input required type="date" name="registeredOn" defaultValue={today} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label> : null}
          {expertStage === "STALLED" ? <label className="grid gap-1 text-sm font-medium text-slate-700">杀不动原因<input required name="stalledReason" placeholder="例如：客户明确拒绝继续沟通" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label> : null}
        </fieldset>
        {needsOrder ? <fieldset className="grid gap-4 rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 md:grid-cols-3"><legend className="px-1 font-semibold text-emerald-900">3. 历史首充</legend><label className="grid gap-1 text-sm font-medium text-slate-700">实际开单日期<input required type="date" name="openedOn" defaultValue={today} className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm" /></label><label className="grid gap-1 text-sm font-medium text-slate-700">首充金额（美元）<input required name="initialDeposit" min="0.01" step="0.01" type="number" placeholder="例如 500" className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm" /></label><label className="grid gap-1 text-sm font-medium text-slate-700">首充入金方式<select required name="initialDepositMethod" defaultValue="CRYPTO" className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm"><option value="CRYPTO">加密货币入金</option><option value="BANK">银行卡入金</option></select></label></fieldset> : null}
        <label className="grid gap-1 text-sm font-medium text-slate-700">历史备注（可选）<textarea name="notes" rows={3} maxLength={1000} placeholder="例如：已核对旧表，客户目前继续由专家维护" className="resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
        {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <footer className="flex justify-end gap-3 border-t border-slate-100 pt-5"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">取消</button><button disabled={busy} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60">{busy ? "导入中…" : "确认导入历史客户"}</button></footer>
      </form>
    </section>
  </div>;
}
