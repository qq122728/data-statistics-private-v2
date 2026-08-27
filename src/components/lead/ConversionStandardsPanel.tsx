"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GroupConversionStandards, RateBand } from "../../lib/conversion-standards";
import { WorkflowConfirmationDialog, type WorkflowConfirmation } from "../ui/WorkflowConfirmationDialog";

const roles: Array<{ key: keyof GroupConversionStandards; label: string; detail: string }> = [
  { key: "receptionJoin", label: "有效数据入群率", detail: "已入群 ÷ 有效数据" },
  { key: "operatorExpert", label: "第3天推专家率", detail: "已推专家 ÷ 进入第3天的在群客户" },
  { key: "expertOrder", label: "第2天开单率", detail: "已开单 ÷ 接手进入第2天的客户" },
];

export function ConversionStandardsPanel({ initialStandards }: { initialStandards: GroupConversionStandards }) {
  const router = useRouter();
  const [standards, setStandards] = useState(initialStandards);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<WorkflowConfirmation | null>(null);

  function update(role: keyof GroupConversionStandards, field: keyof RateBand, value: string) {
    setStandards((current) => ({ ...current, [role]: { ...current[role], [field]: Number(value) } }));
  }

  async function save(): Promise<boolean> {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/lead/conversion-standards", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ standards }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      setStandards(result.standards);
      setEditing(false);
      setMessage(result.unchanged ? "标准没有变化" : "评级标准已保存");
      router.refresh();
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); return false; }
    finally { setBusy(false); }
  }

  function requestSave() {
    setError("");
    setConfirmation({
      title: "确认保存岗位转化标准？",
      description: "保存后，本组的接粉、炒群、专家评级会按新的及格、良好、优秀标准计算。",
      confirmLabel: "确认保存标准",
      target: "仅当前小组生效",
      onConfirm: async () => { if (await save()) setConfirmation(null); },
    });
  }

  return <section className="panel overflow-hidden">
    <div className="panel-header"><div><h2 className="panel-title">岗位转化评级标准</h2><p className="panel-subtitle">只对本组生效；没有成熟样本时不评级</p></div><button type="button" onClick={() => { setEditing((value) => !value); setMessage(""); setError(""); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">{editing ? "取消设置" : "设置标准"}</button></div>
    {error ? <p role="alert" className="mx-4 mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
    {message ? <p role="status" className="mx-4 mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}
    <div className="data-table-wrap"><table className="data-table"><thead><tr><th>岗位指标</th><th>计算方式</th><th>及格</th><th>良好</th><th>优秀</th></tr></thead><tbody>{roles.map((role) => <tr key={role.key}><td><strong>{role.label}</strong></td><td>{role.detail}</td>{(["pass", "good", "excellent"] as const).map((field) => <td key={field}>{editing ? <label className="inline-flex items-center gap-1"><input aria-label={`${role.label}${field === "pass" ? "及格" : field === "good" ? "良好" : "优秀"}线`} type="number" min="0" max="100" step="1" value={standards[role.key][field]} onChange={(event) => update(role.key, field, event.target.value)} className="control w-20" /><span>%</span></label> : <strong>{standards[role.key][field]}%</strong>}</td>)}</tr>)}</tbody></table></div>
    {editing ? <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-4 py-3"><span className="mr-auto text-xs text-slate-500">必须满足：及格 &lt; 良好 &lt; 优秀</span><button type="button" disabled={busy} onClick={requestSave} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "保存中…" : "保存标准"}</button></div> : null}
    <WorkflowConfirmationDialog confirmation={confirmation} busy={busy} error={confirmation ? error : ""} onClose={() => { if (!busy) { setConfirmation(null); setError(""); } }} />
  </section>;
}
