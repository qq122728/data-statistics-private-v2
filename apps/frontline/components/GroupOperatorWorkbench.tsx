"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { requestJson } from "@/lib/backend";
import { localToday, money, type GroupOperatorCustomer, type GroupOperatorResponse, type GroupOperatorStage } from "@/lib/frontline-workbench";
import { ConfirmDialog, type Confirm } from "./ConfirmDialog";
import { HistoricalCustomerClaimPanel } from "./HistoricalCustomerClaimPanel";
import { IconSearch } from "./Icons";
import { InlineProgressEditor } from "./InlineProgressEditor";
import { WorkbenchStageChip } from "./WorkbenchStageChip";

const STAGES: Array<{ id: GroupOperatorStage; label: string }> = [
  { id: "active", label: "在群待推专家" },
  { id: "introduced", label: "已推专家" },
  { id: "left", label: "已退群" },
];

const ACTIVITY_LABELS: Record<string, string> = {
  JOINED_GROUP: "已进群", LEFT_GROUP: "已退群", GROUP_PROGRESS_UPDATED: "群内进度",
  EXPERT_INTRODUCED: "已推专家", EXPERT_CONTACTED: "专家已接待", REGISTERED: "已注册",
  PLAN_UPDATED: "计划已更新", ORDER_VOIDED: "开单已作废", FINANCE_VOIDED: "资金已作废",
};

export function GroupOperatorWorkbench() {
  const [stage, setStage] = useState<GroupOperatorStage>("active");
  const [page, setPage] = useState(1);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<GroupOperatorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ stage, page: String(page) });
    if (query) params.set("q", query);
    try {
      setData(await requestJson<GroupOperatorResponse>(`/api/group-operator/customers?${params}`, { signal }));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "炒群客户读取失败");
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

  async function workflow(customer: GroupOperatorCustomer, body: Record<string, unknown>, message: string) {
    setConfirm(null);
    setBusyId(customer.id);
    setError("");
    try {
      await requestJson(`/api/leads/${customer.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      setSuccess(message);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，请稍后重试");
    } finally {
      setBusyId(null);
    }
  }

  async function saveInlineProgress(customer: GroupOperatorCustomer, progressNote: string) {
    setBusyId(customer.id);
    setError("");
    try {
      await requestJson(`/api/leads/${customer.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateGroupProgress", progressNote, occurredOn: localToday() }),
      });
      setSuccess(`${customer.phone} 的炒群情况已自动保存`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "炒群情况自动保存失败");
      throw caught;
    } finally {
      setBusyId(null);
    }
  }

  function askLeave(customer: GroupOperatorCustomer) {
    setConfirm({
      title: "确认客户已经退群？", desc: "系统会按进群和退群日期判断正常或异常退群，记录会保留，之后可以纠错恢复。",
      confirmLabel: "确认退群", target: customer.phone, danger: true,
      reasonLabel: "退群说明", reasonPlaceholder: "例如：客户主动退出群聊",
      dateLabel: "实际退群日期", defaultDate: localToday(),
      onConfirm: (leaveNote, _number, _kind, occurredOn) => void workflow(customer, {
        action: "leaveGroup", leaveNote, occurredOn,
      }, `${customer.phone} 已记录退群`),
    });
  }

  function askIntroduce(customer: GroupOperatorCustomer) {
    const assignees = data?.expertAssignees ?? [];
    if (!assignees.length) {
      setError("本组暂时没有可接手的在职专家或组长，请先联系组长配置账号");
      return;
    }
    setConfirm({
      title: "推给专家", desc: "默认由本组组长以专家身份接手；只有你主动改选其他专家，客户才会转给其他人。",
      confirmLabel: "确认推专家", target: customer.phone,
      kindLabel: "专家负责人", kindOptions: assignees.map((item) => ({ value: item.id, label: `${item.name}${item.role === "LEAD" ? "（组长·默认专家）" : ""}` })),
      defaultKind: data?.defaultExpertId ?? assignees[0]?.id,
      dateLabel: "推专家日期", defaultDate: localToday(),
      onConfirm: (_reason, _number, expertOwnerId, occurredOn) => void workflow(customer, {
        action: "introduceExpert", expertOwnerId, occurredOn,
      }, `${customer.phone} 已推给专家`),
    });
  }

  function askUndoLeave(customer: GroupOperatorCustomer) {
    setConfirm({
      title: "撤销误点的退群？", desc: "只用于退群记录填错。系统会恢复客户的在群状态，并保留纠错人和原因。",
      confirmLabel: "确认撤销退群", target: customer.phone, danger: true,
      reasonLabel: "纠错原因", reasonPlaceholder: "例如：点错客户，实际仍在群里",
      onConfirm: (reason) => void workflow(customer, { action: "undoLeaveGroup", reason }, `${customer.phone} 的退群记录已撤销`),
    });
  }

  function askUndoIntroduce(customer: GroupOperatorCustomer) {
    setConfirm({
      title: "撤销误点的推专家？", desc: "仅当专家还没有开始接待、注册或开单时可以撤销；客户已经继续推进时系统会拒绝。",
      confirmLabel: "确认撤回推专家", target: customer.phone, danger: true,
      reasonLabel: "纠错原因", reasonPlaceholder: "例如：专家负责人选错",
      onConfirm: (reason) => void workflow(customer, { action: "undoIntroduceExpert", reason }, `${customer.phone} 已撤回推专家`),
    });
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setQuery(queryInput.trim());
  }

  const counts = data?.counts ?? { active: 0, introduced: 0, left: 0 };
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 50)));

  return <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
    <div className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <div><h2 style={{ margin: 0, fontSize: 17 }}>我的炒群客户</h2><p className="muted" style={{ margin: "3px 0 0" }}>真实数据库 · 按客户冻结归属和当前接粉配对计算，只显示本人负责的客户。</p></div>
      <span className="badge" data-tone="ok">真实数据</span>
    </div>

    <div className="card workbench-toolbar">
      <div className="workbench-toolbar__actions">{STAGES.map((item) => <WorkbenchStageChip key={item.id} active={stage === item.id} label={item.label} count={counts[item.id]} onClick={() => { setStage(item.id); setPage(1); }} />)}<HistoricalCustomerClaimPanel workspaceRole="GROUP_OPERATOR" onSaved={load} /></div>
      <form className="workbench-toolbar__search" onSubmit={submitSearch}>
        <label style={{ position: "relative" }}><span style={{ position: "absolute", left: 10, top: 8, color: "var(--ink-3)" }}><IconSearch size={16} /></span><input className="field" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="搜索号码或姓名" maxLength={120} style={{ paddingLeft: 34 }} /></label>
        <button className="btn" type="submit">搜索</button>
        {query ? <button className="btn" type="button" onClick={() => { setQueryInput(""); setQuery(""); setPage(1); }}>清除</button> : null}
      </form>
    </div>

    {error ? <div className="card" role="alert" style={{ padding: 14, color: "var(--bad)", borderColor: "var(--bad-line)" }}>{error} <button className="btn" data-size="sm" onClick={() => void load()}>重试</button></div> : null}
    {success ? <div className="card" role="status" style={{ padding: 14, color: "var(--ok)", borderColor: "var(--ok-line)" }}>{success}</div> : null}

    <div className="card" style={{ overflow: "hidden" }}><div className="table-scroll"><table className="grid-table" data-sticky-edges="true" style={{ minWidth: data?.customers.length ? 960 : "100%" }}>
      <colgroup><col style={{ width: "17%" }} /><col style={{ width: "19%" }} /><col style={{ width: "27%" }} /><col style={{ width: "20%" }} /><col style={{ width: "17%" }} /></colgroup>
      <thead><tr><th>客户</th><th>交接与负责人</th><th>最新进度</th><th>资金与业绩</th><th style={{ textAlign: "center" }}>本次处理</th></tr></thead>
      <tbody>
        {loading && !data ? <tr><td colSpan={5} style={{ textAlign: "center", padding: 36 }}>正在读取真实客户…</td></tr> : null}
        {!loading && !error && data?.customers.length === 0 ? <tr><td colSpan={5} style={{ textAlign: "center", padding: 36, color: "var(--ink-3)" }}>这个分类暂时没有客户。</td></tr> : null}
        {data?.customers.map((customer) => {
          const latest = customer.activities[0];
          const latestGroupProgress = customer.latestGroupProgress;
          const totalDeposit = customer.order ? customer.order.initialDepositCents + customer.order.rechargeCents : null;
          const withdrawal = customer.order?.withdrawalCents ?? 0;
          const net = (totalDeposit ?? 0) - withdrawal;
          return <tr key={customer.id}>
            <td><strong>{customer.phone}</strong><div style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13, marginTop: 3 }}>{STAGES.find((item) => item.id === customer.stage)?.label}</div><div className="muted">{customer.customerName || "未填写姓名"}{customer.customerPlatform ? ` · ${customer.customerPlatform}` : ""}</div><div className="muted">{customer.sourceName} · {customer.batch.sourceDate}</div>{customer.isHistoricalRecord ? <span className="badge" data-tone="warn">历史补录</span> : null}</td>
            <td><div style={{ display: "flex", flexDirection: "column", gap: 4 }}><div><span className="muted">粉的归属　</span>{customer.owner.name}</div><div><span className="muted">专家负责人　</span>{customer.expertOwner?.name || "尚未推送"}</div><div><span className="muted">进群日期　</span>{customer.joinedOn || "—"}</div>{customer.expertIntroducedOn ? <div><span className="muted">推专家　</span>{customer.expertIntroducedOn}</div> : null}{customer.leftOn ? <div><span className="muted">退群日期　</span>{customer.leftOn}</div> : null}</div></td>
            <td><InlineProgressEditor label="炒群情况" value={latestGroupProgress?.note ?? null} meta={latestGroupProgress ? `${latestGroupProgress.occurredOn} · ${latestGroupProgress.actor.name}` : null} placeholder="填写目前群内沟通情况" disabled={busyId === customer.id} onSave={(note) => saveInlineProgress(customer, note)} />{latest && latest.id !== latestGroupProgress?.id ? <><strong style={{ fontSize: 12.5 }}>{ACTIVITY_LABELS[latest.kind] ?? latest.kind}</strong><div className="muted" style={{ marginTop: 3 }}>{latest.occurredOn} · {latest.actor.name}</div><div style={{ marginTop: 6 }}>{latest.note || "没有补充说明"}</div></> : !latestGroupProgress ? <span className="muted">暂无进度记录</span> : null}</td>
            <td><div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}><div><span className="muted">首充</span><br /><strong className="tnum">{money(customer.order?.initialDepositCents)}</strong></div><div><span className="muted">续充</span><br /><strong className="tnum">{money(customer.order?.rechargeCents)}</strong></div><div><span className="muted">出金</span><br /><strong className="tnum">{money(withdrawal)}</strong></div></div><div style={{ marginTop: 9, paddingTop: 8, borderTop: "1px dashed var(--line)", display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--accent)", fontSize: 12.5 }}>当前净业绩</span><strong className="tnum" style={{ color: net >= 0 ? "var(--ok)" : "var(--bad)" }}>{money(net)}</strong></div></td>
            <td><div style={{ display: "flex", flexDirection: "column", gap: 7, alignItems: "center" }}>
              {customer.stage === "active" ? <button className="btn" data-size="sm" data-variant="primary" disabled={busyId === customer.id} onClick={() => askIntroduce(customer)}>推专家</button> : null}
              {customer.groupStatus === "JOINED" ? <button className="btn" data-size="sm" disabled={busyId === customer.id} onClick={() => askLeave(customer)}>退群</button> : null}
              {customer.stage === "introduced" ? <button className="btn" data-size="sm" data-variant="danger" disabled={busyId === customer.id} onClick={() => askUndoIntroduce(customer)}>纠错撤回推专家</button> : null}
              {customer.stage === "left" ? <button className="btn" data-size="sm" data-variant="danger" disabled={busyId === customer.id} onClick={() => askUndoLeave(customer)}>纠错撤销退群</button> : null}
            </div></td>
          </tr>;
        })}
      </tbody>
    </table></div><footer className="table-footer"><span className="muted">共 {data?.total ?? 0} 位客户</span><div className="table-footer__actions"><button className="btn" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button><span className="tnum">{page} / {pageCount}</span><button className="btn" disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer></div>
    <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
  </section>;
}
