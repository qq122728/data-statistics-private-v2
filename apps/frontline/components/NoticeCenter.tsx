"use client";

import { useMemo, useState } from "react";
import {
  DEDUCTIONS,
  DOWNSTREAM,
  PENDING_GROUP,
  PENDING_REPLY,
  formatPhone,
  type Lead,
} from "@/lib/mock-data";
import { IconAlert, IconBell, IconCheck, IconClock, IconInbox, IconRoute, IconUsers } from "./Icons";

type Tone = "ok" | "warn" | "bad" | "mute";
/** 业务通知：拉群、专家进度更新这类客户跟进过程中自动产生的提醒——来自数据本身。
 *  公司通知：组长/管理员手动下发的通知——不是数据推出来的，是人发的。 */
type NoticeKind = "business" | "company";

type Notice = {
  id: string;
  kind: NoticeKind;
  tone: Tone;
  category: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  /** 展示用时间戳，跟表格里其它时间戳一样是字符串，不做真实时区换算 */
  timestamp: string;
  /** 公司通知才有——谁发的 */
  sender?: string;
};

const NOTICE_KIND_META: Record<NoticeKind, { label: string; note: string }> = {
  business: { label: "业务通知", note: "拉群、专家进度更新、待回复超时、扣粉报告被退回这些跟客户跟进相关的提醒" },
  company: { label: "公司通知", note: "组长、管理员下发的通知——制度、排班、系统公告这类" },
};

/** 等待超过几天算"长时间未回复"——超过5天标红，3~4天标黄 */
const LONG_WAIT_DAYS = 3;
const URGENT_WAIT_DAYS = 5;

/** 待回复里挑出等太久的客户，从最久的排到最近的 */
function longWaitNotices(): Notice[] {
  return PENDING_REPLY
    .filter((l) => l.waitedDays >= LONG_WAIT_DAYS)
    .sort((a, b) => b.waitedDays - a.waitedDays)
    .map((l) => ({
      id: `wait-${l.id}`,
      kind: "business", tone: (l.waitedDays >= URGENT_WAIT_DAYS ? "bad" : "warn") as Tone,
      category: "长时间未回复",
      icon: <IconClock size={16} />,
      title: `${l.name || formatPhone(l.phone)} 已等待 ${l.waitedDays} 天未回复`,
      desc: `${formatPhone(l.phone)} · 已回访 ${l.visits} 次 · 来源 ${l.channel}${l.lastVisitNote ? " · " + l.lastVisitNote : ""}`,
      timestamp: l.sourceDate,
    }));
}

/** 扣粉登记被组长退回，需要核对后重报 */
function returnedDeductionNotices(): Notice[] {
  return DEDUCTIONS
    .filter((d) => d.status === "returned")
    .map((d) => ({
      id: `ded-${d.id}`,
      kind: "business", tone: "bad" as Tone,
      category: "扣粉报告被退回",
      icon: <IconAlert size={16} />,
      title: `${d.channel} 的扣粉报告被组长退回`,
      desc: `撞粉 ${d.dup} · 低金额 ${d.low} · 无WhatsApp ${d.noWs} · ${d.note}`,
      timestamp: d.date,
    }));
}

/** 已回复、准备拉群的客户——该尽快确认入群，别攒着 */
function readyToGroupNotices(): Notice[] {
  return PENDING_GROUP
    .filter((l): l is Lead & { chatStatus: "READY" } => l.chatStatus === "READY")
    .map((l) => ({
      id: `ready-${l.id}`,
      kind: "business", tone: "warn" as Tone,
      category: "准备拉群",
      icon: <IconInbox size={16} />,
      title: `${l.name || formatPhone(l.phone)} 已准备好拉群`,
      desc: `${formatPhone(l.phone)} · 客户情况：${l.lastVisitNote ?? "暂无备注"} · 尽快确认入群`,
      timestamp: l.repliedAt ?? l.sourceDate,
    }));
}

/** 客户已经确认入群、交棒给炒群——「客户进度」页里出现的每一位都算一条拉群通知 */
function groupJoinedNotices(): Notice[] {
  return DOWNSTREAM.map((d) => ({
    id: `joined-${d.id}`,
    kind: "business", tone: "ok" as Tone,
    category: "拉群",
    icon: <IconUsers size={16} />,
    title: `客户 ${d.code} 已拉群`,
    desc: `接粉：${d.attributionOwner} · 炒群：${d.groupOperator} · 来源 ${d.channel}`,
    timestamp: d.sourceDate,
  }));
}

/** 专家阶段有进展的客户——把专家当前阶段和最新专家情况推成一条通知，方便接粉/炒群不用自己去客户进度页翻 */
function expertProgressNotices(): Notice[] {
  return DOWNSTREAM
    .filter((d) => d.expertOwner !== "待分配")
    .map((d) => ({
      id: `expert-progress-${d.id}`,
      kind: "business", tone: "ok" as Tone,
      category: "专家进度更新",
      icon: <IconRoute size={16} />,
      title: `客户 ${d.code} 专家阶段：${d.expertStage}`,
      desc: `专家：${d.expertOwner} · ${d.expertNote}`,
      timestamp: d.sourceDate,
    }));
}

/** 交出去的客户在专家阶段停滞——只读提醒，方便跟催 */
function expertStalledNotices(): Notice[] {
  return DOWNSTREAM
    .filter((d) => d.expertStageWarn)
    .map((d) => ({
      id: `expert-stalled-${d.id}`,
      kind: "business", tone: "warn" as Tone,
      category: "专家阶段停滞",
      icon: <IconRoute size={16} />,
      title: `客户 ${d.code} 在专家阶段停滞`,
      desc: `专家：${d.expertOwner} · 当前阶段：${d.expertStage} · ${d.expertNote}`,
      timestamp: d.sourceDate,
    }));
}

/** 公司通知：组长/管理员下发的，不是数据推出来的——演示数据，接后端时换成真实公告接口 */
function companyNotices(): Notice[] {
  return [
    {
      id: "company-1", kind: "company", tone: "warn" as Tone, category: "制度提醒",
      icon: <IconBell size={16} />,
      title: "严禁私下加客户联系方式",
      desc: "所有客户沟通一律走系统备注留痕，私下加号一经发现按违规处理。",
      timestamp: "2026-08-25", sender: "管理员",
    },
    {
      id: "company-2", kind: "company", tone: "ok" as Tone, category: "系统公告",
      icon: <IconBell size={16} />,
      title: "批次成本单价已更新",
      desc: "德国短信A/德国投流B本周单价有调整，具体以「渠道分析」页为准。",
      timestamp: "2026-08-24", sender: "管理员",
    },
    {
      id: "company-3", kind: "company", tone: "mute" as Tone, category: "排班通知",
      icon: <IconBell size={16} />,
      title: "本周排班表已发布",
      desc: "国庆假期排班调整，请各自留意上下班时间，有冲突尽快找我改。",
      timestamp: "2026-08-20", sender: "组长 李强",
    },
  ];
}

const TONE_ORDER: Record<Tone, number> = { bad: 0, warn: 1, ok: 2, mute: 3 };

function buildNotices(): Notice[] {
  const all = [
    ...longWaitNotices(),
    ...returnedDeductionNotices(),
    ...readyToGroupNotices(),
    ...groupJoinedNotices(),
    ...expertProgressNotices(),
    ...expertStalledNotices(),
    ...companyNotices(),
  ];
  return all.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}

export function NoticeCenter() {
  const notices = useMemo(buildNotices, []);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<NoticeKind>("business");
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const inKind = notices.filter((n) => n.kind === kind);
  const unreadCount = inKind.filter((n) => !readIds.has(n.id)).length;
  const visible = filter === "unread" ? inKind.filter((n) => !readIds.has(n.id)) : inKind;
  const totalUnread = notices.filter((n) => !readIds.has(n.id)).length;

  function toggleRead(id: string) {
    setReadIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function markAllRead() {
    setReadIds((prev) => new Set([...prev, ...inKind.map((n) => n.id)]));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="card-head">
          <div>
            <h2 className="card-title">通知中心</h2>
            <p className="card-note">{NOTICE_KIND_META[kind].note}</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            <span className="badge" data-tone={totalUnread ? "bad" : "mute"}>
              {totalUnread} 条未读
            </span>
            <button className="btn" data-size="sm" disabled={!unreadCount} onClick={markAllRead}>
              <IconCheck size={14} />全部标为已读
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, padding: "12px 18px 0" }}>
          {(Object.keys(NOTICE_KIND_META) as NoticeKind[]).map((k) => {
            const count = notices.filter((n) => n.kind === k).length;
            const unread = notices.filter((n) => n.kind === k && !readIds.has(n.id)).length;
            return (
              <button
                key={k}
                onClick={() => { setKind(k); setFilter("all"); }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 14px",
                  borderRadius: 999, cursor: "pointer", fontSize: 13.5, fontWeight: 600,
                  border: `1px solid ${kind === k ? "var(--accent)" : "var(--line-strong)"}`,
                  background: kind === k ? "var(--accent)" : "var(--surface)",
                  color: kind === k ? "#fff" : "var(--ink-2)",
                }}
              >
                {NOTICE_KIND_META[k].label}
                <span className="tnum" style={{
                  minWidth: 20, height: 20, padding: "0 6px", borderRadius: 999,
                  background: kind === k ? "rgba(255,255,255,.22)" : "var(--surface-sunken)",
                  color: kind === k ? "#fff" : "var(--ink-2)", fontSize: 12,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}>{count}</span>
                {unread ? (
                  <span aria-hidden="true" style={{
                    width: 7, height: 7, borderRadius: 999,
                    background: kind === k ? "#fff" : "var(--bad)",
                  }} />
                ) : null}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 6, padding: "10px 18px", borderBottom: "1px solid var(--line)" }}>
          {([["all", "全部"], ["unread", "未读"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              style={{
                height: 30, padding: "0 13px", borderRadius: 999, cursor: "pointer",
                border: `1px solid ${filter === k ? "var(--accent)" : "var(--line)"}`,
                background: filter === k ? "var(--accent-soft)" : "var(--surface-sunken)",
                color: filter === k ? "var(--accent)" : "var(--ink-2)", fontSize: 12.5, fontWeight: 600,
              }}
            >
              {label} {k === "all" ? inKind.length : unreadCount}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {visible.map((n) => {
            const read = readIds.has(n.id);
            return (
              <div
                key={n.id}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 12, padding: "13px 18px",
                  borderBottom: "1px solid var(--line)", background: read ? "transparent" : "var(--accent-soft)",
                  opacity: read ? 0.72 : 1,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 8, height: 8, borderRadius: 999, marginTop: 6, flexShrink: 0,
                    background: read ? "transparent" : "var(--accent)",
                  }}
                />
                <span
                  className="badge"
                  data-tone={n.tone}
                  style={{ flexShrink: 0, width: 30, height: 30, padding: 0, justifyContent: "center", borderRadius: 999 }}
                  title={n.category}
                >
                  {n.icon}
                </span>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="badge" data-tone={n.tone}>{n.category}</span>
                    <strong style={{ fontSize: 13.5, color: "var(--ink)" }}>{n.title}</strong>
                  </div>
                  <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)" }}>{n.desc}</p>
                  <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    {n.sender ? `${n.sender} · ` : ""}{n.timestamp}
                  </span>
                </div>
                <button
                  className="btn" data-size="sm" style={{ flexShrink: 0 }}
                  onClick={() => toggleRead(n.id)}
                >
                  {read ? "标为未读" : "标为已读"}
                </button>
              </div>
            );
          })}
          {!visible.length ? (
            <div style={{ padding: "44px 0", textAlign: "center", color: "var(--ink-3)" }}>
              {filter === "unread" ? "未读通知已经清空" : "暂时没有通知"}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
