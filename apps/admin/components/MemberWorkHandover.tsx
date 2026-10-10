"use client";

import { useState } from "react";
import { requestJson } from "@/lib/backend";
import type { Member } from "@/lib/member-metadata";

type Counts = { reception: number; operator: number; expert: number; physicalDevices: number; deviceAccounts: number };
type Preview = { snapshot: string; transferred: Counts };
const customerCount = (c: Counts) => c.reception + c.operator + c.expert;

/** 同组工作交接使用当前客户表；人员调岗由 PersonnelTransferPanel 处理。 */
export function MemberWorkHandover({ members, lead, onComplete, onToast }: {
  members: Member[];
  lead: { id: string; name: string };
  onComplete: () => Promise<void>;
  onToast: (message: string, tone?: "ok" | "warn") => void;
}) {
  const [draft, setDraft] = useState({ sourceId: "", targetId: "", reason: "" });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function change(values: Partial<typeof draft>) {
    setDraft(current => ({ ...current, ...values }));
    setPreview(null);
    setError("");
  }
  async function run(mode: "preview" | "confirm") {
    setBusy(true);
    setError("");
    try {
      const result = await requestJson<Preview>("/api/lead/members/handover", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, reason: draft.reason.trim(), mode, ...(mode === "confirm" ? { expectedSnapshot: preview?.snapshot } : {}) }),
      });
      if (mode === "preview") setPreview(result);
      else {
        onToast(`交接完成：${customerCount(result.transferred)} 位在办客户、${result.transferred.physicalDevices} 台设备、${result.transferred.deviceAccounts} 个设备账号。历史业绩保留原归属。`);
        setPreview(null);
        setDraft({ sourceId: "", targetId: "", reason: "" });
        await onComplete();
      }
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof Error ? caught.message : "交接失败，请重新预览");
    } finally { setBusy(false); }
  }
  const targets = [...members.filter(m => m.active), lead].filter(m => m.id !== draft.sourceId);
  return <section className="card" style={{ padding: 16 }} aria-label="在办客户交接">
    <h2 className="card-title">在办客户交接</h2>
    <p className="card-note">将原负责人当前接粉、炒群、专家阶段的在办客户及设备一起交给同组接收人。已结束客户保留，历史业绩仍归原接粉。</p>
    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: "14px 0", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
      <label><span className="label">原负责人</span><select className="field" aria-label="原负责人" style={{ width: "100%" }} value={draft.sourceId} onChange={e => change({ sourceId: e.target.value, targetId: "" })}><option value="">选择原负责人</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}{m.active ? "" : "（已停用）"}</option>)}</select></label>
      <label><span className="label">接收人</span><select className="field" aria-label="接收人" style={{ width: "100%" }} value={draft.targetId} onChange={e => change({ targetId: e.target.value })}><option value="">选择同组接收人</option>{targets.map(m => <option key={m.id} value={m.id}>{m.name}{m.id === lead.id ? "（组长）" : ""}</option>)}</select></label>
      <label><span className="label">交接原因</span><input className="field" aria-label="交接原因" style={{ width: "100%" }} value={draft.reason} maxLength={500} placeholder="至少填写 4 个字" onChange={e => change({ reason: e.target.value })} /></label>
    </fieldset>
    {error ? <p role="alert" style={{ color: "var(--bad)" }}>{error}</p> : null}
    <button className="btn" disabled={busy || !draft.sourceId || !draft.targetId || draft.reason.trim().length < 4} onClick={() => void run("preview")}>{busy ? "正在处理…" : "预览交接数量"}</button>
    {preview ? <div role="status" style={{ marginTop: 14, padding: 14, background: "var(--warn-soft)", borderRadius: 10 }}>
      <strong>将交接 {customerCount(preview.transferred)} 位在办客户</strong>
      <p>接粉 {preview.transferred.reception} 位 · 炒群 {preview.transferred.operator} 位 · 专家 {preview.transferred.expert} 位</p>
      <p>设备 {preview.transferred.physicalDevices} 台 · 设备账号 {preview.transferred.deviceAccounts} 个</p>
      <button className="btn" data-variant="primary" data-confirm-action="交接在办客户和设备" data-confirm-target={`${members.find(m => m.id === draft.sourceId)?.name} → ${targets.find(m => m.id === draft.targetId)?.name}：${customerCount(preview.transferred)} 位客户、${preview.transferred.physicalDevices} 台设备、${preview.transferred.deviceAccounts} 个设备账号`} data-confirm-description="交接后由接收人继续处理；客户原接粉统计归属不变。" disabled={busy} onClick={() => void run("confirm")}>确认交接</button>
    </div> : null}
  </section>;
}
