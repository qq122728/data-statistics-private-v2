"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { requestJson } from "@/lib/backend";
import { IconSearch } from "./Icons";
import { ConfirmDialog, type Confirm } from "./ConfirmDialog";
import { HistoricalCustomerClaimPanel } from "./HistoricalCustomerClaimPanel";
import { WorkbenchStageChip } from "./WorkbenchStageChip";

type Stage = "reply" | "group" | "archived";

type ReceptionCustomer = {
  id: string;
  phone: string;
  customerName: string | null;
  customerEmail: string | null;
  lossAmountCents: number | null;
  customerPlatform: string | null;
  notes: string | null;
  invalid: boolean;
  receptionCategory: string;
  replyStatus: string;
  repliedOn: string | null;
  followUpCount: number;
  lastFollowedUpOn: string | null;
  receptionChatStatus: string | null;
  receptionArchivedAt: string | null;
  receptionArchiveReason: string | null;
  receptionArchiveVisitCount: number | null;
  attributionOwner: { id: string; name: string } | null;
  groupOperatorOwner: { id: string; name: string } | null;
  device: { id: string; code: string } | null;
  batch: { sourceDate: string; channel: { id: string; name: string } };
  activities: Array<{ id: string; kind: string; occurredOn: string; note: string | null; actor: { name: string } }>;
};

type CustomerResponse = {
  stage: Stage;
  page: number;
  pageSize: number;
  total: number;
  currentGroupOperator: { id: string; name: string } | null;
  receptionDevices: Array<{ id: string; code: string }>;
  counts: Record<Stage, number>;
  customers: ReceptionCustomer[];
};

const STAGES: Array<{ id: Stage; label: string; hint: string }> = [
  { id: "reply", label: "待回复", hint: "还没有确认回复的客户" },
  { id: "group", label: "已回复待入群", hint: "已经回复，等待确认入群" },
  { id: "archived", label: "归档", hint: "回访达到归档条件，或手动归档" },
];

const ACTIVITY_LABELS: Record<string, string> = {
  FOLLOWED_UP: "已记录回访",
  REPLIED: "已确认回复",
  REPLY_UNDONE: "已撤销回复",
  RECEPTION_STATUS_UPDATED: "已更新聊天状态",
  RECEPTION_ARCHIVED: "已归档",
};

function customerStatus(customer: ReceptionCustomer) {
  if (customer.receptionArchivedAt || (!customer.repliedOn && customer.followUpCount >= 5))
    return { label: "已归档", tone: "mute" } as const;
  if (customer.repliedOn)
    return { label: customer.receptionChatStatus === "READY_TO_JOIN" ? "准备拉群" : "正常聊天", tone: "warn" } as const;
  if (!customer.device)
    return { label: "待填写设备", tone: "warn" } as const;
  if (customer.followUpCount)
    return { label: `已回访 ${customer.followUpCount} 次`, tone: "warn" } as const;
  return { label: "未回复", tone: "bad" } as const;
}

function amount(cents: number | null) {
  if (cents === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function RealReceptionFollowUp({ onReplyCountChange }: { onReplyCountChange: (count: number) => void }) {
  const [stage, setStage] = useState<Stage>("reply");
  const [page, setPage] = useState(1);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<CustomerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmation, setConfirmation] = useState<Confirm | null>(null);
  const [actionCustomerId, setActionCustomerId] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ stage, page: String(page) });
    if (query) params.set("q", query);
    try {
      const result = await requestJson<CustomerResponse>(`/api/reception/customers?${params}`, { signal });
      setData(result);
      onReplyCountChange(result.counts.reply);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "客户名单读取失败");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [onReplyCountChange, page, query, stage]);

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

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setQuery(queryInput.trim());
  }

  async function performAction(
    customer: ReceptionCustomer,
    action: "assignDevice" | "followUp" | "reply" | "undoReply" | "updateReceptionChatStatus" | "joinGroup" | "archiveRepliedCustomer",
    extra: Record<string, unknown> = {},
    successMessage?: string,
  ) {
    setConfirmation(null);
    setActionCustomerId(customer.id);
    setError("");
    setSuccess("");
    try {
      await requestJson(`/api/leads/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      setSuccess(successMessage ?? (action === "reply"
        ? `${customer.phone} 已确认回复，已转入“已回复待入群”`
        : action === "joinGroup"
          ? `${customer.phone} 已确认入群，并交给炒群继续跟进`
          : `${customer.phone} 已保存`));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请稍后重试");
    } finally {
      setActionCustomerId(null);
    }
  }

  function askAssignDevice(customer: ReceptionCustomer) {
    const devices = data?.receptionDevices ?? [];
    if (!devices.length) {
      setError("请先在左侧“设备账号”中添加本人正在使用的接粉账号");
      return;
    }
    setConfirmation({
      title: "选择本次联系使用的接粉设备",
      desc: "选择后会绑定到这个客户，之后的回访和确认回复都会使用这条设备记录。",
      confirmLabel: "确认绑定设备",
      target: `${customer.phone}${customer.customerName ? ` · ${customer.customerName}` : ""}`,
      kindLabel: "接粉设备号",
      kindOptions: devices.map((device) => ({ value: device.code, label: device.code })),
      defaultKind: devices[0]?.code,
      onConfirm: (_reason, _number, deviceCode) => deviceCode
        ? void performAction(customer, "assignDevice", { deviceCode }, `${customer.phone} 已绑定接粉设备 ${deviceCode}`)
        : undefined,
    });
  }

  function askFollowUp(customer: ReceptionCustomer) {
    setConfirmation({
      title: "登记一次真实回访？",
      desc: "只在确实联系过客户时登记。保存后回访次数加 1，并记录实际回访日期。",
      confirmLabel: "确认登记回访",
      target: `${customer.phone}${customer.customerName ? ` · ${customer.customerName}` : ""}`,
      dateLabel: "实际回访日期",
      onConfirm: (_reason, _number, _kind, occurredOn) => void performAction(customer, "followUp", { occurredOn }, `${customer.phone} 已增加 1 次回访`),
    });
  }

  function askReply(customer: ReceptionCustomer) {
    setConfirmation({
      title: "确认客户已经回复？",
      desc: "确认后，客户会从待回复转到“已回复待入群”。系统会记录今天为回复日期。",
      confirmLabel: "确认已回复",
      target: `${customer.phone}${customer.customerName ? ` · ${customer.customerName}` : ""}`,
      onConfirm: () => void performAction(customer, "reply"),
    });
  }

  function askJoinGroup(customer: ReceptionCustomer, groupOperator: { id: string; name: string }) {
    setConfirmation({
      title: "确认客户已经入群？",
      desc: "这是接粉向炒群交棒。确认后，该客户由配对的炒群负责人继续处理，接粉只能查看后续进度。",
      confirmLabel: "确认入群并交棒",
      target: `${customer.phone}${customer.customerName ? ` · ${customer.customerName}` : ""} → ${groupOperator.name}`,
      onConfirm: () => void performAction(customer, "joinGroup"),
    });
  }

  function askChatStatus(customer: ReceptionCustomer, next: "NORMAL_CHAT" | "READY_TO_JOIN") {
    setConfirmation({
      title: next === "READY_TO_JOIN" ? "客户已经准备入群？" : "改回正常聊天？",
      desc: next === "READY_TO_JOIN" ? "这里只标记客户已经聊到可以拉群；真正进入群聊后还要再点“确认入群”。" : "客户暂时还不能拉群，退回正常聊天继续跟进。",
      confirmLabel: next === "READY_TO_JOIN" ? "标记准备拉群" : "改回正常聊天",
      target: `${customer.phone}${customer.customerName ? ` · ${customer.customerName}` : ""}`,
      onConfirm: () => void performAction(customer, "updateReceptionChatStatus", { receptionChatStatus: next }, `${customer.phone} 已改为${next === "READY_TO_JOIN" ? "准备拉群" : "正常聊天"}`),
    });
  }

  function askUndoReply(customer: ReceptionCustomer) {
    setConfirmation({
      title: "撤销误点的回复？",
      desc: "仅用于刚才误点。客户一旦已经入群、推专家或开单，系统会拒绝倒退。",
      confirmLabel: "确认撤销回复",
      target: `${customer.phone}${customer.customerName ? ` · ${customer.customerName}` : ""}`,
      danger: true,
      reasonLabel: "纠错原因",
      reasonPlaceholder: "例如：刚才点错号码",
      onConfirm: (reason) => void performAction(customer, "undoReply", { reason }, `${customer.phone} 的回复标记已撤销`),
    });
  }

  function askArchive(customer: ReceptionCustomer) {
    setConfirmation({
      title: "确认归档该客户？",
      desc: "只用于已经回复、最终没有入群的客户。归档后不再占用当前待办，原因和实际回访次数会永久留在操作记录中。",
      confirmLabel: "确认归档",
      target: `${customer.phone}${customer.customerName ? ` · ${customer.customerName}` : ""}`,
      danger: true,
      reasonLabel: "归档原因",
      reasonPlaceholder: "例如：多次沟通后明确拒绝进群",
      numberLabel: "实际回访次数",
      defaultNumber: String(customer.followUpCount),
      onConfirm: (reason, archiveVisitCount) => {
        if (archiveVisitCount === undefined) return;
        void performAction(customer, "archiveRepliedCustomer", { reason, archiveVisitCount });
      },
    });
  }

  const counts = data?.counts ?? { reply: 0, group: 0, archived: 0 };
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 50)));

  return <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
    <div className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 17 }}>我的接粉客户</h2>
        <p style={{ margin: "3px 0 0", color: "var(--ink-3)", fontSize: 13 }}>真实数据库 · 这里只显示当前登录人名下的客户，不会看到同事的号码。</p>
      </div>
      <span className="badge" data-tone="ok">真实数据</span>
    </div>

    <div className="card workbench-toolbar">
        <div className="workbench-toolbar__actions">
          {STAGES.map((item) => <WorkbenchStageChip
            key={item.id}
            active={stage === item.id}
            label={item.label}
            count={counts[item.id]}
            onClick={() => { setStage(item.id); setPage(1); }}
          />)}
          <HistoricalCustomerClaimPanel workspaceRole="RECEPTION" onSaved={load} />
        </div>
        <form className="workbench-toolbar__search" onSubmit={submitSearch}>
          <label style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 10, top: 8, color: "var(--ink-3)", pointerEvents: "none" }}><IconSearch size={16} /></span>
            <input
              className="field"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder="搜索号码或姓名"
              maxLength={120}
              style={{ paddingLeft: 34 }}
            />
          </label>
          <button className="btn" type="submit">搜索</button>
          {query ? <button className="btn" type="button" onClick={() => { setQueryInput(""); setQuery(""); setPage(1); }}>清除</button> : null}
        </form>
    </div>

    {error ? <div className="card" role="alert" style={{ padding: 18, borderColor: "var(--bad-line)", color: "var(--bad)" }}>
      {error} <button className="btn" data-size="sm" type="button" onClick={() => void load()}>重新读取</button>
    </div> : null}

    {success ? <div className="card" role="status" style={{ padding: 14, borderColor: "var(--ok-line)", color: "var(--ok)" }}>{success}</div> : null}

    <div className="card" style={{ overflow: "hidden" }}>
      <div className="table-scroll">
        <table className="grid-table" data-sticky-edges="true" style={{ minWidth: data?.customers.length ? 960 : "100%" }}>
          <colgroup><col style={{ width: "16%" }} /><col style={{ width: "11%" }} /><col style={{ width: "18%" }} /><col style={{ width: "15%" }} /><col style={{ width: "24%" }} /><col style={{ width: "16%" }} /></colgroup>
          <thead><tr><th>客户</th><th>来源</th><th>客户资料</th><th>当前进度</th><th>交接与最近情况</th><th style={{ textAlign: "center" }}>本次处理</th></tr></thead>
          <tbody>
            {loading && !data ? <tr><td colSpan={6} style={{ textAlign: "center", padding: 36, color: "var(--ink-3)" }}>正在读取真实客户名单…</td></tr> : null}
            {!loading && !error && data?.customers.length === 0 ? <tr><td colSpan={6} style={{ textAlign: "center", padding: 36, color: "var(--ink-3)" }}>这个分类暂时没有客户。</td></tr> : null}
            {data?.customers.map((customer) => {
              const status = customerStatus(customer);
              const latest = customer.activities[0];
              const groupOperator = customer.groupOperatorOwner ?? data.currentGroupOperator;
              return <tr key={customer.id}>
                <td><strong>{customer.phone}</strong><div className="muted">{customer.customerName || "未填写姓名"}</div>{customer.receptionArchivedAt ? <span className="badge" data-tone="mute">已归档</span> : null}</td>
                <td>{customer.batch.channel.name}<div className="muted">{customer.batch.sourceDate}</div></td>
                <td><div style={{ display: "flex", flexDirection: "column", gap: 4 }}><div><span className="muted">邮箱　</span>{customer.customerEmail || "—"}</div><div><span className="muted">金额　</span><span className="tnum">{amount(customer.lossAmountCents)}</span></div><div><span className="muted">平台　</span>{customer.customerPlatform || "—"}</div></div></td>
                <td><span className="badge" data-tone={status.tone}>{status.label}</span>{customer.invalid ? <div style={{ color: "var(--bad)", marginTop: 4 }}>已标记无效</div> : null}<div className="muted" style={{ marginTop: 5 }}>设备 {customer.device?.code || "未填写"}</div><div className="muted">回访 {customer.followUpCount} 次</div></td>
                <td><div><span className="muted">炒群负责人　</span>{groupOperator?.name || "待配对"}</div><div className="muted" style={{ marginTop: 3 }}>{customer.groupOperatorOwner ? "客户已冻结归属" : groupOperator ? "使用当前接粉配对" : "组长尚未配对"} · 粉归属：{customer.attributionOwner?.name || "本人"}</div><div style={{ marginTop: 9, paddingTop: 8, borderTop: "1px dashed var(--line)" }}>{latest ? <><strong style={{ fontSize: 12.5 }}>{ACTIVITY_LABELS[latest.kind] ?? latest.kind}</strong><div className="muted">{latest.occurredOn} · {latest.actor.name}{latest.note ? ` · ${latest.note}` : ""}</div></> : <span className="muted">{customer.notes || "暂无记录"}</span>}{customer.receptionArchiveReason ? <div style={{ color: "var(--warn)" }}>归档原因：{customer.receptionArchiveReason}</div> : null}</div></td>
                <td style={{ textAlign: "center" }}>
                  {stage === "reply" ? <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    {!customer.device ? <button className="btn" data-size="sm" data-variant="primary" type="button" disabled={loading || actionCustomerId === customer.id} onClick={() => askAssignDevice(customer)}>选择接粉设备</button> : null}
                    <button className="btn" data-size="sm" type="button" disabled={loading || actionCustomerId === customer.id || !customer.device} title={!customer.device ? "请先选择本人正在使用的接粉设备" : undefined} onClick={() => askFollowUp(customer)}>回访 +1</button>
                    <button className="btn" data-size="sm" data-variant="primary" type="button" disabled={loading || actionCustomerId === customer.id || !customer.device} title={!customer.device ? "请先选择本人正在使用的接粉设备" : undefined} onClick={() => askReply(customer)}>{actionCustomerId === customer.id ? "处理中…" : "确认已回复"}</button>
                  </div> : null}
                  {stage === "group" ? <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    <button className="btn" data-size="sm" type="button" disabled={loading || actionCustomerId === customer.id} onClick={() => askChatStatus(customer, customer.receptionChatStatus === "READY_TO_JOIN" ? "NORMAL_CHAT" : "READY_TO_JOIN")}>{customer.receptionChatStatus === "READY_TO_JOIN" ? "改回正常聊天" : "准备拉群"}</button>
                    <button
                      className="btn"
                      data-size="sm"
                      data-variant="primary"
                      type="button"
                      disabled={loading || actionCustomerId === customer.id || !groupOperator}
                      title={!groupOperator ? "当前接粉尚未配对炒群，需组长先完成配对" : undefined}
                      onClick={() => groupOperator && askJoinGroup(customer, groupOperator)}
                    >{actionCustomerId === customer.id ? "处理中…" : "确认入群"}</button>
                    <button
                      className="btn"
                      data-size="sm"
                      type="button"
                      disabled={loading || actionCustomerId === customer.id}
                      onClick={() => askArchive(customer)}
                    >归档</button>
                    <button className="btn" data-size="sm" data-variant="danger" type="button" disabled={loading || actionCustomerId === customer.id} onClick={() => askUndoReply(customer)}>纠错</button>
                    {!groupOperator ? <span className="muted">需先配对炒群</span> : null}
                  </div> : null}
                  {stage === "archived" ? <span className="muted">只读记录</span> : null}
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <footer className="table-footer">
        <span className="muted">共 <span className="tnum">{data?.total ?? 0}</span> 位 · 第 {page}/{pageCount} 页</span>
        <div className="table-footer__actions">
          <button className="btn" data-size="sm" type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button>
          <button className="btn" data-size="sm" type="button" disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>下一页</button>
          <button className="btn" data-size="sm" type="button" disabled={loading} onClick={() => void load()}>刷新</button>
        </div>
      </footer>
    </div>

    <p style={{ margin: 0, color: "var(--ink-3)", fontSize: 12.5 }}>确认回复、确认入群和归档都会写入真实数据库；每次操作都要经过两步确认，成功后名单会自动刷新。</p>
    <ConfirmDialog confirm={confirmation} onClose={() => setConfirmation(null)} />
  </section>;
}
