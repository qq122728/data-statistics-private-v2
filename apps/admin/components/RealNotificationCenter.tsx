"use client";

import { useEffect, useState, type FormEvent } from "react";
import { requestJson } from "@/lib/backend";
import { IconCheck, IconSend } from "./Icons";
import { Modal } from "./Modal";

type NotificationType = "GENERAL" | "IMPORTANT" | "REWARD" | "REMINDER";
type Item = {
  id: string; readAt: string | null; acknowledgedAt: string | null;
  notification: { title: string; content: string; type: NotificationType; requiresAck: boolean; createdAt: string; sender: { name: string } };
};
const TYPE_LABEL: Record<NotificationType, string> = { GENERAL: "普通", IMPORTANT: "重要", REWARD: "奖励", REMINDER: "提醒" };

export function RealNotificationCenter({ canSend }: { canSend: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState<NotificationType>("GENERAL");
  const [role, setRole] = useState("");
  const [requiresAck, setRequiresAck] = useState(false);

  async function load() {
    try {
      const data = await requestJson<{ unread: number; items: Item[] }>("/api/notifications");
      setItems(data.items); setUnread(data.unread); setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "通知加载失败"); }
  }
  useEffect(() => { void load(); }, []);

  function openCompose() {
    setTitle(""); setContent(""); setType("GENERAL"); setRole(""); setRequiresAck(false); setComposeOpen(true);
  }

  async function act(id: string, action: "READ" | "ACKNOWLEDGE") {
    try {
      await requestJson(`/api/notifications/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "操作失败"); }
  }

  async function send(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await requestJson<{ recipientCount: number }>("/api/notifications", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, content, type, requiresAck: type === "IMPORTANT" && requiresAck, targetType: role ? "ROLE" : "ALL", ...(role ? { role } : {}) }),
      });
      setComposeOpen(false); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "发送失败"); }
    finally { setBusy(false); }
  }

  return <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    {error ? <div className="card" role="alert" style={{ padding: 14, color: "var(--bad)", borderColor: "var(--bad-line)" }}>{error}</div> : null}
    <section className="card">
      <div className="card-head">
        <div><h2 className="card-title">通知中心</h2><p className="card-note">未读 {unread} 条 · 只显示当前账号权限范围内的真实通知。</p></div>
        <div style={{ display: "flex", gap: 8 }}>{canSend ? <button className="btn" data-size="sm" data-variant="primary" onClick={openCompose}><IconSend size={13} />发通知</button> : null}<button className="btn" data-size="sm" onClick={() => void load()}>刷新</button></div>
      </div>
      {!items.length ? <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ink-3)" }}>暂无收到的通知</div> : items.map((item) => <article key={item.id} style={{ padding: "14px 18px", borderTop: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><strong>{item.notification.title}</strong><span className="badge" data-tone={item.notification.type === "IMPORTANT" ? "bad" : item.notification.type === "REWARD" ? "ok" : "warn"}>{TYPE_LABEL[item.notification.type]}</span>{!item.readAt ? <span className="badge" data-tone="bad">未读</span> : null}</div>
          <span className="muted">{item.notification.sender.name} · {new Date(item.notification.createdAt).toLocaleString("zh-CN")}</span>
        </div>
        <p style={{ margin: "6px 0 0", lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--ink-2)" }}>{item.notification.content}</p>
        {!item.readAt || item.notification.requiresAck && !item.acknowledgedAt ? <div style={{ marginTop: 10, display: "flex", gap: 8 }}>{!item.readAt ? <button className="btn" data-size="sm" onClick={() => void act(item.id, "READ")}>标记已读</button> : null}{item.notification.requiresAck && !item.acknowledgedAt ? <button className="btn" data-size="sm" data-variant="primary" onClick={() => void act(item.id, "ACKNOWLEDGE")}>确认收到</button> : null}</div> : null}
      </article>)}
    </section>
    <Modal open={composeOpen} onClose={() => !busy && setComposeOpen(false)} title="发通知" note="填好后确认发送，后端会自动限制在当前管理范围内。">
      <form onSubmit={send} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label><span className="label">发送范围</span><select className="field" style={{ width: "100%" }} value={role} onChange={(event) => setRole(event.target.value)}><option value="">权限范围内全部岗位</option><option value="LEAD">组长</option><option value="RECEPTION">接粉</option><option value="GROUP_OPERATOR">炒群</option><option value="EXPERT">专家</option></select></label>
        <label><span className="label">标题 *</span><input className="field" style={{ width: "100%" }} value={title} onChange={(event) => setTitle(event.target.value)} minLength={2} maxLength={80} required /></label>
        <label><span className="label">类型</span><select className="field" style={{ width: "100%" }} value={type} onChange={(event) => setType(event.target.value as NotificationType)}>{Object.entries(TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span className="label">内容 *</span><textarea className="field" style={{ width: "100%", minHeight: 110, resize: "vertical" }} value={content} onChange={(event) => setContent(event.target.value)} minLength={2} maxLength={2000} required /></label>
        {type === "IMPORTANT" ? <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={requiresAck} onChange={(event) => setRequiresAck(event.target.checked)} />要求接收人确认收到</label> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="btn" onClick={() => setComposeOpen(false)}>取消</button><button className="btn" data-variant="primary" data-confirm-action="发送通知" disabled={busy}><IconCheck size={14} />{busy ? "发送中…" : "提交"}</button></div>
      </form>
    </Modal>
  </div>;
}
