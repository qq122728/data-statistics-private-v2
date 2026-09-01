"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { requestJson } from "@/lib/backend";
import { localToday, money, type ExpertCustomer, type ExpertResponse, type ExpertStage } from "@/lib/frontline-workbench";
import { ConfirmDialog, type Confirm } from "./ConfirmDialog";
import { IconSearch } from "./Icons";
import { HistoricalCustomerClaimPanel } from "./HistoricalCustomerClaimPanel";
import { WorkbenchStageChip } from "./WorkbenchStageChip";
import { InlineProgressEditor } from "./InlineProgressEditor";

const STAGES: Array<{ id: ExpertStage | "all"; label: string }> = [
  { id: "all", label: "全部" }, { id: "QUEUED", label: "排队中" }, { id: "MATERIALS", label: "交资料" },
  { id: "TRACKING", label: "追踪中" }, { id: "PENDING_REGISTRATION", label: "待注册" },
  { id: "PENDING_ORDER", label: "待开单" }, { id: "ORDERED", label: "已开单" },
  { id: "DECLINED_DEPOSIT", label: "未成交" }, { id: "STALLED", label: "停止维护" },
];
const ACTIVITY_LABELS: Record<string, string> = {
  GROUP_PROGRESS_UPDATED: "炒群进度", EXPERT_INTRODUCED: "已推专家", EXPERT_CONTACTED: "专家已接待",
  REGISTERED: "已注册", PLAN_UPDATED: "计划已更新", ORDER_VOIDED: "开单已作废", FINANCE_VOIDED: "资金已作废",
};

function stageLabel(stage: ExpertStage) {
  return STAGES.find((item) => item.id === stage)?.label ?? stage;
}

export function ExpertWorkbench() {
  const [stage, setStage] = useState<ExpertStage | "all">("all");
  const [page, setPage] = useState(1);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<ExpertResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page) });
    if (stage !== "all") params.set("stage", stage);
    if (query) params.set("q", query);
    try {
      setData(await requestJson<ExpertResponse>(`/api/expert/customers?${params}`, { signal }));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "专家客户读取失败");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page, query, stage]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(""), 4000);
    return () => window.clearTimeout(timer);
  }, [success]);

  async function save(customer: ExpertCustomer, url: string, body: Record<string, unknown>, message: string) {
    setConfirm(null);
    setBusyId(customer.id);
    setError("");
    try {
      await requestJson(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setSuccess(message);
      window.dispatchEvent(new Event("customer-data-updated"));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，请稍后重试");
    } finally {
      setBusyId(null);
    }
  }

  async function workflow(customer: ExpertCustomer, body: Record<string, unknown>, message: string) {
    setConfirm(null);
    setBusyId(customer.id);
    setError("");
    try {
      await requestJson(`/api/leads/${customer.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setSuccess(message);
      window.dispatchEvent(new Event("customer-data-updated"));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，请稍后重试");
    } finally {
      setBusyId(null);
    }
  }

  async function saveInlineProgress(customer: ExpertCustomer, expertNotes: string) {
    setBusyId(customer.id);
    setError("");
    try {
      await requestJson(`/api/leads/${customer.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateExpertDetails", expertNotes, occurredOn: localToday() }),
      });
      setSuccess(`${customer.phone} 的专家情况已自动保存`);
      window.dispatchEvent(new Event("customer-data-updated"));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "专家情况自动保存失败");
      throw caught;
    } finally {
      setBusyId(null);
    }
  }

  function askStageAdvance(customer: ExpertCustomer) {
    const target = `${customer.phone}${customer.customerName ? ` · ${customer.customerName}` : ""}`;
    if (customer.stage === "QUEUED") {
      setConfirm({ title: "开始接待客户", desc: "填写本次实际使用的专家设备号，客户会进入“交资料”。", confirmLabel: "确认开始接待", target, reasonLabel: "专家设备号", reasonPlaceholder: "填写本次接待使用的 WhatsApp / 设备号码", dateLabel: "接待日期", defaultDate: localToday(), onConfirm: (expertDeviceAccountNumber, _n, _k, occurredOn) => void workflow(customer, { action: "beginExpertReception", expertDeviceAccountNumber, occurredOn }, `${customer.phone} 已开始接待`) });
      return;
    }
    if (customer.stage === "MATERIALS") {
      setConfirm({ title: "资料已经提交？", desc: "确认后开始计算专家追踪时间，客户进入“追踪中”。", confirmLabel: "开始追踪", target, dateLabel: "开始追踪日期", defaultDate: localToday(), onConfirm: (_r, _n, _k, occurredOn) => void workflow(customer, { action: "beginExpertTracking", occurredOn }, `${customer.phone} 已进入追踪中`) });
      return;
    }
    if (customer.stage === "TRACKING") {
      setConfirm({ title: "转为待注册", desc: "客户已完成资料和追踪环节，下一步等待注册。", confirmLabel: "确认转待注册", target, dateLabel: "转待注册日期", defaultDate: localToday(), onConfirm: (_r, _n, _k, occurredOn) => void workflow(customer, { action: "markPendingRegistration", occurredOn }, `${customer.phone} 已转为待注册`) });
      return;
    }
    if (customer.stage === "PENDING_REGISTRATION") {
      setConfirm({ title: "确认客户已经注册？", desc: "确认后客户进入待开单；只记录真实发生的注册。", confirmLabel: "确认注册", target, dateLabel: "实际注册日期", defaultDate: localToday(), onConfirm: (_r, _n, _k, occurredOn) => void workflow(customer, { action: "register", occurredOn }, `${customer.phone} 已确认注册`) });
      return;
    }
    if (customer.stage === "PENDING_ORDER") {
      setConfirm({ title: "登记首次入金并开单", desc: "首次入金只登记一次；以后到账请使用续充，不会重复增加首充。", confirmLabel: "确认开单", target, numberLabel: "首充金额（美元整数）", kindLabel: "入金方式", kindOptions: [{ value: "CRYPTO", label: "加密货币" }, { value: "BANK", label: "银行卡" }], dateLabel: "开单日期", defaultDate: localToday(), onConfirm: (_r, amountUsd, initialDepositMethod, openedOn) => {
        if (!amountUsd || !openedOn || !initialDepositMethod) return;
        void save(customer, "/api/customer-orders", { batchId: customer.batch.id, leadId: customer.id, phone: customer.phone, openedOn, initialDepositCents: Math.round(amountUsd * 100), initialDepositMethod }, `${customer.phone} 已开单`);
      } });
    }
  }

  function askPlan(customer: ExpertCustomer) {
    setConfirm({ title: "更新下一步跟进计划", desc: "计划和日期会写入客户时间线，避免换人或隔天后不知道上次谈到哪里。", confirmLabel: "保存计划", target: customer.phone, reasonLabel: "下一步计划", reasonPlaceholder: "例如：明天下午协助客户完成注册", dateLabel: "下次跟进日期", defaultDate: customer.nextFollowUpOn || localToday(), onConfirm: (nextPlan, _n, _k, nextFollowUpOn) => void workflow(customer, { action: "updateExpertDetails", nextPlan, nextFollowUpOn }, `${customer.phone} 的跟进计划已更新`) });
  }

  function askFinance(customer: ExpertCustomer) {
    if (!customer.order) return;
    setConfirm({ title: "登记续充或出金", desc: "首充不会在这里重复记录。每一笔续充和出金都会单独留流水。", confirmLabel: "确认登记流水", target: customer.phone, numberLabel: "金额（美元整数）", kindLabel: "流水类型", kindOptions: [{ value: "RECHARGE_CRYPTO", label: "续充 · 加密货币" }, { value: "RECHARGE_BANK", label: "续充 · 银行卡" }, { value: "WITHDRAWAL", label: "出金" }], dateLabel: "实际发生日期", defaultDate: localToday(), onConfirm: (_r, amountUsd, selection, occurredOn) => {
      if (!amountUsd || !selection || !occurredOn || !customer.order) return;
      const isWithdrawal = selection === "WITHDRAWAL";
      void save(customer, "/api/customer-finance", {
        customerOrderId: customer.order.id, occurredOn, kind: isWithdrawal ? "WITHDRAWAL" : "RECHARGE",
        amountCents: Math.round(amountUsd * 100),
        ...(isWithdrawal ? {} : { continuationNumber: customer.order.nextContinuationNumber, depositMethod: selection === "RECHARGE_BANK" ? "BANK" : "CRYPTO" }),
      }, `${customer.phone} 的${isWithdrawal ? "出金" : "续充"}已登记`);
    } });
  }

  function askDeclineDeposit(customer: ExpertCustomer) {
    setConfirm({
      title: "标记为未成交？", desc: "用于开单前确认不再推进首充的客户。之后客户重新有意向，可以恢复到待开单。",
      confirmLabel: "确认未成交", target: customer.phone, danger: true,
      kindLabel: "主要原因", kindOptions: [
        { value: "NO_RESPONSE", label: "不再回复" }, { value: "NO_BUDGET", label: "没有预算" },
        { value: "NO_TRUST", label: "信任不足" }, { value: "REFUSED", label: "明确拒绝" }, { value: "OTHER", label: "其他" },
      ], reasonLabel: "补充说明", reasonPlaceholder: "说明最后沟通情况",
      onConfirm: (noInitialDepositNote, _amount, noInitialDepositReason) => void workflow(customer, { action: "markNoInitialDeposit", noInitialDepositReason, noInitialDepositNote }, `${customer.phone} 已标记未成交`),
    });
  }

  function askRecoverDeposit(customer: ExpertCustomer) {
    setConfirm({ title: "恢复首充跟进？", desc: "客户重新有意向后恢复到待开单，不需要重新录入号码。", confirmLabel: "恢复到待开单", target: customer.phone, onConfirm: () => void workflow(customer, { action: "clearNoInitialDeposit" }, `${customer.phone} 已恢复首充跟进`) });
  }

  function askStall(customer: ExpertCustomer) {
    setConfirm({
      title: "停止维护这个已开单客户？", desc: "用于已经开过单、后续不再跟进的客户。历史资金仍保留，之后也可以恢复。",
      confirmLabel: "确认停止维护", target: customer.phone, danger: true,
      kindLabel: "主要原因", kindOptions: [
        { value: "NO_RESPONSE", label: "不再回复" }, { value: "NO_BUDGET", label: "没有预算" },
        { value: "NO_TRUST", label: "信任不足" }, { value: "REFUSED", label: "明确拒绝" }, { value: "OTHER", label: "其他" },
      ], reasonLabel: "补充说明", reasonPlaceholder: "说明停止维护原因",
      onConfirm: (stalledNote, _amount, stalledReason) => void workflow(customer, { action: "markExpertStalled", stalledReason, stalledNote }, `${customer.phone} 已停止维护`),
    });
  }

  function askRecoverStalled(customer: ExpertCustomer) {
    setConfirm({ title: "恢复维护？", desc: "客户重新活跃后恢复到已开单跟进，不会重复计算开单和首充。", confirmLabel: "恢复维护", target: customer.phone, onConfirm: () => void workflow(customer, { action: "clearExpertStalled" }, `${customer.phone} 已恢复维护`) });
  }

  function askUndoRegister(customer: ExpertCustomer) {
    setConfirm({
      title: "撤销误点的注册？", desc: "只用于注册点错；已经开单后不能直接撤销，系统会拒绝越级倒退。",
      confirmLabel: "确认撤销注册", target: customer.phone, danger: true,
      reasonLabel: "纠错原因", reasonPlaceholder: "例如：点错客户，实际尚未注册",
      onConfirm: (reason) => void workflow(customer, { action: "undoRegister", reason }, `${customer.phone} 的注册标记已撤销`),
    });
  }

  function askVoidOrder(customer: ExpertCustomer) {
    setConfirm({
      title: "作废误录的开单？", desc: "仅用于开单本身录错。若已有续充或出金，必须先处理资金流水，系统不会直接抹掉历史。",
      confirmLabel: "确认作废开单", target: customer.phone, danger: true,
      reasonLabel: "纠错原因", reasonPlaceholder: "例如：首充录错客户",
      onConfirm: (reason) => void workflow(customer, { action: "voidOrder", reason }, `${customer.phone} 的开单记录已作废`),
    });
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault(); setPage(1); setQuery(queryInput.trim());
  }

  const counts = data?.counts;
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 50)));

  return <section style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
    <div className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <div><h2 style={{ margin: 0, fontSize: 17 }}>本组专家客户</h2><p className="muted" style={{ margin: "3px 0 0" }}>本组成员共同查看；只有当前专家负责人或组长可以更新专家情况。</p></div><span className="badge" data-tone="ok">真实数据</span>
    </div>

    <div className="card workbench-toolbar">
      <div className="workbench-toolbar__actions">{STAGES.map((item) => <WorkbenchStageChip key={item.id} active={stage === item.id} label={item.label} count={item.id === "all" ? Object.values(counts ?? {}).reduce((sum, value) => sum + value, 0) : counts?.[item.id] ?? 0} onClick={() => { setStage(item.id); setPage(1); }} />)}<HistoricalCustomerClaimPanel workspaceRole="EXPERT" onSaved={load} /></div>
      <form className="workbench-toolbar__search" onSubmit={submitSearch}><label style={{ position: "relative" }}><span style={{ position: "absolute", left: 10, top: 8, color: "var(--ink-3)" }}><IconSearch size={16} /></span><input className="field" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="搜索号码或姓名" maxLength={120} style={{ paddingLeft: 34 }} /></label><button className="btn" type="submit">搜索</button>{query ? <button className="btn" type="button" onClick={() => { setQueryInput(""); setQuery(""); setPage(1); }}>清除</button> : null}</form>
    </div>

    {error ? <div className="card" role="alert" style={{ padding: 14, color: "var(--bad)", borderColor: "var(--bad-line)" }}>{error} <button className="btn" data-size="sm" onClick={() => void load()}>重试</button></div> : null}
    {success ? <div className="card" role="status" style={{ padding: 14, color: "var(--ok)", borderColor: "var(--ok-line)" }}>{success}</div> : null}

    <div className="card" style={{ overflow: "hidden", minWidth: 0 }}><div className="table-scroll"><table className="grid-table" data-sticky-edges="true" style={{ minWidth: data?.customers.length ? 960 : "100%" }}>
      <colgroup><col style={{ width: "17%" }} /><col style={{ width: "19%" }} /><col style={{ width: "27%" }} /><col style={{ width: "20%" }} /><col style={{ width: "17%" }} /></colgroup>
      <thead><tr><th>客户</th><th>交接与负责人</th><th>最新进度</th><th>资金与业绩</th><th style={{ textAlign: "center" }}>本次处理</th></tr></thead><tbody>
        {loading && !data ? <tr><td colSpan={5} style={{ textAlign: "center", padding: 36 }}>正在读取真实客户…</td></tr> : null}
        {!loading && !error && data?.customers.length === 0 ? <tr><td colSpan={5} style={{ textAlign: "center", padding: 36, color: "var(--ink-3)" }}>这个分类暂时没有客户。</td></tr> : null}
        {data?.customers.map((customer) => {
          const latest = customer.activities[0];
          const latestExpertProgress = customer.activities.find((activity) => activity.kind === "PLAN_UPDATED" && activity.note?.startsWith("专家情况："));
          const totalDeposit = customer.order ? customer.order.initialDepositCents + customer.order.rechargeCents : null;
          const withdrawal = customer.order?.withdrawalCents ?? 0;
          const net = (totalDeposit ?? 0) - withdrawal;
          const canAdvance = ["QUEUED", "MATERIALS", "TRACKING", "PENDING_REGISTRATION", "PENDING_ORDER"].includes(customer.stage);
          return <tr key={customer.id}>
            <td><strong>{customer.phone}</strong><div style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13, marginTop: 3 }}>{stageLabel(customer.stage)}</div><div className="muted">{customer.customerName || "未填写姓名"}{customer.customerPlatform ? ` · ${customer.customerPlatform}` : ""}</div><div className="muted">{customer.sourceName} · {customer.batch.sourceDate}</div>{customer.isHistoricalRecord ? <span className="badge" data-tone="warn">历史补录</span> : null}</td>
            <td><div style={{ display: "flex", flexDirection: "column", gap: 4 }}><div><span className="muted">粉的归属　</span>{customer.owner.name}</div><div><span className="muted">炒群负责人　</span>{customer.groupOperatorOwner?.name || "—"}</div><div><span className="muted">专家负责人　</span>{customer.expertOwner.name}</div><div><span className="muted">推专家　</span>{customer.expertIntroducedOn || "—"}</div>{customer.registeredOn ? <div><span className="muted">注册日期　</span>{customer.registeredOn}</div> : null}</div></td>
            <td><InlineProgressEditor label="专家情况" value={customer.expertNotes} meta={latestExpertProgress ? `${latestExpertProgress.occurredOn} · ${latestExpertProgress.actor.name}` : null} placeholder="填写目前与客户沟通、资料或跟进情况" disabled={!customer.canEdit || busyId === customer.id} onSave={(note) => saveInlineProgress(customer, note)} />{!customer.canEdit ? <div className="muted" style={{ marginBottom: 7 }}>当前负责人：只读查看</div> : null}{latest && latest.id !== latestExpertProgress?.id ? <><strong style={{ fontSize: 12.5 }}>{ACTIVITY_LABELS[latest.kind] ?? latest.kind}</strong><div className="muted" style={{ marginTop: 3 }}>{latest.occurredOn} · {latest.actor.name}</div><div style={{ marginTop: 6 }}>{latest.note || "没有补充说明"}</div></> : !latestExpertProgress ? <span className="muted">暂无跟进记录</span> : null}{customer.nextPlan ? <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--line)" }}><strong style={{ fontSize: 12.5 }}>下一步</strong><div style={{ marginTop: 3 }}>{customer.nextPlan}</div><div className="muted">{customer.nextFollowUpOn || "未定日期"}</div></div> : null}</td>
            <td><div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}><div><span className="muted">首充</span><br /><strong className="tnum">{money(customer.order?.initialDepositCents)}</strong></div><div><span className="muted">续充</span><br /><strong className="tnum">{money(customer.order?.rechargeCents)}</strong></div><div><span className="muted">出金</span><br /><strong className="tnum">{money(withdrawal)}</strong></div></div><div style={{ marginTop: 9, paddingTop: 8, borderTop: "1px dashed var(--line)", display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--accent)", fontSize: 12.5 }}>当前净业绩</span><strong className="tnum" style={{ color: net >= 0 ? "var(--ok)" : "var(--bad)" }}>{money(net)}</strong></div></td>
            <td><div style={{ display: "flex", flexDirection: "column", gap: 7, alignItems: "center" }}>
              {!customer.canEdit ? <span className="badge">只读</span> : null}
              {customer.canEdit ? <>
              {canAdvance ? <button className="btn" data-size="sm" data-variant="primary" disabled={busyId === customer.id} onClick={() => askStageAdvance(customer)}>{customer.stage === "PENDING_ORDER" ? "登记开单" : "推进下一步"}</button> : null}
              {customer.stage === "PENDING_ORDER" ? <><button className="btn" data-size="sm" disabled={busyId === customer.id} onClick={() => askDeclineDeposit(customer)}>未成交</button><button className="btn" data-size="sm" data-variant="danger" disabled={busyId === customer.id} onClick={() => askUndoRegister(customer)}>纠错撤销注册</button></> : null}
              {customer.stage === "DECLINED_DEPOSIT" ? <button className="btn" data-size="sm" data-variant="primary" disabled={busyId === customer.id} onClick={() => askRecoverDeposit(customer)}>恢复首充跟进</button> : null}
              {customer.stage === "ORDERED" && customer.order ? <button className="btn" data-size="sm" data-variant="primary" disabled={busyId === customer.id} onClick={() => askFinance(customer)}>续充 / 出金</button> : null}
              {customer.stage === "ORDERED" ? <><button className="btn" data-size="sm" disabled={busyId === customer.id} onClick={() => askStall(customer)}>停止维护</button><button className="btn" data-size="sm" data-variant="danger" disabled={busyId === customer.id} onClick={() => askVoidOrder(customer)}>纠错作废开单</button></> : null}
              {customer.stage === "STALLED" ? <button className="btn" data-size="sm" data-variant="primary" disabled={busyId === customer.id} onClick={() => askRecoverStalled(customer)}>恢复维护</button> : null}
              <button className="btn" data-size="sm" disabled={busyId === customer.id} onClick={() => askPlan(customer)}>更新计划</button>
              </> : null}
            </div></td>
          </tr>;
        })}
      </tbody>
    </table></div><footer className="table-footer"><span className="muted">共 {data?.total ?? 0} 位客户</span><div className="table-footer__actions"><button className="btn" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button><span className="tnum">{page} / {pageCount}</span><button className="btn" disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer></div>
    <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
  </section>;
}
