"use client";

import { useEffect, useState, type FormEvent } from "react";
import { requestJson } from "@/lib/backend";
import { IconSearch } from "./Icons";
import { WorkbenchStageChip } from "./WorkbenchStageChip";

type Stage = "reception" | "group" | "expert";
type Customer = {
  id: string; phone: string; customerName: string | null; customerPlatform: string | null;
  repliedOn: string | null; groupStatus: "NOT_JOINED" | "JOINED" | "LEFT"; joinedOn: string | null; leftOn: string | null;
  expertIntroducedOn: string | null; expertContactedOn: string | null; expertWorkflowStage: string | null; registeredOn: string | null;
  owner: { name: string }; groupOperatorOwner: { name: string } | null; expertOwner: { name: string } | null;
  batch: { sourceDate: string; channel: { name: string } };
  order: null | { openedOn: string; initialDepositCents: number; rechargeCents: number; withdrawalCents: number };
  activities: Array<{ kind: string; occurredOn: string; note: string | null; actor: { name: string } }>;
};
type Payload = { stage: Stage; page: number; pageSize: number; total: number; counts: Record<Stage, number>; customers: Customer[] };

const STAGES: Array<{ id: Stage; label: string }> = [
  { id: "reception", label: "接粉阶段" }, { id: "group", label: "炒群阶段" }, { id: "expert", label: "专家阶段" },
];
const EXPERT_LABEL: Record<string, string> = { QUEUED: "排队中", MATERIALS: "交资料", TRACKING: "追踪中", PENDING_REGISTRATION: "待注册", PENDING_ORDER: "待开单", DECLINED_DEPOSIT: "未成交", ORDERED: "已开单", STALLED: "停止维护" };
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

function statusOf(customer: Customer, stage: Stage) {
  if (stage === "reception") return customer.repliedOn ? "已回复，待入群" : "待回复";
  if (stage === "group") return customer.groupStatus === "LEFT" ? "已退群" : customer.expertIntroducedOn ? "已推专家" : "在群跟进";
  if (customer.order) return "已开单";
  if (customer.expertWorkflowStage) return EXPERT_LABEL[customer.expertWorkflowStage] ?? customer.expertWorkflowStage;
  if (customer.registeredOn) return "已注册，待开单";
  if (customer.expertContactedOn) return "专家跟进中";
  return "待专家接待";
}

export function RealReceptionProgress() {
  const [stage, setStage] = useState<Stage>("reception");
  const [page, setPage] = useState(1);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ stage, page: String(page) });
      if (query) params.set("q", query);
      setData(await requestJson<Payload>(`/api/lead/customer-reporting?${params}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "客户进度加载失败");
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [stage, page, query]);
  function search(event: FormEvent) { event.preventDefault(); setPage(1); setQuery(queryInput.trim()); }
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 50)));

  return <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
    <div className="card" style={{ padding: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div><h2 className="card-title">我的客户全流程</h2><p className="card-note">号码进入炒群或专家阶段后仍能在这里只读查看，不会重复计算业绩，也不能替其他岗位操作。</p></div>
      <form onSubmit={search} style={{ display: "flex", gap: 8 }}><label style={{ position: "relative" }}><span style={{ position: "absolute", left: 10, top: 8, color: "var(--ink-3)" }}><IconSearch size={16} /></span><input className="field" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="搜索号码或姓名" style={{ width: 230, paddingLeft: 34 }} /></label><button className="btn">搜索</button></form>
    </div>
    <div className="card" style={{ padding: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>{STAGES.map((item) => <WorkbenchStageChip key={item.id} active={stage === item.id} label={item.label} count={data?.counts[item.id] ?? 0} onClick={() => { setStage(item.id); setPage(1); }} />)}</div>
    {error ? <div className="card" role="alert" style={{ padding: 14, color: "var(--bad)", borderColor: "var(--bad-line)" }}>{error} <button className="btn" data-size="sm" onClick={() => void load()}>重试</button></div> : null}
    <div className="card" style={{ overflow: "hidden" }}><div className="table-scroll"><table className="grid-table" style={{ minWidth: 1050 }}><thead><tr><th>客户</th><th>负责人</th><th>当前进度</th><th>最近情况</th><th>资金情况</th></tr></thead><tbody>
      {loading && !data ? <tr><td colSpan={5} style={{ textAlign: "center", padding: 34 }}>正在读取真实客户…</td></tr> : null}
      {!loading && !error && !data?.customers.length ? <tr><td colSpan={5} style={{ textAlign: "center", padding: 34, color: "var(--ink-3)" }}>这个阶段暂时没有客户。</td></tr> : null}
      {data?.customers.map((customer) => { const latest = customer.activities[0]; const total = customer.order ? customer.order.initialDepositCents + customer.order.rechargeCents : 0; return <tr key={customer.id}><td><strong>{customer.phone}</strong><div className="muted">{customer.customerName || "未填写姓名"}{customer.customerPlatform ? ` · ${customer.customerPlatform}` : ""}</div><div className="muted">{customer.batch.channel.name} · {customer.batch.sourceDate}</div></td><td>接粉：{customer.owner.name}<div className="muted">炒群：{customer.groupOperatorOwner?.name || "待交接"}</div><div className="muted">专家：{customer.expertOwner?.name || "待分配"}</div></td><td><strong style={{ color: "var(--accent)" }}>{statusOf(customer, stage)}</strong><div className="muted">入群 {customer.joinedOn || "—"} · 推专家 {customer.expertIntroducedOn || "—"}</div></td><td>{latest ? <>{latest.note || statusOf(customer, stage)}<div className="muted">{latest.occurredOn} · {latest.actor.name}</div></> : <span className="muted">暂无跟进记录</span>}</td><td>{customer.order ? <><strong className="tnum">累计入金 {money(total)}</strong><div className="muted">首充 {money(customer.order.initialDepositCents)} · 续充 {money(customer.order.rechargeCents)}</div><div className="muted">出金 {money(customer.order.withdrawalCents)}</div></> : <span className="muted">尚未开单</span>}</td></tr>; })}
    </tbody></table></div><div style={{ padding: 12, display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line)" }}><span className="muted">共 {data?.total ?? 0} 位 · 第 {page}/{pages} 页</span><div style={{ display: "flex", gap: 8 }}><button className="btn" data-size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><button className="btn" data-size="sm" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>下一页</button><button className="btn" data-size="sm" onClick={() => void load()}>刷新</button></div></div></div>
  </div>;
}
