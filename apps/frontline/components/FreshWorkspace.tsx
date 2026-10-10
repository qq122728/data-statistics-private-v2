"use client";

import { WORKSPACE_LABELS as labels, NAV_GROUPS } from "../../../packages/workspace/navigation";

import { AccountMenu } from "../../../packages/auth/AccountMenu";
import { accountRoleLabel } from "../../../packages/auth/account-role";
import { useState } from "react";
import type { BackendUser } from "@/lib/backend";
import { DeviceAccounts } from "@/components/DeviceAccounts";
import { GroupChannelAnalysis } from "@/components/GroupChannelAnalysis";
import { MemberCustomerProgress } from "@/components/MemberCustomerProgress";
import { MemberDailyRecords } from "@/components/MemberDailyRecords";
import MemberDataInspector, { type InspectorMember } from "@/components/MemberDataInspector";
import TeamManagement from "@/components/TeamManagement";
import { UnifiedMemberDataSheet } from "@/components/UnifiedMemberDataSheet";
import { AiSmartAssistant } from "@/components/AiSmartAssistant";
import { Leaderboard } from "@/components/Leaderboard";
import { NotificationBadge, UnifiedNotificationCenter, useNotificationUnread } from "@/components/UnifiedNotificationCenter";
import { Bell, ChartBar, ClockCounterClockwise, DeviceMobile, Path, Table, Trophy, UsersThree } from "@phosphor-icons/react";
import { ChannelManagementPanel } from "@/components/ChannelManagementPanel";

type View = "statistics" | "history" | "finance" | "groupSummary" | "customers" | "devices" | "channels" | "management" | "rankings" | "notifications";

const viewMeta: Record<View, { title: string; note: string }> = {
  statistics: { title: labels.daily, note: "客户记录自动汇总，按渠道查看数量与资金" },
  history: { title: labels.history, note: "查看本人过去保存的日报，不会从其他日期复制数字" },
  finance: { title: labels.finance, note: "按渠道填写首充、续充、出金，净业绩由系统计算" },
  groupSummary: { title: labels.groupSummary, note: "组长按人员和渠道查看本组真实汇总" },
  customers: { title: labels.customers, note: "一个客户一行，组内成员共同维护" },
  devices: { title: labels.devices, note: "只查看和维护自己的设备与账号" },
  channels: { title: labels.channels, note: "组长只能给自己负责的小组新增渠道" },
  management: { title: labels.groups, note: "管理本组成员、工作交接和数据检查" },
  rankings: { title: labels.rankings, note: "只比较本小组同岗位员工，低于同岗位平均一半会提示" },
  notifications: { title: labels.notifications, note: "查看真实工作通知并处理未读或确认" },
};

const memberGuides: Partial<Record<View, { title: string; steps: Array<{ label: string; text: string }>; foot: string }>> = {
 statistics: {title:"每天数据怎么填",steps:[{label:"1",text:"黑客组先导入号码；律师组选择日期和渠道填写数字。"},{label:"2",text:"黑客组更新客户后自动汇总；律师组继续手填日报。"},{label:"3",text:"修改后自动保存，可按日期和渠道核对。"}],foot:"当前在群由进群和退群记录自动计算；历史手填记录保留。"},
 customers:{title:"客户表怎么用",steps:[{label:"1",text:"仅导入有效客户；下载最新模板，核对资料后确认保存。"},{label:"2",text:"选填阶段可留空；已填写日期须按实际先后，允许同一天，不填未来。"},{label:"3",text:"全组客户都可看，自己负责的内容可编辑，其他人的只读。"}],foot:"超过50人可在表格上方或底部翻页；找不到时点“找号码 · 全部进度”，按完整号码、尾号四位或编号查找并直接打开。同一客户在在群和专家视图展示不同字段。"}
};

export default function FreshWorkspace({ user, onLogout }: { user: BackendUser; onLogout: () => void }) {
  const [view, setView] = useState<View>(user.roles.includes("LEAD") ? "groupSummary" : "customers");
  const [inspectionMember, setInspectionMember] = useState<InspectorMember | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [notificationUnread, setNotificationUnread] = useNotificationUnread();
  const isLead = user.roles.includes("LEAD");
  const roleLabel = isLead ? "组长" : user.roles.includes("EXPERT") ? "专家" : user.roles.includes("RECEPTION") ? "前台" : "群操作";
  const meta = viewMeta[view];
  const guide = memberGuides[view];

  return <div className="fresh-app">
    <aside className="fresh-sidebar">
      <div className="fresh-brand"><span>统</span><div><strong>数据统计</strong><small>{roleLabel + "工作台"}</small></div></div>
      <nav aria-label="工作台功能导航">
      <small className="workspace-nav-label">{NAV_GROUPS.work}</small>
        <button data-active={view === "statistics"} aria-current={view === "statistics" ? "page" : undefined} onClick={() => setView("statistics")}><i><Table size={18} /></i><span>{labels.daily}</span></button>
        <button data-active={view === "customers"} aria-current={view === "customers" ? "page" : undefined} onClick={() => setView("customers")}><i><Path size={18} /></i><span>{labels.customers}</span></button>
        <button data-active={view === "notifications"} aria-current={view === "notifications" ? "page" : undefined} onClick={() => setView("notifications")}><i><Bell size={18} /></i><span>{labels.notifications}<NotificationBadge count={notificationUnread} /></span></button>
      <small className="workspace-nav-label">{NAV_GROUPS.data}</small>
        <button data-active={view === "history"} aria-current={view === "history" ? "page" : undefined} onClick={() => setView("history")}><i><ClockCounterClockwise size={18} /></i><span>{labels.history}</span></button>
        {isLead ? <button data-active={view === "groupSummary"} aria-current={view === "groupSummary" ? "page" : undefined} onClick={() => setView("groupSummary")}><i><ChartBar size={18} /></i><span>{labels.groupSummary}</span></button> : null}
        {isLead ? <button data-active={view === "rankings"} aria-current={view === "rankings" ? "page" : undefined} onClick={() => setView("rankings")}><i><Trophy size={18} /></i><span>{labels.rankings}</span></button> : null}
      {isLead ? <small className="workspace-nav-label">{NAV_GROUPS.organization}</small> : null}
        {isLead ? <button data-active={view === "management"} aria-current={view === "management" ? "page" : undefined} onClick={() => setView("management")}><i><UsersThree size={18} /></i><span>{labels.groups}</span></button> : null}
      <small className="workspace-nav-label">{NAV_GROUPS.resources}</small>
        <button data-active={view === "devices"} aria-current={view === "devices" ? "page" : undefined} onClick={() => setView("devices")}><i><DeviceMobile size={18} /></i><span>{labels.devices}</span></button>
        {isLead ? <button data-active={view === "channels"} aria-current={view === "channels" ? "page" : undefined} onClick={() => setView("channels")}><i><Path size={18} /></i><span>{labels.channels}</span></button> : null}
      </nav>
      <div className="fresh-sidebar-note"><strong>{isLead ? "组长管理权限" : "统一组员权限"}</strong><span>{isLead ? "本人工作台＋本组管理" : "每日数据、资金和客户进度都在同一个账号处理"}</span></div>
    </aside>

    <section className="fresh-main" data-ai-open={aiOpen} data-daily={view==="statistics"||view==="finance"||view==="groupSummary"}>
      <header className="fresh-header">
        <div><h1>{meta.title}</h1><p>{meta.note}</p></div>
        <div className="fresh-header-actions">
          <AiSmartAssistant open={aiOpen} onOpenChange={setAiOpen} contextLabel={`当前页面 · ${meta.title}`} user={user} />
          <AccountMenu name={user.name} roleLabel={accountRoleLabel(user)} scope={user.groupName ?? "所属小组"} changePasswordHref="/change-password" onLogout={onLogout} />
        </div>
      </header>
      <main className="fresh-content">
        {guide && view!=="statistics" && view!=="finance" ? <details className="member-entry-guide member-entry-guide--compact">
          <summary><strong>{guide.title}</strong><span>展开查看操作说明</span></summary>
          <div>{guide.steps.map((step) => <p key={step.label}><b>{step.label}</b><span>{step.text}</span></p>)}</div>
          <footer>{guide.foot}</footer>
        </details> : null}
        {view === "statistics" ? <UnifiedMemberDataSheet mode="daily" memberName={user.name} /> : null}
        {view === "history" ? <MemberDailyRecords mode="history" /> : null}
        {view === "finance" ? <UnifiedMemberDataSheet mode="finance" memberName={user.name} /> : null}
        {view === "groupSummary" && isLead ? <GroupChannelAnalysis /> : null}
        {view === "customers" ? <MemberCustomerProgress user={user} /> : null}
        {view === "devices" ? <DeviceAccounts /> : null}
        {view === "channels" && isLead ? <ChannelManagementPanel scope="group" groupId={user.groupId} /> : null}
        {view === "management" && isLead ? <TeamManagement user={user} onInspect={setInspectionMember} /> : null}
        {view === "rankings" && isLead ? <Leaderboard managedScope /> : null}
        {view === "notifications" ? <UnifiedNotificationCenter onUnreadChange={setNotificationUnread} /> : null}
      </main>
    </section>
    {inspectionMember ? <MemberDataInspector member={inspectionMember} onClose={() => setInspectionMember(null)} /> : null}
  </div>;
}
