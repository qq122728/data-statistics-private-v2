"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/lib/backend";

type Item = {
  id: string;
  readAt: string | null;
  acknowledgedAt: string | null;
  notification: {
    id: string;
    title: string;
    content: string;
    type: "GENERAL" | "IMPORTANT" | "REWARD" | "REMINDER";
    requiresAck: boolean;
    createdAt: string;
    expiresAt: string | null;
    sender: { name: string; role: string };
  };
};
const TYPE_LABEL = {
  GENERAL: "普通",
  IMPORTANT: "重要",
  REWARD: "奖励",
  REMINDER: "提醒",
} as const;

export function RealNotificationCenter() {
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await requestJson<{ unread: number; items: Item[] }>(
        "/api/notifications",
      );
      setItems(data.items);
      setUnread(data.unread);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "通知加载失败");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function act(item: Item, action: "READ" | "ACKNOWLEDGE") {
    try {
      await requestJson(`/api/notifications/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "通知操作失败");
    }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">通知中心</h2>
            <p className="card-note">
              真实通知 · 未读 {unread} 条；重要通知需要点击确认。
            </p>
          </div>
          <button className="btn" data-size="sm" onClick={() => void load()}>
            刷新
          </button>
        </div>
      </div>
      {error ? (
        <div
          className="card"
          role="alert"
          style={{ padding: 14, color: "var(--bad)" }}
        >
          {error}
        </div>
      ) : null}
      {loading && !items.length ? (
        <div className="card" style={{ padding: 30, textAlign: "center" }}>
          正在读取通知…
        </div>
      ) : null}
      {!loading && !items.length ? (
        <div
          className="card"
          style={{ padding: 40, textAlign: "center", color: "var(--ink-3)" }}
        >
          目前没有通知。
        </div>
      ) : null}
      {items.map((item) => (
        <article
          key={item.id}
          className="card"
          style={{
            padding: 16,
            borderColor: item.readAt ? "var(--line)" : "var(--accent)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className="badge"
              data-tone={
                item.notification.type === "IMPORTANT"
                  ? "bad"
                  : item.notification.type === "REWARD"
                    ? "ok"
                    : "warn"
              }
            >
              {TYPE_LABEL[item.notification.type]}
            </span>
            <strong>{item.notification.title}</strong>
            {!item.readAt ? (
              <span className="badge" data-tone="bad">
                未读
              </span>
            ) : null}
          </div>
          <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
            {item.notification.content}
          </p>
          <div className="muted">
            {item.notification.sender.name} ·{" "}
            {new Date(item.notification.createdAt).toLocaleString("zh-CN")}
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            {!item.readAt ? (
              <button
                className="btn"
                data-size="sm"
                data-confirm-action="标记通知已读"
                onClick={() => void act(item, "READ")}
              >
                标记已读
              </button>
            ) : null}
            {item.notification.requiresAck && !item.acknowledgedAt ? (
              <button
                className="btn"
                data-size="sm"
                data-variant="primary"
                data-confirm-action="确认收到通知"
                onClick={() => void act(item, "ACKNOWLEDGE")}
              >
                确认收到
              </button>
            ) : null}
            {item.acknowledgedAt ? (
              <span className="badge" data-tone="ok">
                已确认
              </span>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
