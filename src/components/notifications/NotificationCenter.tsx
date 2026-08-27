"use client";

import { Bell, CheckCircle, Megaphone, PaperPlaneTilt } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { WorkflowConfirmationDialog, type WorkflowConfirmation } from "../ui/WorkflowConfirmationDialog";

type ScopeGroup = { id: string; name: string; department: { id: string; name: string } };
type ScopeUser = { id: string; name: string; role: string; groupId: string | null; departmentId: string | null };
type Item = { id: string; readAt: string | Date | null; acknowledgedAt: string | Date | null; notification: { id: string; title: string; content: string; type: "GENERAL" | "IMPORTANT" | "REWARD" | "REMINDER"; requiresAck: boolean; createdAt: string | Date; expiresAt: string | Date | null; sender: { name: string; role: string } } };

const roleNames: Record<string, string> = { LEAD: "组长", RECEPTION: "前台接粉", GROUP_OPERATOR: "前台炒群", EXPERT: "前台专家", COMPANY_MANAGER: "公司管理员", ADMIN: "总公司管理员", RESOURCE_MANAGER: "资源部管理员" };
const typeNames = { GENERAL: "普通通知", IMPORTANT: "重要通知", REWARD: "奖励表扬", REMINDER: "工作提醒" } as const;
const typeStyle = { GENERAL: "bg-slate-100 text-slate-700", IMPORTANT: "bg-red-50 text-red-700", REWARD: "bg-amber-50 text-amber-800", REMINDER: "bg-blue-50 text-blue-700" } as const;

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export function NotificationCenter({
  canSend, actorRole, items: initialItems, groups, users, departments,
}: {
  canSend: boolean;
  actorRole: string;
  items: Item[];
  groups: ScopeGroup[];
  users: ScopeUser[];
  departments: { id: string; name: string }[];
}) {
  const [items, setItems] = useState(initialItems);
  const [mode, setMode] = useState<"ALL" | "UNREAD">("ALL");
  const [targetType, setTargetType] = useState<"ALL" | "GROUP" | "ROLE" | "USERS">("ALL");
  const [departmentId, setDepartmentId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [role, setRole] = useState("RECEPTION");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState<Item["notification"]["type"]>("GENERAL");
  const [requiresAck, setRequiresAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<WorkflowConfirmation | null>(null);
  const visibleItems = useMemo(() => mode === "UNREAD" ? items.filter((item) => !item.readAt) : items, [items, mode]);
  const availableUsers = useMemo(() => departmentId && actorRole === "ADMIN"
    ? users.filter((user) => user.departmentId === departmentId || groups.some((group) => group.id === user.groupId && group.department.id === departmentId))
    : users, [actorRole, departmentId, groups, users]);

  function toggleUser(id: string) {
    setSelectedUserIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }
  async function submit() {
    setSubmitting(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, content, type, requiresAck, targetType, departmentId: departmentId || undefined, groupId: groupId || undefined, role: targetType === "ROLE" ? role : undefined, userIds: targetType === "USERS" ? selectedUserIds : undefined }) });
      const data = await response.json() as { error?: string; recipientCount?: number };
      if (!response.ok) { setError(data.error ?? "发送失败，请稍后再试"); return; }
      setTitle(""); setContent(""); setSelectedUserIds([]); setRequiresAck(false);
      setMessage(`已发送给 ${data.recipientCount ?? 0} 人。`);
      setConfirmation(null);
    } catch { setError("网络连接失败，暂时无法发送通知"); }
    finally { setSubmitting(false); }
  }
  function requestSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !content.trim()) { setError("请填写通知标题和内容"); return; }
    if (targetType === "GROUP" && !groupId) { setError("请选择接收小组"); return; }
    if (targetType === "USERS" && !selectedUserIds.length) { setError("请至少选择一位接收人"); return; }
    setError("");
    setConfirmation({ title: "确认发布通知？", description: "发布后会立即出现在接收人的通知中心。重要通知可要求员工确认已阅读。", target: `${typeNames[type]} · ${title.trim()}`, confirmLabel: "确认发送", onConfirm: submit });
  }
  async function mark(item: Item, action: "READ" | "ACKNOWLEDGE") {
    try {
      const response = await fetch(`/api/notifications/${item.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      if (!response.ok) return;
      const now = new Date();
      setItems((current) => current.map((value) => value.id === item.id ? { ...value, readAt: now, acknowledgedAt: action === "ACKNOWLEDGE" ? now : value.acknowledgedAt } : value));
    } catch { /* 保持原状态，用户可再次点击 */ }
  }

  return <main className="page-shell workflow-wide-page space-y-3">
    <div className="page-heading"><div><h1 className="page-title">通知中心</h1><p className="page-description">查看工作通知；总公司、公司管理员和组长可向自己权限范围内的人员发布通知。</p></div></div>
    {canSend ? <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3"><Megaphone size={19} className="text-blue-600" /><div><h2 className="m-0 text-base font-bold text-slate-900">发布通知</h2><p className="m-0 mt-0.5 text-xs text-slate-500">只能发送给你管理范围内的公司、小组、岗位或人员。</p></div></div><form onSubmit={requestSubmit} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]"><label className="field-label">通知标题<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="例如：本周开单奖励规则" className="control mt-1 w-full" /></label><label className="field-label">通知内容<textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={2000} placeholder="请清楚说明奖励、要求或截止时间" className="control mt-1 min-h-20 w-full resize-y" /></label><div className="flex flex-wrap items-end gap-2 lg:col-span-2"><label className="field-label">类型<select value={type} onChange={(event) => setType(event.target.value as typeof type)} className="control mt-1"><option value="GENERAL">普通通知</option><option value="IMPORTANT">重要通知</option><option value="REWARD">奖励表扬</option><option value="REMINDER">工作提醒</option></select></label><label className="field-label">发送方式<select value={targetType} onChange={(event) => { setTargetType(event.target.value as typeof targetType); setSelectedUserIds([]); }} className="control mt-1"><option value="ALL">全部范围</option><option value="GROUP">指定小组</option><option value="ROLE">指定岗位</option><option value="USERS">指定人员</option></select></label>{actorRole === "ADMIN" && targetType === "ALL" ? <label className="field-label">下属公司（可选）<select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="control mt-1"><option value="">全部公司</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label> : null}{targetType === "GROUP" ? <label className="field-label">接收小组<select value={groupId} onChange={(event) => setGroupId(event.target.value)} className="control mt-1"><option value="">请选择小组</option>{groups.map((group) => <option key={group.id} value={group.id}>{actorRole === "ADMIN" ? `${group.department.name} / ` : ""}{group.name}</option>)}</select></label> : null}{targetType === "ROLE" ? <label className="field-label">接收岗位<select value={role} onChange={(event) => setRole(event.target.value)} className="control mt-1"><option value="RECEPTION">前台接粉</option><option value="GROUP_OPERATOR">前台炒群</option><option value="EXPERT">前台专家</option><option value="LEAD">组长</option></select></label> : null}{type === "IMPORTANT" ? <label className="mb-1 inline-flex min-h-10 items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={requiresAck} onChange={(event) => setRequiresAck(event.target.checked)} />要求点击“已知晓”</label> : null}<button type="submit" disabled={submitting} className="notification-send-button"><PaperPlaneTilt size={19} weight="bold" />{submitting ? "发送中…" : "发送通知"}</button></div>{targetType === "USERS" ? <div className="lg:col-span-2"><p className="field-label mb-1">选择接收人（已选 {selectedUserIds.length} 人）</p><div className="grid max-h-40 grid-cols-2 gap-1 overflow-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-3 lg:grid-cols-5">{availableUsers.map((user) => <label key={user.id} className="flex items-center gap-1.5 rounded px-1 py-1 text-sm hover:bg-slate-50"><input type="checkbox" checked={selectedUserIds.includes(user.id)} onChange={() => toggleUser(user.id)} />{user.name}<span className="text-xs text-slate-400">{roleNames[user.role]}</span></label>)}</div></div> : null}</form></section> : null}
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3"><div><h2 className="m-0 text-base font-bold text-slate-900">我的通知</h2><p className="m-0 mt-0.5 text-xs text-slate-500">重要通知需要确认后才会标记为已知晓。</p></div><div className="flex gap-1"><button onClick={() => setMode("ALL")} className={mode === "ALL" ? "filter-button active" : "filter-button"}>全部</button><button onClick={() => setMode("UNREAD")} className={mode === "UNREAD" ? "filter-button active" : "filter-button"}>未读 {items.filter((item) => !item.readAt).length}</button></div></div><div className="divide-y divide-slate-100">{visibleItems.map((item) => <article key={item.id} className={!item.readAt ? "bg-blue-50/40 px-4 py-3" : "px-4 py-3"}><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="flex flex-wrap items-center gap-2"><h3 className="m-0 text-sm font-bold text-slate-900">{item.notification.title}</h3><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${typeStyle[item.notification.type]}`}>{typeNames[item.notification.type]}</span>{!item.readAt ? <span className="text-xs font-semibold text-blue-700">未读</span> : null}</div><p className="mb-0 mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.notification.content}</p><p className="mb-0 mt-1 text-xs text-slate-500">{item.notification.sender.name} · {formatDate(item.notification.createdAt)}</p></div><div className="flex shrink-0 gap-2">{item.notification.requiresAck && !item.acknowledgedAt ? <button onClick={() => mark(item, "ACKNOWLEDGE")} className="button-primary min-h-9 text-xs"><CheckCircle size={15} />我已知晓</button> : !item.readAt ? <button onClick={() => mark(item, "READ")} className="button-secondary min-h-9 text-xs">标为已读</button> : null}</div></div></article>)}{!visibleItems.length ? <p className="empty-state">{mode === "UNREAD" ? "没有未读通知" : "暂无通知"}</p> : null}</div></section>
    {message ? <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p> : null}{error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
    <WorkflowConfirmationDialog confirmation={confirmation} busy={submitting} error={error} onClose={() => { if (!submitting) setConfirmation(null); }} />
  </main>;
}
