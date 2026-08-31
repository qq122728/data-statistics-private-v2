"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { requestJson } from "@/lib/backend";

type Position = "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
type Revision = Record<string, number | string | null> & { version: number; changeReason: string | null; createdAt?: string; createdBy?: { name: string } };
type Entry = { id: string; identityKey: string; businessDate: string; position: Position; status: string; channel: { id: string; name: string }; currentRevision: Revision | null; approvedRevision: Revision | null; revisions: Revision[] };
type Payload = { member: { id: string; name: string; active: boolean }; group: { id: string; name: string }; entries: Entry[] };
export type InspectorMember = { id: string; name: string };
type Metric = { field: string; label: string; editable: boolean; money?: boolean };

const positionLabels: Record<Position, string> = { RECEPTION: "组员数据", GROUP_OPERATOR: "旧炒群数据", EXPERT: "旧专家与财务" };
const metrics: Record<Position, Metric[]> = {
  RECEPTION: [
    { field: "dispatchCount", label: "添加数据", editable: true }, { field: "duplicateCount", label: "撞粉", editable: true },
    { field: "lowAmountCount", label: "低金额", editable: true }, { field: "noWsCount", label: "无 WS 号码", editable: true },
    { field: "manualInvalidCount", label: "人工无效", editable: true }, { field: "effectiveCount", label: "有效数据", editable: false },
    { field: "replyCount", label: "回复", editable: true }, { field: "joinCount", label: "进群", editable: true },
  ],
  GROUP_OPERATOR: [
    { field: "operatorReceivedCount", label: "接手／进群", editable: true }, { field: "normalLeaveCount", label: "正常退群", editable: true },
    { field: "abnormalLeaveCount", label: "异常退群", editable: true }, { field: "currentInGroupCount", label: "当前在群", editable: false },
    { field: "expertIntroCount", label: "推专家", editable: true },
  ],
  EXPERT: [
    { field: "registrationCount", label: "注册", editable: true }, { field: "orderCount", label: "开单", editable: true },
    { field: "cryptoInitialDepositCents", label: "加密货币首充", editable: true, money: true }, { field: "bankInitialDepositCents", label: "银行卡首充", editable: true, money: true },
    { field: "cryptoRechargeCents", label: "加密货币续充", editable: true, money: true }, { field: "bankRechargeCents", label: "银行卡续充", editable: true, money: true },
    { field: "withdrawalCents", label: "出金", editable: true, money: true }, { field: "netPerformance", label: "净业绩", editable: false, money: true },
  ],
};

const unifiedReceptionMetrics: Metric[] = [
  ...metrics.RECEPTION,
  { field: "normalLeaveCount", label: "正常退群", editable: true }, { field: "abnormalLeaveCount", label: "异常退群", editable: true },
  { field: "currentInGroupCount", label: "当前在群", editable: false }, { field: "expertIntroCount", label: "推专家", editable: true },
  { field: "registrationCount", label: "注册", editable: true }, { field: "orderCount", label: "开单", editable: true },
  { field: "cryptoInitialDepositCents", label: "加密货币首充", editable: true, money: true }, { field: "bankInitialDepositCents", label: "银行卡首充", editable: true, money: true },
  { field: "cryptoRechargeCents", label: "加密货币续充", editable: true, money: true }, { field: "bankRechargeCents", label: "银行卡续充", editable: true, money: true },
  { field: "withdrawalCents", label: "出金", editable: true, money: true }, { field: "netPerformance", label: "净业绩", editable: false, money: true },
];

function isUnifiedEntry(entry: Entry) { return entry.position === "RECEPTION" && entry.identityKey.startsWith("unified-member-v1:"); }
function metricsFor(entry: Entry) { return isUnifiedEntry(entry) ? unifiedReceptionMetrics : metrics[entry.position]; }
function positionLabel(entry: Entry) { return isUnifiedEntry(entry) ? "统一组员数据" : positionLabels[entry.position]; }

function numeric(entry: Entry, field: string) { return Number(entry.currentRevision?.[field] || 0); }
function metricValue(entry: Entry, metric: Metric) {
  if (metric.field === "netPerformance") return numeric(entry, "cryptoInitialDepositCents") + numeric(entry, "bankInitialDepositCents") + numeric(entry, "cryptoRechargeCents") + numeric(entry, "bankRechargeCents") - numeric(entry, "withdrawalCents");
  return numeric(entry, metric.field);
}
function moneyText(valueCents: number) { return `$${(valueCents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

export default function MemberDataInspector({ member, onClose }: { member: InspectorMember; onClose: () => void }) {
  const [tab, setTab] = useState<"daily" | "history" | "finance">("daily");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(preferredId?: string) {
    setError("");
    try {
      const next = await requestJson<Payload>(`/api/lead/member-daily-stats/${encodeURIComponent(member.id)}`);
      setPayload(next); setSelectedId((current) => preferredId || current || next.entries[0]?.id || "");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "成员数据读取失败"); }
  }
  useEffect(() => { void load(); }, [member.id]);

  const selected = payload?.entries.find((entry) => entry.id === selectedId) ?? null;
  const selectedMetrics = selected ? metricsFor(selected) : [];
  const editableMetrics = selectedMetrics.filter((metric) => metric.editable);
  const selectedMetric = editableMetrics.find((metric) => metric.field === field) ?? editableMetrics[0] ?? null;
  useEffect(() => {
    if (!selected) return;
    const nextMetric = metricsFor(selected).find((metric) => metric.editable);
    setField(nextMetric?.field || ""); setValue(nextMetric ? String(nextMetric.money ? metricValue(selected, nextMetric) / 100 : metricValue(selected, nextMetric)) : ""); setReason("");
  }, [selectedId]);

  function chooseMetric(nextField: string) {
    setField(nextField);
    const nextMetric = editableMetrics.find((metric) => metric.field === nextField);
    setValue(nextMetric && selected ? String(nextMetric.money ? metricValue(selected, nextMetric) / 100 : metricValue(selected, nextMetric)) : "");
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!selected || !selectedMetric) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await requestJson(`/api/lead/member-daily-stats/${encodeURIComponent(member.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ entryId: selected.id, field: selectedMetric.field, value: selectedMetric.money ? Math.round(Number(value) * 100) : Number(value), reason: reason.trim() }) });
      setSuccess(`已更正 ${selected.businessDate} · ${selected.channel.name} · ${selectedMetric.label}，修改记录已经保存。`); setReason(""); await load(selected.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存纠正失败"); } finally { setBusy(false); }
  }
  const financeEntries = useMemo(() => payload?.entries.filter((entry) => entry.position === "EXPERT" || isUnifiedEntry(entry)) ?? [], [payload]);

  return <div className="inspector-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="member-inspector" role="dialog" aria-modal="true" aria-label={`检查 ${member.name} 的数据`}>
      <header><div><h2>成员数据检查 · {member.name}</h2><p>现在读取的是真实数据库；组长只能查看和纠正本组记录，每次修改都会生成新版本。</p></div><button onClick={onClose}>×</button></header>
      <div className="inspector-tabs"><button data-active={tab === "daily"} onClick={() => setTab("daily")}>数据纠正</button><button data-active={tab === "history"} onClick={() => setTab("history")}>历史数据</button><button data-active={tab === "finance"} onClick={() => setTab("finance")}>财务数据</button><span>{payload ? `${payload.group.name} · ${payload.entries.length} 条记录` : "正在读取…"}</span></div>
      {error ? <div className="team-management__notice" style={{ margin: 16 }}><span>!</span>{error}</div> : null}{success ? <div className="team-management__notice" style={{ margin: 16 }}><span>✓</span>{success}</div> : null}
      {tab === "daily" ? <div className="inspector-daily">
        <div className="inspector-data-table"><div className="inspector-record-picker"><label><span>选择具体日期、渠道和数据类型</span><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">请选择记录</option>{payload?.entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.businessDate} · {entry.channel.name} · {positionLabel(entry)}</option>)}</select></label></div>
          {selected ? <><table><thead><tr><th>数据指标</th><th>{selected.businessDate} · {selected.channel.name}</th><th>类型</th></tr></thead><tbody>{selectedMetrics.map((metric) => { const amount = metricValue(selected, metric); return <tr key={metric.field}><td>{metric.label}</td><td><strong>{metric.money ? moneyText(amount) : amount}</strong></td><td><span data-kind={metric.editable ? "input" : "formula"}>{metric.editable ? "成员填写" : "系统计算"}</span></td></tr>; })}</tbody></table><div className="inspector-version-list"><strong>这条记录的修改历史</strong>{selected.revisions.map((revision) => <div key={revision.version}><span>第 {revision.version} 版 · {revision.createdBy?.name || "原填写人"}</span><small>{revision.changeReason || "首次填写"}</small></div>)}</div></> : <div className="inspector-empty">这个成员还没有每日填写记录</div>}
        </div>
        <form className="inspector-correction" onSubmit={submit}><div><h3>纠正一项数据</h3><p>先选准日期和渠道。有效数据、当前在群、净业绩不能直接修改。</p></div><label><span>修改项目</span><select value={selectedMetric?.field || ""} onChange={(event) => chooseMetric(event.target.value)} disabled={!selected}>{editableMetrics.map((metric) => <option key={metric.field} value={metric.field}>{metric.label}</option>)}</select></label><div className="inspector-before-after"><span>修改前<strong>{selected && selectedMetric ? (selectedMetric.money ? moneyText(metricValue(selected, selectedMetric)) : metricValue(selected, selectedMetric)) : "—"}</strong></span><b>→</b><label><small>修改后{selectedMetric?.money ? "（美元）" : ""}</small><input type="number" min="0" step={selectedMetric?.money ? "0.01" : "1"} value={value} onChange={(event) => setValue(event.target.value)} /></label></div><label><span>修改原因</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="至少填写 4 个字，便于以后核对" /></label><button className="fresh-primary" disabled={!selected || busy || reason.trim().length < 4 || Number(value) < 0}>{busy ? "保存中…" : "保存纠正"}</button></form>
      </div> : tab === "history" ? <div className="inspector-simple-table"><table><thead><tr><th>日期</th><th>来源渠道</th><th>数据类型</th><th>添加数据</th><th>有效数据</th><th>进群</th><th>开单</th><th>操作</th></tr></thead><tbody>{payload?.entries.map((entry) => <tr key={entry.id}><td>{entry.businessDate}</td><td>{entry.channel.name}</td><td>{positionLabel(entry)}</td><td>{numeric(entry, "dispatchCount")}</td><td>{numeric(entry, "effectiveCount")}</td><td>{numeric(entry, "joinCount")}</td><td>{numeric(entry, "orderCount")}</td><td><button onClick={() => { setSelectedId(entry.id); setTab("daily"); }}>纠正这条</button></td></tr>)}</tbody></table><p>每一行对应一个确定的日期、渠道和数据类型，不会误改其他日期。</p></div> : <div className="inspector-simple-table"><table><thead><tr><th>日期</th><th>来源渠道</th><th>首充</th><th>续充</th><th>出金</th><th>净业绩</th><th>操作</th></tr></thead><tbody>{financeEntries.map((entry) => { const first = numeric(entry, "cryptoInitialDepositCents") + numeric(entry, "bankInitialDepositCents"); const recharge = numeric(entry, "cryptoRechargeCents") + numeric(entry, "bankRechargeCents"); const withdrawal = numeric(entry, "withdrawalCents"); return <tr key={entry.id}><td>{entry.businessDate}</td><td>{entry.channel.name}</td><td>{moneyText(first)}</td><td>{moneyText(recharge)}</td><td>{moneyText(withdrawal)}</td><td><strong>{moneyText(first + recharge - withdrawal)}</strong></td><td><button onClick={() => { setSelectedId(entry.id); setTab("daily"); }}>纠正明细</button></td></tr>; })}</tbody></table><p>首充、续充和出金按原始明细纠正；净业绩始终由系统重新计算。</p></div>}
    </section>
  </div>;
}
