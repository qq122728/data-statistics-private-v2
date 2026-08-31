"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { requestJson } from "@/lib/backend";
import styles from "./UnifiedNotificationCenter.module.css";

type NotificationType = "GENERAL" | "IMPORTANT" | "REWARD" | "REMINDER";
type TargetType = "ALL" | "GROUP" | "ROLE" | "USERS";
type Item = {
  id: string; readAt: string | null; acknowledgedAt: string | null;
  notification: { id: string; title: string; content: string; type: NotificationType; requiresAck: boolean; createdAt: string; expiresAt: string | null; sender: { name: string; role: string } };
};
type SendScope = {
  departments: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string; departmentId: string }>;
  users: Array<{ id: string; name: string; role: string; groupId: string | null; departmentId: string | null }>;
};
type Payload = { unread: number; items: Item[]; hasMore: boolean; canSend: boolean; sendScope: SendScope | null };

const typeLabel: Record<NotificationType, string> = { GENERAL: "普通", IMPORTANT: "重要", REWARD: "奖励", REMINDER: "提醒" };
const roleLabel: Record<string, string> = { LEAD: "组长", RECEPTION: "接粉", GROUP_OPERATOR: "炒群", EXPERT: "专家", COMPANY_MANAGER: "公司管理员", ADMIN: "总公司管理员", RESOURCE_MANAGER: "资源部" };

export function useNotificationUnread() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = () => { void requestJson<Payload>("/api/notifications").then((value) => { if (active) setUnread(value.unread); }).catch(() => undefined); };
    refresh();
    const timer = window.setInterval(refresh, 45_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return [unread, setUnread] as const;
}

export function NotificationBadge({ count }: { count: number }) {
  return count > 0 ? <b className={styles.navBadge}>{count > 99 ? "99+" : count}</b> : null;
}

export function UnifiedNotificationCenter({ onUnreadChange }: { onUnreadChange?: (count: number) => void }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [mode, setMode] = useState<"ALL" | "UNREAD">("ALL");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actingId, setActingId] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [targetType, setTargetType] = useState<TargetType>("ALL");
  const [departmentId, setDepartmentId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [role, setRole] = useState("RECEPTION");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [type, setType] = useState<NotificationType>("GENERAL");
  const [requiresAck, setRequiresAck] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const next = await requestJson<Payload>("/api/notifications");
      setPayload(next); onUnreadChange?.(next.unread);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "通知加载失败"); }
    finally { setLoading(false); }
  }, [onUnreadChange]);
  useEffect(() => { void load(); }, [load]);

  const visibleItems = useMemo(() => mode === "UNREAD" ? (payload?.items ?? []).filter((item) => !item.readAt) : payload?.items ?? [], [mode, payload]);
  const availableUsers = useMemo(() => departmentId
    ? (payload?.sendScope?.users ?? []).filter((user) => user.departmentId === departmentId || (user.groupId && payload?.sendScope?.groups.some((group) => group.id === user.groupId && group.departmentId === departmentId)))
    : payload?.sendScope?.users ?? [], [departmentId, payload]);

  async function mark(item: Item, action: "READ" | "ACKNOWLEDGE") {
    setActingId(item.id); setError("");
    try {
      await requestJson(`/api/notifications/${encodeURIComponent(item.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "通知操作失败"); }
    finally { setActingId(""); }
  }

  async function loadMore() {
    if (!payload?.hasMore || loadingMore) return;
    setLoadingMore(true); setError("");
    try {
      const next = await requestJson<Payload>(`/api/notifications?offset=${payload.items.length}`);
      setPayload({ ...next, items: [...payload.items, ...next.items] });
      onUnreadChange?.(next.unread);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "更多通知加载失败"); }
    finally { setLoadingMore(false); }
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const result = await requestJson<{ recipientCount: number }>("/api/notifications", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: String(form.get("title") ?? "").trim(), content: String(form.get("content") ?? "").trim(), type,
          requiresAck: type === "IMPORTANT" && requiresAck, targetType,
          departmentId: targetType === "ALL" && departmentId ? departmentId : undefined,
          groupId: targetType === "GROUP" ? groupId : undefined,
          role: targetType === "ROLE" ? role : undefined,
          userIds: targetType === "USERS" ? selectedUserIds : undefined,
        }),
      });
      formElement.reset(); setType("GENERAL"); setTargetType("ALL"); setDepartmentId(""); setGroupId(""); setSelectedUserIds([]); setRequiresAck(false);
      setNotice(`通知已真实发送给 ${result.recipientCount} 人。`); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "通知发送失败"); }
    finally { setSaving(false); }
  }

  return <div className={styles.center}>
    <section className={styles.header}><div><h2>通知中心</h2><p>未读 {payload?.unread ?? 0} 条；重要通知需要确认后才算已知晓。</p></div><button type="button" disabled={loading} onClick={() => void load()}>{loading ? "刷新中…" : "刷新"}</button></section>
    {payload?.canSend && payload.sendScope ? <form className={styles.publisher} onSubmit={publish}>
      <header><div><h2>发布通知</h2><p>接收人只能从你的真实管理范围中选择。</p></div></header>
      <div className={styles.formGrid}><label><span>标题</span><input name="title" minLength={2} maxLength={80} required placeholder="请输入通知标题" /></label><label className={styles.content}><span>内容</span><textarea name="content" minLength={2} maxLength={2000} required placeholder="请写清要求和时间" /></label></div>
      <div className={styles.filters}><label><span>类型</span><select value={type} onChange={(event) => setType(event.target.value as NotificationType)}><option value="GENERAL">普通通知</option><option value="IMPORTANT">重要通知</option><option value="REWARD">奖励表扬</option><option value="REMINDER">工作提醒</option></select></label><label><span>发送范围</span><select value={targetType} onChange={(event) => { setTargetType(event.target.value as TargetType); setSelectedUserIds([]); }}><option value="ALL">全部权限范围</option><option value="GROUP">指定小组</option><option value="ROLE">指定岗位</option><option value="USERS">指定人员</option></select></label>
        {targetType === "ALL" && payload.sendScope.departments.length ? <label><span>部门（可选）</span><select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">全部范围</option>{payload.sendScope.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
        {targetType === "GROUP" ? <label><span>接收小组</span><select value={groupId} onChange={(event) => setGroupId(event.target.value)} required><option value="">请选择</option>{payload.sendScope.groups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
        {targetType === "ROLE" ? <label><span>接收岗位</span><select value={role} onChange={(event) => setRole(event.target.value)}><option value="RECEPTION">接粉</option><option value="GROUP_OPERATOR">炒群</option><option value="EXPERT">专家</option><option value="LEAD">组长</option></select></label> : null}
        {type === "IMPORTANT" ? <label className={styles.check}><input type="checkbox" checked={requiresAck} onChange={(event) => setRequiresAck(event.target.checked)} />要求接收人确认</label> : null}
        <button className={styles.primary} disabled={saving || (targetType === "USERS" && !selectedUserIds.length)}>{saving ? "发送中…" : "确认发布"}</button>
      </div>
      {targetType === "USERS" ? <div className={styles.people}><strong>选择接收人（已选 {selectedUserIds.length} 人）</strong><div>{availableUsers.map((item) => <label key={item.id}><input type="checkbox" checked={selectedUserIds.includes(item.id)} onChange={() => setSelectedUserIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><span>{item.name}<small>{roleLabel[item.role] ?? item.role}</small></span></label>)}</div>{!availableUsers.length ? <p>当前范围没有可选人员。</p> : null}</div> : null}
    </form> : null}
    {error ? <div className={styles.error} role="alert">{error}</div> : null}{notice ? <div className={styles.success} role="status">{notice}</div> : null}
    <section className={styles.list}><header><div><h2>我的通知</h2><p>通知内容来自真实发布记录。</p></div><div><button data-active={mode === "ALL"} onClick={() => setMode("ALL")}>全部</button><button data-active={mode === "UNREAD"} onClick={() => setMode("UNREAD")}>未读 {payload?.unread ?? 0}</button></div></header>
      {loading && !payload ? <div className={styles.empty}>正在读取通知…</div> : visibleItems.map((item) => <article key={item.id} data-unread={!item.readAt}><div className={styles.itemTop}><div><span data-type={item.notification.type}>{typeLabel[item.notification.type]}</span>{!item.readAt ? <b>未读</b> : null}{item.acknowledgedAt ? <b data-done>已确认</b> : null}</div><time>{new Date(item.notification.createdAt).toLocaleString("zh-CN")}</time></div><h3>{item.notification.title}</h3><p>{item.notification.content}</p><footer><small>{item.notification.sender.name}</small>{item.notification.requiresAck && !item.acknowledgedAt ? <button disabled={actingId === item.id} onClick={() => void mark(item, "ACKNOWLEDGE")}>我已知晓</button> : !item.readAt ? <button disabled={actingId === item.id} onClick={() => void mark(item, "READ")}>标为已读</button> : null}</footer></article>)}
      {mode === "ALL" && payload?.hasMore ? <div className={styles.empty}><button type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "加载中…" : "加载更多通知"}</button></div> : null}
      {!loading && !visibleItems.length ? <div className={styles.empty}>{mode === "UNREAD" ? "没有未读通知" : "目前没有通知"}</div> : null}
    </section>
  </div>;
}
