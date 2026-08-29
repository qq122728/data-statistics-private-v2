"use client";

import { WarningCircle } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { LeadMember } from "./LeadMemberTable";
import { WorkflowConfirmationDialog, type WorkflowConfirmation } from "../ui/WorkflowConfirmationDialog";

type Assignment = { groupOperatorId: string; receptionistId: string };
type HandoffPreview = { receptionistId: string; fromGroupOperatorId: string; toGroupOperatorId: string; count: number };

function hasRole(member: LeadMember, role: "RECEPTION" | "GROUP_OPERATOR") {
  return member.role === role || Boolean(member.roleAssignments?.some((assignment) => assignment.role === role));
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "操作失败，请稍后重试");
  return payload;
}

export function CollaborationSettings({ members }: { members: LeadMember[] }) {
  const operators = useMemo(() => members.filter((member) => member.active && hasRole(member, "GROUP_OPERATOR")), [members]);
  const receptionists = useMemo(() => members.filter((member) => member.active && hasRole(member, "RECEPTION")), [members]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<WorkflowConfirmation | null>(null);
  const [handoffReceptionistId, setHandoffReceptionistId] = useState("");
  const [handoffFromId, setHandoffFromId] = useState("");
  const [handoffToId, setHandoffToId] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<HandoffPreview | null>(null);
  const [quickOperatorId, setQuickOperatorId] = useState("");
  const [quickReceptionistIds, setQuickReceptionistIds] = useState<string[]>([]);

  useEffect(() => {
    void api<{ assignments: Assignment[] }>("/api/lead/collaborations", { cache: "no-store" })
      .then((payload) => {
        setAssignments(payload.assignments);
        setDrafts(Object.fromEntries(receptionists.map((person) => [person.id, payload.assignments.find((item) => item.receptionistId === person.id)?.groupOperatorId ?? ""])));
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "配对关系加载失败，请刷新后重试"));
  }, [receptionists]);

  useEffect(() => {
    if (!receptionists.some((person) => person.id === handoffReceptionistId)) setHandoffReceptionistId(receptionists[0]?.id ?? "");
    if (!operators.some((person) => person.id === handoffFromId)) setHandoffFromId(operators[0]?.id ?? "");
    if (!operators.some((person) => person.id === handoffToId) || handoffToId === handoffFromId) setHandoffToId(operators.find((person) => person.id !== handoffFromId)?.id ?? "");
  }, [handoffFromId, handoffReceptionistId, handoffToId, operators, receptionists]);

  const pending = useMemo(
    () => receptionists.filter((person) => !assignments.some((item) => item.receptionistId === person.id)),
    [assignments, receptionists],
  );

  useEffect(() => {
    if (!operators.some((person) => person.id === quickOperatorId)) setQuickOperatorId(operators[0]?.id ?? "");
    setQuickReceptionistIds((current) => current.filter((id) => pending.some((person) => person.id === id)));
  }, [operators, pending, quickOperatorId]);

  async function quickAssignPending() {
    if (!quickOperatorId || !quickReceptionistIds.length) return;
    setSavingId("quick");
    setNotice("");
    try {
      const alreadyAssignedIds = assignments.filter((item) => item.groupOperatorId === quickOperatorId).map((item) => item.receptionistId);
      await api("/api/lead/collaborations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupOperatorId: quickOperatorId, receptionistIds: [...new Set([...alreadyAssignedIds, ...quickReceptionistIds])] }),
      });
      setAssignments((current) => [
        ...current.filter((item) => !quickReceptionistIds.includes(item.receptionistId)),
        ...quickReceptionistIds.map((receptionistId) => ({ receptionistId, groupOperatorId: quickOperatorId })),
      ]);
      setDrafts((current) => ({ ...current, ...Object.fromEntries(quickReceptionistIds.map((id) => [id, quickOperatorId])) }));
      const operator = operators.find((person) => person.id === quickOperatorId);
      setNotice(`已把 ${quickReceptionistIds.length} 名待配对接粉员交给 ${operator?.name ?? "所选炒群员"}。已有在办客户没有自动换人。`);
      setQuickReceptionistIds([]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "批量配对失败，请逐个重试");
    } finally {
      setSavingId("");
    }
  }

  async function savePairing(receptionist: LeadMember) {
    const groupOperatorId = drafts[receptionist.id] || null;
    setSavingId(receptionist.id);
    setNotice("");
    try {
      await api("/api/lead/collaborations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receptionistId: receptionist.id, groupOperatorId }),
      });
      setAssignments((current) => [
        ...current.filter((item) => item.receptionistId !== receptionist.id),
        ...(groupOperatorId ? [{ receptionistId: receptionist.id, groupOperatorId }] : []),
      ]);
      const operator = operators.find((person) => person.id === groupOperatorId);
      setNotice(groupOperatorId
        ? `已保存：${receptionist.name} → ${operator?.id === receptionist.id ? "兼任·本人承接" : operator?.name ?? "炒群员"}。已有在办客户没有自动换人。`
        : `已将 ${receptionist.name} 保存为“待配对”。新入群客户不会自动分给炒群员。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败，请稍后重试");
    } finally {
      setSavingId("");
    }
  }

  function resetPreview() {
    setPreview(null);
    setConfirmation(null);
  }

  async function previewHandoff() {
    if (!handoffReceptionistId || !handoffFromId || !handoffToId || handoffFromId === handoffToId) return;
    setPreviewing(true);
    setNotice("");
    try {
      const result = await api<{ count: number }>("/api/lead/collaborations/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "preview", receptionistId: handoffReceptionistId, fromGroupOperatorId: handoffFromId, toGroupOperatorId: handoffToId }),
      });
      setPreview({ receptionistId: handoffReceptionistId, fromGroupOperatorId: handoffFromId, toGroupOperatorId: handoffToId, count: result.count });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "交接数量预览失败");
    } finally {
      setPreviewing(false);
    }
  }

  function requestHandoff() {
    if (!preview) return;
    const receptionist = receptionists.find((person) => person.id === preview.receptionistId);
    const from = operators.find((person) => person.id === preview.fromGroupOperatorId);
    const to = operators.find((person) => person.id === preview.toGroupOperatorId);
    setConfirmation({
      title: "确认交接在办客户？",
      description: `刚刚预览到 ${preview.count} 位仍在炒群阶段的客户。只有确认后才会从“${from?.name ?? "原炒群员"}”转给“${to?.name ?? "新炒群员"}”。`,
      confirmLabel: `确认交接 ${preview.count} 位`,
      target: `${receptionist?.name ?? "接粉员"} · ${from?.name ?? "原负责人"} → ${to?.name ?? "新负责人"}`,
      reasonLabel: "交接原因",
      reasonPlaceholder: "例如：配对调整后交接在办客户",
      onConfirm: async (reason) => {
        setPreviewing(true);
        try {
          const result = await api<{ transferredCount: number }>("/api/lead/collaborations/handoff", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "confirm",
              receptionistId: preview.receptionistId,
              fromGroupOperatorId: preview.fromGroupOperatorId,
              toGroupOperatorId: preview.toGroupOperatorId,
              expectedCount: preview.count,
              reason,
            }),
          });
          setNotice(`已确认交接 ${result.transferredCount} 位在办客户。`);
          setPreview(null);
          setConfirmation(null);
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "交接失败，请重新预览");
          setConfirmation(null);
          setPreview(null);
        } finally {
          setPreviewing(false);
        }
      },
    });
  }

  return <section className="mt-6 space-y-5 rounded-lg border border-slate-200 bg-white p-5">
    <div><h2 className="m-0 text-base font-bold text-slate-900">接粉与炒群配对</h2><p className="mt-1 text-sm leading-6 text-slate-500">按接粉员逐个选择主要炒群员。没有炒群账号时可以保存为“待配对”；换配对只影响以后分配，不会偷偷转走已有客户。</p></div>

    {pending.length ? <div role="alert" className="flex gap-3 rounded-lg border-2 border-amber-300 bg-amber-50 px-4 py-3 text-amber-950"><WarningCircle className="mt-0.5 shrink-0" size={22} weight="fill" /><div><p className="font-bold">有 {pending.length} 名接粉员待配对</p><p className="mt-1 text-sm">{pending.map((person) => person.name).join("、")}。待配对期间，新入群客户不会自动分给任何炒群员。</p></div></div> : <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">本组接粉员都已完成配对。</p>}

    {pending.length && operators.length ? <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-4"><h3 className="font-bold text-blue-950">新炒群账号建好后，快速认领待配对接粉</h3><p className="mt-1 text-sm text-blue-800">选择炒群员，再勾选要交给他的接粉员；可以一次勾选多人。</p><label className="mt-3 block text-sm font-semibold text-slate-700">炒群员<select value={quickOperatorId} onChange={(event) => setQuickOperatorId(event.target.value)} className="mt-1.5 w-full max-w-sm rounded-md border border-slate-300 bg-white px-3 py-2">{operators.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><div className="mt-3 flex flex-wrap gap-2">{pending.map((person) => <label key={person.id} className="flex items-center gap-2 rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={quickReceptionistIds.includes(person.id)} onChange={(event) => setQuickReceptionistIds((current) => event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id))} />{person.name}{person.id === quickOperatorId && hasRole(person, "GROUP_OPERATOR") ? "（兼任·本人承接）" : ""}</label>)}</div><button type="button" disabled={savingId === "quick" || !quickReceptionistIds.length} onClick={() => void quickAssignPending()} className="mt-3 rounded bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{savingId === "quick" ? "保存中…" : `保存已勾选的 ${quickReceptionistIds.length} 人`}</button></div> : null}

    {!receptionists.length ? <p className="rounded bg-slate-50 px-3 py-3 text-sm text-slate-600">本组还没有启用中的接粉员。</p> : <div className="grid gap-3 lg:grid-cols-2">{receptionists.map((receptionist) => {
      const currentId = assignments.find((item) => item.receptionistId === receptionist.id)?.groupOperatorId ?? "";
      const draft = drafts[receptionist.id] ?? currentId;
      const selfOperated = draft === receptionist.id && hasRole(receptionist, "GROUP_OPERATOR");
      return <article key={receptionist.id} className={`rounded-lg border p-4 ${currentId ? "border-slate-200" : "border-amber-300 bg-amber-50/50"}`}>
        <div><h3 className="font-bold text-slate-900">{receptionist.name}</h3><p className={`mt-1 text-xs font-semibold ${currentId ? "text-slate-500" : "text-amber-800"}`}>{currentId ? (currentId === receptionist.id ? "兼任·本人承接" : "已配对") : "⚠ 待配对"}</p></div>
        <label className="mt-3 block text-sm font-semibold text-slate-700">主要炒群员<select value={draft} onChange={(event) => setDrafts((current) => ({ ...current, [receptionist.id]: event.target.value }))} className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2"><option value="">待配对（不自动分配）</option>{operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.id === receptionist.id ? `${operator.name}（兼任·本人承接）` : operator.name}</option>)}</select></label>
        {selfOperated ? <p className="mt-2 rounded bg-blue-50 px-2.5 py-2 text-xs text-blue-800">此人同时做接粉和炒群，由本人承接自己的新入群客户。</p> : null}
        {!operators.length ? <p className="mt-2 text-xs font-semibold text-amber-800">还没有炒群账号，请先保存为待配对；创建炒群账号后，这里会立即出现可选人员。</p> : null}
        <button type="button" disabled={savingId === receptionist.id || draft === currentId} onClick={() => void savePairing(receptionist)} className="mt-3 min-h-9 rounded bg-blue-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{savingId === receptionist.id ? "保存中…" : draft ? "保存配对" : "保存为待配对"}</button>
      </article>;
    })}</div>}

    <div className="border-t border-slate-200 pt-5">
      <h3 className="font-bold text-slate-900">在办客户交接（单独确认）</h3><p className="mt-1 text-sm text-slate-500">先选接粉员、新旧炒群负责人并预览。系统显示准确数量后，才会出现最终确认按钮。</p>
      {operators.length >= 2 && receptionists.length ? <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="text-sm font-semibold text-slate-700">接粉员<select value={handoffReceptionistId} onChange={(event) => { setHandoffReceptionistId(event.target.value); resetPreview(); }} className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2">{receptionists.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">原炒群负责人<select value={handoffFromId} onChange={(event) => { setHandoffFromId(event.target.value); resetPreview(); }} className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2">{operators.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">新炒群负责人<select value={handoffToId} onChange={(event) => { setHandoffToId(event.target.value); resetPreview(); }} className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2">{operators.filter((person) => person.id !== handoffFromId).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      </div> : <p className="mt-3 rounded bg-slate-50 px-3 py-2 text-sm text-slate-600">至少需要 1 名接粉员和 2 名炒群员，才能在两位炒群负责人之间交接客户。</p>}
      {operators.length >= 2 && receptionists.length ? <button type="button" disabled={previewing || !handoffToId || handoffFromId === handoffToId} onClick={() => void previewHandoff()} className="mt-3 min-h-9 rounded border border-blue-300 bg-white px-4 text-sm font-semibold text-blue-700 disabled:opacity-50">{previewing ? "正在预览…" : "先预览在办客户数量"}</button> : null}
      {preview ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-amber-300 bg-amber-50 px-4 py-3"><div><p className="font-bold text-amber-950">预览结果：将交接 {preview.count} 位在办客户</p><p className="mt-1 text-xs text-amber-800">若数量在确认前变化，系统会拒绝并要求重新预览。</p></div><button type="button" disabled={previewing} onClick={requestHandoff} className="rounded bg-amber-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">确认前再核对</button></div> : null}
    </div>

    {notice ? <p role="status" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{notice}</p> : null}
    <WorkflowConfirmationDialog confirmation={confirmation} busy={previewing} onClose={() => { if (!previewing) setConfirmation(null); }} />
  </section>;
}
