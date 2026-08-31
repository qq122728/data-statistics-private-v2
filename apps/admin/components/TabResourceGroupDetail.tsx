"use client";

import { useState } from "react";
import { TabChannelReconcile } from "./TabChannelReconcile";
import { type ChannelName, type ChannelReviewEntry, type Member, type TeamGroup } from "@/lib/mock-data";

const NOOP = () => {};

/** 小组明细——资源部账号挑一个小组，看自己绑定渠道在这个小组的月度汇总+按天明细，
 *  用来跟组长逐天核对。直接复用 TabChannelReconcile（组长自己核对用的那套月+按天表），
 *  但传 lockedChannel 锁死成自己的渠道（不显示渠道选择器——资源部本来就只有一个渠道
 *  可看，没有"选渠道"这个动作），传 hideSendButton 隐藏"发送资源部审核"按钮/徽章
 *  （组长发来的审核请求已经在"核对收件箱"里能看到、能处理了，这里不用重复一遍）。
 *  德国二组/三组的演示数据没有渠道维度，用跟"渠道数据汇总"一致的占位说明。 */
export function TabResourceGroupDetail({
  members, teamGroups, channel,
}: {
  members: Member[];
  teamGroups: TeamGroup[];
  channel: ChannelName;
}) {
  const [groupId, setGroupId] = useState<string>(teamGroups[0].id);
  const group = teamGroups.find((g) => g.id === groupId) ?? teamGroups[0];
  const detailGroupName = teamGroups.find((g) => g.hasDetailData)?.name ?? "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>选择小组</span>
        <select
          className="field"
          style={{ width: 160 }}
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
        >
          {teamGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <span className="badge" data-tone="mute" style={{ marginLeft: "auto" }}>{channel} · 资源部口径</span>
      </div>

      {group.hasDetailData ? (
        <TabChannelReconcile
          members={members} channelReviewStatus={{} as Record<string, ChannelReviewEntry>}
          lockedChannel={channel} hideSendButton
          onSendForReview={NOOP} onConfirm={NOOP}
        />
      ) : (
        <div className="card">
          <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--ink-3)" }}>
            该组的演示数据没有按渠道拆分，暂时无法在这里显示逐天明细——不是"没有数据"，是本地演示数据的颗粒度不够细，只有{detailGroupName}有完整的渠道级别数据。
          </div>
        </div>
      )}
    </div>
  );
}
