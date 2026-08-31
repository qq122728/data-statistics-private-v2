"use client";

import { useState } from "react";
import type { Confirm } from "./ConfirmDialog";
import { Modal } from "./Modal";
import { IconAlert, IconCheck } from "./Icons";
import {
  computeOrderedSummaryColumns, money, summaryDatesDesc,
  type ChannelName, type ChannelReviewEntry, type Member,
} from "@/lib/mock-data";

/** 资源部核对收件箱——组长在"渠道数据核对"页面点"发送资源部审核"之后，这里就是真正
 *  的接收端，闭环的关键一步：确认/标记异议都会写回同一份 channelReviewStatus，组长
 *  自己的页面读的是同一个状态，不是另外一套"看起来像"的演示数字。
 *
 *  只显示这个账号绑定的渠道——投流账号永远看不到短信的提交，反过来也一样（资源部
 *  拆成两个独立账号，不是靠前端筛选"假装"隔离，是这个页面压根不取另一个渠道的 key）。
 *  只显示组长真的发过的日期：遍历 summaryDatesDesc() 查每天有没有 `${channel}__${date}`
 *  这条 channelReviewStatus 记录，没发过的日期这里压根不出现——那是组长自己页面的事，
 *  这里不重复"未发送"这个状态。
 *
 *  确认/异议都是终态：一旦落成 CONFIRMED/DISPUTED 就不再显示操作按钮，没有"撤销确认"
 *  这种回退——跟审核中心那套走审批链的 PENDING/APPROVED/RETURNED 不一样，这里更简单，
 *  资源部自己一个人说了算，不需要再审一遍。 */
export function TabResourceInbox({
  members, channelReviewStatus, channel, onConfirmReview, onDisputeReview, onConfirm,
}: {
  members: Member[];
  channelReviewStatus: Record<string, ChannelReviewEntry>;
  channel: ChannelName;
  onConfirmReview: (channel: ChannelName, date: string) => void;
  onDisputeReview: (channel: ChannelName, date: string, note: string) => void;
  onConfirm: (c: Confirm) => void;
}) {
  const [disputeDate, setDisputeDate] = useState<string | null>(null);
  const [disputeNote, setDisputeNote] = useState("");

  const rows = summaryDatesDesc()
    .filter((date) => channelReviewStatus[`${channel}__${date}`])
    .map((date) => ({ date, entry: channelReviewStatus[`${channel}__${date}`] }));

  function askConfirm(date: string) {
    onConfirm({
      title: "确认数据无误", confirmLabel: "确认无误", target: `${date} · ${channel}`,
      desc: `确认 ${date} · ${channel} 这天组长发来的数据核对无误？确认后这条记录会标记为最终状态，不能撤销。`,
      onConfirm: () => onConfirmReview(channel, date),
    });
  }

  function openDispute(date: string) {
    setDisputeDate(date);
    setDisputeNote("");
  }

  function submitDispute() {
    if (!disputeDate) return;
    const note = disputeNote.trim();
    if (!note) return;
    onConfirm({
      title: "确认标记异议", confirmLabel: "确认标记", target: `${disputeDate} · ${channel}`, danger: true,
      desc: `标记 ${disputeDate} · ${channel} 这天的数据有异议，组长那边会看到这条说明：「${note}」`,
      onConfirm: () => {
        onDisputeReview(channel, disputeDate, note);
        setDisputeDate(null);
      },
    });
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2 className="card-title">核对收件箱</h2>
          <p className="card-note">{channel} · 组长发来待核对的每日数据，确认或标记异议之后会同步回组长那边的渠道数据核对页面。</p>
        </div>
      </div>

      <div>
        {rows.length ? rows.map(({ date, entry }) => {
          if (!entry) return null;
          const col = computeOrderedSummaryColumns(date, date, members, channel)[0];
          return (
            <div key={date} style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14 }}>{date}</strong>
                <span className="badge" data-tone={entry.status === "SENT" ? "warn" : entry.status === "CONFIRMED" ? "ok" : "bad"}>
                  {entry.status === "SENT" ? "待确认" : entry.status === "CONFIRMED" ? "已确认" : "有异议"}
                </span>
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-2)" }}>
                添加数据 {col.added} · 进群 {col.joined} · 净业绩 {money(col.netUsd)}
              </p>
              {entry.status === "DISPUTED" && entry.note ? (
                <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--bad)" }}>异议说明：{entry.note}</p>
              ) : null}
              {entry.status === "SENT" ? (
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                  <button className="btn" data-size="sm" data-variant="primary" onClick={() => askConfirm(date)}>
                    <IconCheck size={13} />确认无误
                  </button>
                  <button className="btn" data-size="sm" onClick={() => openDispute(date)}>
                    <IconAlert size={13} />标记异议
                  </button>
                </div>
              ) : null}
            </div>
          );
        }) : (
          <div style={{ padding: "44px 0", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
            暂无组长提交的核对数据
          </div>
        )}
      </div>

      <Modal
        open={disputeDate !== null} onClose={() => setDisputeDate(null)}
        title={`标记异议 · ${disputeDate ?? ""} · ${channel}`}
        note="说明具体异议在哪，方便组长核对修正，这条说明会原样显示在组长那边。"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label className="label">异议说明 *</label>
            <textarea
              value={disputeNote}
              onChange={(e) => setDisputeNote(e.target.value)}
              placeholder="必填，例如：这天的进群数跟渠道后台对不上，后台显示只有3个"
              rows={4}
              style={{
                width: "100%", padding: "9px 11px", resize: "vertical",
                border: "1px solid var(--line-strong)", borderRadius: "var(--radius)",
                fontSize: 13.5, outline: "none",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => setDisputeDate(null)}>取消</button>
            <button className="btn" data-variant="primary" disabled={!disputeNote.trim()} onClick={submitDispute}>
              <IconCheck size={15} />提交
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
