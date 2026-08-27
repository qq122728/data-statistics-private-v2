"use client";

import { useMemo, useState } from "react";
import { WorkflowConfirmationDialog, type WorkflowConfirmation } from "../ui/WorkflowConfirmationDialog";

export type DeviceAccountRow = {
  id: string;
  ownerId: string;
  ownerName: string;
  groupName: string;
  ownerRole: "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
  accountType: "NORMAL_WS" | "BUSINESS_WS" | "RCS";
  provider: string;
  accountNumber: string;
  renewalDate: string | null;
  purpose: string | null;
  situation: string | null;
  phoneCode: string | null;
  followUp: string | null;
  updatedAt: string;
};

type OwnerOption = {
  id: string;
  name: string;
  role: "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
};

type Draft = {
  ownerId: string;
  accountType: DeviceAccountRow["accountType"];
  provider: string;
  accountNumber: string;
  renewalDate: string;
  purpose: string;
  situation: string;
  phoneCode: string;
  followUp: string;
};

const typeNames = {
  NORMAL_WS: "普通 WS",
  BUSINESS_WS: "商业 WS",
  RCS: "RCS",
} as const;

const roleNames = {
  LEAD: "组长",
  RECEPTION: "前台接粉",
  GROUP_OPERATOR: "前台炒群",
  EXPERT: "前台专家",
} as const;

function emptyDraft(ownerId: string): Draft {
  return {
    ownerId,
    accountType: "NORMAL_WS",
    provider: "",
    accountNumber: "",
    renewalDate: "",
    purpose: "",
    situation: "",
    phoneCode: "",
    followUp: "",
  };
}

function draftFrom(account: DeviceAccountRow): Draft {
  return {
    ownerId: account.ownerId,
    accountType: account.accountType,
    provider: account.provider,
    accountNumber: account.accountNumber,
    renewalDate: account.renewalDate ?? "",
    purpose: account.purpose ?? "",
    situation: account.situation ?? "",
    phoneCode: account.phoneCode ?? "",
    followUp: account.followUp ?? "",
  };
}

function renewalState(date: string | null) {
  if (!date) return { label: "未设置", tone: "neutral" as const, days: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${date}T00:00:00`);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { label: `已过期 ${Math.abs(days)} 天`, tone: "danger" as const, days };
  if (days === 0) return { label: "今天续费", tone: "danger" as const, days };
  if (days <= 7) return { label: `${days} 天后续费`, tone: "warning" as const, days };
  if (days <= 30) return { label: `${days} 天后续费`, tone: "info" as const, days };
  return { label: date, tone: "neutral" as const, days };
}

function sortRows(rows: DeviceAccountRow[]) {
  return [...rows].sort((left, right) => {
    if (!left.renewalDate && right.renewalDate) return 1;
    if (left.renewalDate && !right.renewalDate) return -1;
    return (left.renewalDate ?? "").localeCompare(right.renewalDate ?? "") ||
      right.updatedAt.localeCompare(left.updatedAt);
  });
}

export function DeviceAccountManager({
  initialAccounts,
  owners,
  currentUserId,
  canManageGroup,
  readOnly = false,
}: {
  initialAccounts: DeviceAccountRow[];
  owners: OwnerOption[];
  currentUserId: string;
  canManageGroup: boolean;
  readOnly?: boolean;
}) {
  const [accounts, setAccounts] = useState(() => sortRows(initialAccounts));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState(() => emptyDraft(currentUserId));
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<WorkflowConfirmation | null>(null);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return accounts.filter((account) => {
      const haystack = [
        account.provider,
        account.accountNumber,
        account.purpose,
        account.situation,
        account.phoneCode,
        account.followUp,
        account.ownerName,
      ].join(" ").toLowerCase();
      return (!keyword || haystack.includes(keyword)) &&
        (!typeFilter || account.accountType === typeFilter) &&
        (!ownerFilter || account.ownerId === ownerFilter);
    });
  }, [accounts, ownerFilter, search, typeFilter]);

  const renewalSummary = useMemo(() => {
    const states = accounts.map((account) => renewalState(account.renewalDate));
    return {
      overdue: states.filter((state) => state.days !== null && state.days < 0).length,
      soon: states.filter((state) => state.days !== null && state.days >= 0 && state.days <= 30).length,
    };
  }, [accounts]);
  const showOwner = canManageGroup || readOnly;

  function beginCreate() {
    setEditingId(null);
    setDraft(emptyDraft(currentUserId));
    setEditorOpen(true);
    setError("");
    setNotice("");
  }

  function beginEdit(account: DeviceAccountRow) {
    setEditingId(account.id);
    setDraft(draftFrom(account));
    setEditorOpen(true);
    setError("");
    setNotice("");
  }

  async function save(): Promise<boolean> {
    if (!draft.provider.trim() || !draft.accountNumber.trim()) {
      setError("请填写号商和号码");
      return false;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/device-accounts", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editingId ? { id: editingId } : {}),
          ...draft,
          renewalDate: draft.renewalDate || null,
          purpose: draft.purpose || null,
          situation: draft.situation || null,
          phoneCode: draft.phoneCode || null,
          followUp: draft.followUp || null,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      const saved = result.account as DeviceAccountRow;
      setAccounts((rows) => sortRows(
        editingId
          ? rows.map((row) => row.id === saved.id ? saved : row)
          : [saved, ...rows],
      ));
      setEditorOpen(false);
      setEditingId(null);
      setNotice(editingId ? "设备账号已更新" : "设备账号已添加");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function requestSave() {
    if (!draft.provider.trim() || !draft.accountNumber.trim()) {
      setError("请填写号商和号码");
      return;
    }
    setConfirmation({
      title: editingId ? "确认保存设备账号修改？" : "确认添加设备账号？",
      description: "确认后才会保存设备账号及其归属资料。",
      confirmLabel: editingId ? "确认保存" : "确认添加",
      target: `${draft.provider.trim()} · ${draft.accountNumber.trim()}`,
      onConfirm: async () => { if (await save()) setConfirmation(null); },
    });
  }

  async function remove(account: DeviceAccountRow): Promise<boolean> {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/device-accounts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: account.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "删除失败");
      setAccounts((rows) => rows.filter((row) => row.id !== account.id));
      setNotice("设备账号已删除");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function requestRemove(account: DeviceAccountRow) {
    setError("");
    setConfirmation({
      title: "确认删除设备账号？",
      description: "删除后该设备账号不会再出现在本组设备列表中。",
      confirmLabel: "确认删除",
      target: `${account.ownerName} · ${account.accountNumber}`,
      tone: "danger",
      onConfirm: async () => { if (await remove(account)) setConfirmation(null); },
    });
  }

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex flex-wrap items-center gap-5 text-sm">
          <span><strong className="text-lg text-slate-900">{accounts.length}</strong> 个账号</span>
          <span className="text-amber-700">30 天内续费 <strong>{renewalSummary.soon}</strong></span>
          <span className="text-red-700">已过期 <strong>{renewalSummary.overdue}</strong></span>
        </div>
        {!readOnly && <button type="button" onClick={beginCreate} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
          ＋ 新增设备账号
        </button>}
      </div>

      {editorOpen && (
        <div className="border-b border-blue-100 bg-blue-50/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="m-0 text-sm font-bold text-slate-900">{editingId ? "编辑设备账号" : "新增设备账号"}</h2>
            <button type="button" onClick={() => setEditorOpen(false)} className="text-sm text-slate-500">取消</button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {canManageGroup && (
              <label className="text-xs font-semibold text-slate-600">归属人员
                <select value={draft.ownerId} onChange={(event) => setDraft((row) => ({ ...row, ownerId: event.target.value }))} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
                  {owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name} · {roleNames[owner.role]}</option>)}
                </select>
              </label>
            )}
            <label className="text-xs font-semibold text-slate-600">账号类型
              <select value={draft.accountType} onChange={(event) => setDraft((row) => ({ ...row, accountType: event.target.value as Draft["accountType"] }))} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
                {Object.entries(typeNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">号商
              <input value={draft.provider} onChange={(event) => setDraft((row) => ({ ...row, provider: event.target.value }))} placeholder="例如：某某号商" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-semibold text-slate-600">号码
              <input value={draft.accountNumber} onChange={(event) => setDraft((row) => ({ ...row, accountNumber: event.target.value }))} placeholder="账号号码" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-semibold text-slate-600">续费日期
              <input type="date" value={draft.renewalDate} onChange={(event) => setDraft((row) => ({ ...row, renewalDate: event.target.value }))} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-semibold text-slate-600">用途
              <input value={draft.purpose} onChange={(event) => setDraft((row) => ({ ...row, purpose: event.target.value }))} placeholder="例如：接粉、炒群" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-semibold text-slate-600">情况
              <input value={draft.situation} onChange={(event) => setDraft((row) => ({ ...row, situation: event.target.value }))} placeholder="正常、停用、待续费等" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-semibold text-slate-600">手机编号
              <input value={draft.phoneCode} onChange={(event) => setDraft((row) => ({ ...row, phoneCode: event.target.value }))} placeholder="例如：手机 01" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-semibold text-slate-600 md:col-span-2 xl:col-span-4">跟进
              <textarea value={draft.followUp} onChange={(event) => setDraft((row) => ({ ...row, followUp: event.target.value }))} rows={2} placeholder="记录下一步处理和最近跟进情况" className="mt-1 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setEditorOpen(false)} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600">取消</button>
            <button type="button" disabled={busy} onClick={requestSave} className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "保存中…" : "保存"}</button>
          </div>
        </div>
      )}

      {(notice || error) && <p className={`m-3 rounded-md px-3 py-2 text-sm ${error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{error || notice}</p>}

      <div className="flex flex-wrap gap-2 border-b border-slate-100 bg-slate-50/70 p-3">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索号商、号码、手机编号或跟进" className="min-w-64 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">全部类型</option>
          {Object.entries(typeNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {showOwner && (
          <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="">全部人员</option>
            {owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
          </select>
        )}
      </div>

      <div className="data-table-wrap">
        <table className="data-table min-w-[1400px]">
          <thead><tr>
            {showOwner && <th>小组 / 归属人员</th>}
            <th>账号类型</th><th>号商</th><th>号码</th><th>续费日期</th><th>用途</th><th>情况</th><th>手机编号</th><th>跟进</th><th>操作</th>
          </tr></thead>
          <tbody>
            {filtered.map((account) => {
              const renewal = renewalState(account.renewalDate);
              return <tr key={account.id}>
                {showOwner && <td><strong>{account.groupName} · {account.ownerName}</strong><span className="mt-1 block text-xs text-slate-400">{roleNames[account.ownerRole]}</span></td>}
                <td><span className="analysis-status" data-tone="neutral">{typeNames[account.accountType]}</span></td>
                <td>{account.provider}</td>
                <td className="font-semibold">{account.accountNumber}</td>
                <td><span className="analysis-status" data-tone={renewal.tone}>{renewal.label}</span>{account.renewalDate && renewal.label !== account.renewalDate && <span className="mt-1 block text-xs text-slate-400">{account.renewalDate}</span>}</td>
                <td>{account.purpose ?? "—"}</td>
                <td>{account.situation ?? "—"}</td>
                <td>{account.phoneCode ?? "—"}</td>
                <td className="max-w-72 whitespace-normal text-slate-600">{account.followUp ?? "—"}</td>
                <td>{readOnly ? <span className="text-slate-400">只读</span> : <div className="flex gap-3"><button type="button" onClick={() => beginEdit(account)} className="font-semibold text-blue-600">编辑</button><button type="button" disabled={busy} onClick={() => requestRemove(account)} className="font-semibold text-red-600 disabled:opacity-50">删除</button></div>}</td>
              </tr>;
            })}
            {!filtered.length && <tr><td colSpan={showOwner ? 10 : 9} className="empty-state">没有符合条件的设备账号。</td></tr>}
          </tbody>
        </table>
      </div>
      <WorkflowConfirmationDialog confirmation={confirmation} busy={busy} error={confirmation ? error : ""} onClose={() => { if (!busy) { setConfirmation(null); setError(""); } }} />
    </section>
  );
}
