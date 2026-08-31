"use client";

import { useState } from "react";
import type { Confirm } from "./ConfirmDialog";
import { SummaryTable } from "./SummaryTable";
import {
  CHANNELS, TODAY, computeOrderedSummaryColumns, money, summaryDatesDesc,
  type ChannelName, type ChannelReviewEntry, type Member, type SummaryColumn,
} from "@/lib/mock-data";

const MONTH_START = `${TODAY.slice(0, 7)}-01`;

/** 渠道对比——同一套指标按渠道拆开当行，指标当列，看哪个渠道真的值得投。两个渠道
 *  都是德国一组的真实数据（不像团队汇总/部门汇总那种有"演示数据占位"的组/部门），
 *  所以这张表可以直接用统计区间选择器现算，不需要"固定月度快照"那一套简化——是这几个
 *  角色层级的汇总表里唯一一个能做到全部实时的。刻意不加"渠道总计"行：两个渠道加起来
 *  就是"数据汇总"页面本来就有的总计，这张表存在的意义是对比，不是再算一遍总数。 */
const COMPARE_COLUMNS: { label: string; render: (c: SummaryColumn) => React.ReactNode }[] = [
  { label: "添加数据", render: (c) => c.added },
  { label: "撞粉", render: (c) => c.collision },
  { label: "低金额", render: (c) => c.lowAmount },
  { label: "无WS号码", render: (c) => c.noWs },
  { label: "有效数据", render: (c) => <strong>{c.effective}</strong> },
  { label: "回复", render: (c) => c.replied },
  { label: "进群", render: (c) => c.joined },
  { label: "正常退群", render: (c) => c.leftNormal },
  { label: "异常退群", render: (c) => c.leftAbnormal },
  { label: "当前在群", render: (c) => c.inGroup },
  { label: "推专家", render: (c) => c.pushed },
  { label: "注册", render: (c) => c.registered },
  { label: "开单", render: (c) => c.ordered },
  { label: "回复率", render: (c) => <span style={{ color: "var(--ink-3)" }}>{c.repliedRate}</span> },
  { label: "拉群率", render: (c) => <span style={{ color: "var(--ink-3)" }}>{c.joinedRate}</span> },
  { label: "退群率", render: (c) => <span style={{ color: "var(--ink-3)" }}>{c.leftAbnormalRate}</span> },
  { label: "入金", render: (c) => money(c.depositUsd) },
  { label: "出金", render: (c) => money(c.withdrawalUsd) },
  {
    label: "净业绩",
    render: (c) => {
      const v = c.netUsd ?? 0;
      return (
        <span className="tnum" style={{ fontWeight: 700, color: v >= 0 ? "var(--ok)" : "var(--bad)" }}>
          {v >= 0 ? "" : "-"}{money(Math.abs(v))}
        </span>
      );
    },
  },
];

function ChannelCompareTable({ members }: { members: Member[] }) {
  const [from, setFrom] = useState(MONTH_START);
  const [to, setTo] = useState(TODAY);

  const rows = CHANNELS.map((ch) => ({
    channel: ch,
    metrics: computeOrderedSummaryColumns(from, to, members, ch)[0],
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>统计区间</span>
        <input className="field" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <span style={{ color: "var(--ink-3)" }}>至</span>
        <input className="field" type="date" value={to} min={from} max={TODAY} onChange={(e) => setTo(e.target.value)} />
        <button className="btn" data-size="sm" onClick={() => { setFrom(MONTH_START); setTo(TODAY); }}>本月</button>
        <span className="badge" data-tone="mute" style={{ marginLeft: "auto" }}>只读 · 与数据汇总同源</span>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div className="card-head">
          <div>
            <h2 className="card-title">渠道对比</h2>
            <p className="card-note">{from} 至 {to} · 同一套漏斗指标按渠道拆开，看哪个渠道真的值得投</p>
          </div>
        </div>
        <div className="table-scroll" style={{ maxHeight: "none" }}>
          <table className="grid-table">
            <thead>
              <tr>
                <th style={{ width: 120, position: "sticky", left: 0, zIndex: 4 }}>渠道</th>
                {COMPARE_COLUMNS.map((c) => <th key={c.label}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ channel, metrics }) => (
                <tr key={channel}>
                  <td style={{
                    fontWeight: 700, whiteSpace: "nowrap",
                    position: "sticky", left: 0, zIndex: 2, background: "var(--surface)",
                  }}>
                    {channel}
                  </td>
                  {COMPARE_COLUMNS.map((c) => (
                    <td key={c.label} className="tnum" style={{ textAlign: "center" }}>{c.render(metrics)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** 渠道数据核对——跟数据汇总是同一套指标行、同一套底层数据（RECEPTION_DAILY_STATS + PIPELINE_EVENTS），
 *  只是多了渠道筛选，用来跟资源部的渠道批次台账对数。当月汇总只读，没有发送入口——
 *  组长自己核对参考用；每天的表可以点「发送资源部审核」，本地演示环境里只是翻个状态、
 *  弹个提示，资源部这边角色还没做，不会真的有人收到通知。 */
export function TabChannelReconcile({
  members, channelReviewStatus, onSendForReview, onConfirm, lockedChannel, hideSendButton = false,
}: {
  members: Member[];
  channelReviewStatus: Record<string, ChannelReviewEntry>;
  onSendForReview: (channel: ChannelName, date: string) => void;
  onConfirm: (c: Confirm) => void;
  /** 资源部账号看这个组件时传自己绑定的渠道——锁死渠道、不显示选择器，因为资源部
   *  账号本来就只能看自己那一个渠道，没有"选渠道"这个动作。组长自己用不传，走原来
   *  的可选择逻辑。 */
  lockedChannel?: ChannelName;
  /** 资源部账号是来看数、核对用的，不会给自己发审核请求——传true隐藏每日表头右侧
   *  的"发送资源部审核"按钮和状态徽章（组长发的审核请求本来就已经能在核对收件箱里
   *  看到了，这里不用重复显示）。 */
  hideSendButton?: boolean;
}) {
  const [localChannel, setLocalChannel] = useState<ChannelName>(CHANNELS[0]);
  const channel = lockedChannel ?? localChannel;
  /** 渠道对比只在没锁死渠道时才有意义——资源部账号被锁死成一个渠道，看不到另一个渠道
   *  的数据，也就没有"对比"这回事，所以这个子tab连同它的切换按钮一起不渲染。 */
  const [sub, setSub] = useState<"reconcile" | "compare">("reconcile");

  const monthColumns = computeOrderedSummaryColumns(MONTH_START, TODAY, members, channel);
  const dates = summaryDatesDesc();

  function askSend(date: string) {
    onConfirm({
      title: "发送核对数据", confirmLabel: "发送", target: `${date} · ${channel}`,
      desc: `确认发送 ${date} · ${channel} 的数据给资源部管理员审核？`,
      onConfirm: () => onSendForReview(channel, date),
    });
  }

  const subTabBar = lockedChannel ? null : (
    <div style={{ display: "flex", gap: 8 }}>
      {([["reconcile", "核对明细"], ["compare", "渠道对比"]] as const).map(([id, label]) => (
        <button key={id} className="btn" data-variant={sub === id ? "primary" : undefined} onClick={() => setSub(id)}>
          {label}
        </button>
      ))}
    </div>
  );

  if (!lockedChannel && sub === "compare") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {subTabBar}
        <ChannelCompareTable members={members} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {subTabBar}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {lockedChannel ? null : (
          <>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>来源渠道选择</span>
            <select
              className="field"
              style={{ width: 160 }}
              value={localChannel}
              onChange={(e) => setLocalChannel(e.target.value as ChannelName)}
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </>
        )}
        <span className="badge" data-tone="mute" style={{ marginLeft: "auto" }}>核对口径 · 与数据汇总同源</span>
      </div>

      <SummaryTable
        title={`${channel} · 8月汇总`}
        note={`${MONTH_START} 至 ${TODAY} 累计 · 只读，跟资源部核对时作参考，不发送`}
        columns={monthColumns}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {dates.map((date) => {
          const key = `${channel}__${date}`;
          const entry = channelReviewStatus[key];
          return (
            <SummaryTable
              key={date}
              title={`${channel} · ${date}`}
              columns={computeOrderedSummaryColumns(date, date, members, channel)}
              headerRight={
                hideSendButton ? undefined : !entry ? (
                  <button className="btn" data-size="sm" data-variant="primary" onClick={() => askSend(date)}>
                    发送资源部审核
                  </button>
                ) : entry.status === "SENT" ? (
                  <span className="badge" data-tone="warn">已发送待资源部确认</span>
                ) : entry.status === "CONFIRMED" ? (
                  <span className="badge" data-tone="ok">资源部已确认</span>
                ) : (
                  <span className="badge" data-tone="bad">资源部有异议：{entry.note}</span>
                )
              }
            />
          );
        })}
        {!dates.length ? (
          <div className="card" style={{ padding: "44px 0", textAlign: "center", color: "var(--ink-3)" }}>
            暂无按天数据
          </div>
        ) : null}
      </div>
    </div>
  );
}
