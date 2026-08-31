"use client";

import { useState } from "react";
import type { Confirm } from "./ConfirmDialog";
import { TabChannelReconcile } from "./TabChannelReconcile";
import { TabCustomerFollowUp } from "./TabCustomerFollowUp";
import { TabDataSummary } from "./TabDataSummary";
import { RealOrganizationReporting } from "./RealOrganizationReporting";
import { RealChannelReporting } from "./RealChannelReporting";
import { RealCustomerProgress } from "./RealCustomerProgress";
import {
  type ChannelName, type ChannelReviewEntry, type ClaimBaseline, type DownstreamLead, type ExpertStage,
  type Member, type RepliedPendingGroupCustomer,
} from "@/lib/mock-data";

type MainTab = "summary" | "channel" | "followup";
const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: "summary", label: "数据汇总" },
  { id: "channel", label: "渠道数据核对" },
  { id: "followup", label: "客户进度" },
];

const NOOP = () => {};

/** 客户进度（TabCustomerFollowUp）需要的整套操作 handler——组长自己用这套真实的，
 *  部门/公司/总公司管理员一律传 undefined，由本组件内部换成 NOOP，调用方不需要
 *  自己手写一份 NOOP 对象。 */
export type FollowUpHandlerBundle = {
  onAdvanceExpertStage: (id: string, stage: ExpertStage, extra?: { firstChargeUsd?: number; firstChargeDate?: string }) => void;
  onClaimHistorical: (draft: {
    phone: string; name: string; channel: string; sourceDate: string;
    attributionOwnerId: string; groupOperatorId: string; expertOwnerId: string;
    baseline: ClaimBaseline; daysInGroup: number; stageEventDate: string;
    firstChargeUsd?: number; firstChargeDate?: string;
  }) => void;
  onAddContinuation: (id: string, amountUsd: number, date: string) => void;
  onAddWithdrawal: (id: string, amountUsd: number, date: string) => void;
  onUndoLastMoneyEvent: (id: string) => void;
  onCancelOrder: (id: string) => void;
  onEditMoneyEvent: (id: string, eventId: string, amountUsd: number, date: string) => void;
  onEditFirstCharge: (id: string, amountUsd: number, date: string) => void;
  onUpdateExpertNote: (id: string, note: string) => void;
};

const NOOP_HANDLERS: FollowUpHandlerBundle = {
  onAdvanceExpertStage: NOOP, onClaimHistorical: NOOP, onAddContinuation: NOOP, onAddWithdrawal: NOOP,
  onUndoLastMoneyEvent: NOOP, onCancelOrder: NOOP, onEditMoneyEvent: NOOP, onEditFirstCharge: NOOP, onUpdateExpertNote: NOOP,
};

type GroupBusinessTabsProps =
  // 当前范围是"全部部门"/"全部小组"对比视图——三个业务标签跟具体某个小组绑定，跟对比
  // 视图天然不兼容，禁用（不隐藏）并给一句简短原因，跟需求"标签要隐藏或禁用，并显示
  // 简短原因"对应。
  | { mode: "disabled"; reason: string }
  // 选中的小组没有真实逐人数据（本地演示数据范围限制）——照抄原 TabGroupDrilldown 的
  // 占位提示文案，不编一份假数据出来。
  | { mode: "empty"; reason: string }
  | {
      mode: "active";
      members: Member[];
      downstream: DownstreamLead[];
      repliedPendingGroup: RepliedPendingGroupCustomer[];
      channelReviewStatus: Record<string, ChannelReviewEntry>;
      onSendForReview: (channel: ChannelName, date: string) => void;
      onConfirm: (c: Confirm) => void;
      /** true＝部门/公司/总公司管理员查看，客户进度必须只读；false＝组长本人，客户
       *  进度可操作。这是调用方（app/page.tsx）按当前登录角色算好传进来的，本组件
       *  只是照做，绝不自己用"选中的 groupId 是不是组长自己的组"这种方式去猜。 */
      readOnly: boolean;
      /** readOnly=false 时必填；readOnly=true 时会被忽略（内部换成 NOOP）。 */
      handlers?: FollowUpHandlerBundle;
      defaultMainTab?: MainTab;
      /** 仅把“数据汇总”接到真实后端；渠道核对和客户进度在各自接通前仍保留原型。 */
      realSummary?: boolean;
      realChannel?: boolean;
      realFollowup?: boolean;
    };

/** 小组业务内容——数据汇总/渠道数据核对/客户进度三个一级标签，客户进度内部委托给
 *  TabCustomerFollowUp 自己已有的接粉/炒群/专家三个二级标签（不重新发明）。这是原来
 *  TabGroupDrilldown"选中一个具体小组之后展示什么"那部分逻辑单独抽出来的组件，去掉了
 *  原来那个组件自带的"选择小组"下拉——下拉已经统一收进 OrganizationScopeSelector。
 *
 *  数据汇总/渠道数据核对/客户进度三个组件本来就是"永远接收全量 members/downstream
 *  数组，组件内部按需要自己处理"的设计，这里原样透传，不额外发明一套"按当前选中小组
 *  过滤 members"的逻辑。 */
export function GroupBusinessTabs(props: GroupBusinessTabsProps) {
  const [mainTab, setMainTab] = useState<MainTab>(props.mode === "active" ? props.defaultMainTab ?? "summary" : "summary");

  if (props.mode === "empty") {
    return (
      <div className="card">
        <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--ink-3)" }}>{props.reason}</div>
      </div>
    );
  }

  if (props.mode === "disabled") {
    return (
      <div className="card" style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {MAIN_TABS.map((t) => <button key={t.id} className="btn" disabled>{t.label}</button>)}
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>{props.reason}</p>
      </div>
    );
  }

  const { members, downstream, repliedPendingGroup, channelReviewStatus, onSendForReview, onConfirm, readOnly, handlers, realSummary, realChannel, realFollowup } = props;
  const followUpHandlers = readOnly || !handlers ? NOOP_HANDLERS : handlers;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {MAIN_TABS.map((t) => (
          <button key={t.id} className="btn" data-variant={mainTab === t.id ? "primary" : undefined} onClick={() => setMainTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {mainTab === "summary" ? (
        realSummary
          ? <RealOrganizationReporting permissionLabel="本组管理" actorGroupMode />
          : <TabDataSummary members={members} />
      ) : mainTab === "channel" ? (
        realChannel
          ? <RealChannelReporting />
          : <TabChannelReconcile
              members={members} channelReviewStatus={channelReviewStatus}
              onSendForReview={onSendForReview} onConfirm={onConfirm}
            />
      ) : (
        // 左侧一条竖线 + 缩进，让"客户进度"内部的接粉/炒群/专家二级标签跟上面的一级
        // 标签在视觉上分出层级，不是六个按钮平铺在一起。
        <div style={{ borderLeft: "3px solid var(--line-strong)", paddingLeft: 14 }}>
          {realFollowup ? <RealCustomerProgress members={members} readOnly={readOnly} /> : <TabCustomerFollowUp
            readOnly={readOnly}
            repliedPendingGroup={repliedPendingGroup} downstream={downstream} members={members}
            onAdvanceExpertStage={followUpHandlers.onAdvanceExpertStage} onClaimHistorical={followUpHandlers.onClaimHistorical}
            onAddContinuation={followUpHandlers.onAddContinuation} onAddWithdrawal={followUpHandlers.onAddWithdrawal}
            onUndoLastMoneyEvent={followUpHandlers.onUndoLastMoneyEvent} onCancelOrder={followUpHandlers.onCancelOrder}
            onEditMoneyEvent={followUpHandlers.onEditMoneyEvent} onEditFirstCharge={followUpHandlers.onEditFirstCharge}
            onUpdateExpertNote={followUpHandlers.onUpdateExpertNote}
            onConfirm={readOnly ? NOOP : onConfirm}
          />}
        </div>
      )}
    </div>
  );
}
