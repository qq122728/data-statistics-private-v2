"use client";

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
import { NotificationBadge, UnifiedNotificationCenter, useNotificationUnread } from "@/components/UnifiedNotificationCenter";
import { Bell, ChartBar, ClockCounterClockwise, DeviceMobile, Path, SignOut, Table, UsersThree } from "@phosphor-icons/react";

type View = "statistics" | "history" | "finance" | "groupSummary" | "customers" | "devices" | "management" | "notifications";

const viewMeta: Record<View, { title: string; note: string }> = {
  statistics: { title: "当日数据", note: "只填写自己的数据，按来源渠道分列" },
  history: { title: "历史数据", note: "查看本人过去保存的日报，不会从其他日期复制数字" },
  finance: { title: "财务数据", note: "按渠道填写首充、续充、出金，净业绩由系统计算" },
  groupSummary: { title: "小组数据汇总", note: "组长按人员和渠道查看本组真实汇总" },
  customers: { title: "客户进度表格", note: "一个客户一行，组内成员共同维护" },
  devices: { title: "设备账号", note: "只查看和维护自己的设备与账号" },
  management: { title: "小组管理", note: "管理本组成员、工作交接和数据检查" },
  notifications: { title: "通知中心", note: "查看真实工作通知并处理未读或确认" },
};

export default function FreshWorkspace({ user, onLogout }: { user: BackendUser; onLogout: () => void }) {
  const [view, setView] = useState<View>("statistics");
  const [inspectionMember, setInspectionMember] = useState<InspectorMember | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [notificationUnread, setNotificationUnread] = useNotificationUnread();
  const isLead = user.roles.includes("LEAD");
  const meta = viewMeta[view];

  return <div className="fresh-app">
    <aside className="fresh-sidebar">
      <div className="fresh-brand"><span>统</span><div><strong>数据统计</strong><small>{isLead ? "组长工作台" : "组员工作台"}</small></div></div>
      <nav>
        <button data-active={view === "statistics"} onClick={() => setView("statistics")}><i><Table size={18} /></i><span>当日数据</span></button>
        <button data-active={view === "history"} onClick={() => setView("history")}><i><ClockCounterClockwise size={18} /></i><span>历史数据</span></button>
        <button data-active={view === "finance"} onClick={() => setView("finance")}><i><ChartBar size={18} /></i><span>财务数据</span></button>
        {isLead ? <button data-active={view === "groupSummary"} onClick={() => setView("groupSummary")}><i><ChartBar size={18} /></i><span>小组数据汇总</span></button> : null}
        <button data-active={view === "customers"} onClick={() => setView("customers")}><i><Path size={18} /></i><span>客户进度表</span></button>
        <button data-active={view === "devices"} onClick={() => setView("devices")}><i><DeviceMobile size={18} /></i><span>设备账号</span></button>
        {isLead ? <button data-active={view === "management"} onClick={() => setView("management")}><i><UsersThree size={18} /></i><span>小组管理</span></button> : null}
        <button data-active={view === "notifications"} onClick={() => setView("notifications")}><i><Bell size={18} /></i><span>通知中心<NotificationBadge count={notificationUnread} /></span></button>
      </nav>
      <div className="fresh-sidebar-note"><strong>{isLead ? "组长管理权限" : "统一组员权限"}</strong><span>{isLead ? "本人工作台＋本组管理" : "每日数据、资金和客户进度都在同一个账号处理"}</span></div>
    </aside>

    <section className="fresh-main" data-ai-open={aiOpen}>
      <header className="fresh-header">
        <div><h1>{meta.title}</h1><p>{meta.note}</p></div>
        <div className="fresh-header-actions">
          <AiSmartAssistant open={aiOpen} onOpenChange={setAiOpen} contextLabel={`当前页面 · ${meta.title}`} user={user} />
          <div className="fresh-user"><span>{user.name.slice(0, 1)}</span><div><strong>{user.name}</strong><small>{isLead ? "组员 · 组长权限" : "组员"}</small></div><button onClick={onLogout}><SignOut size={16} />退出</button></div>
        </div>
      </header>
      <main className="fresh-content">
        {view === "statistics" ? <UnifiedMemberDataSheet mode="daily" memberName={user.name} /> : null}
        {view === "history" ? <MemberDailyRecords mode="history" /> : null}
        {view === "finance" ? <UnifiedMemberDataSheet mode="finance" memberName={user.name} /> : null}
        {view === "groupSummary" && isLead ? <GroupChannelAnalysis /> : null}
        {view === "customers" ? <MemberCustomerProgress user={user} /> : null}
        {view === "devices" ? <DeviceAccounts /> : null}
        {view === "management" && isLead ? <TeamManagement user={user} onInspect={setInspectionMember} /> : null}
        {view === "notifications" ? <UnifiedNotificationCenter onUnreadChange={setNotificationUnread} /> : null}
      </main>
    </section>
    {inspectionMember ? <MemberDataInspector member={inspectionMember} onClose={() => setInspectionMember(null)} /> : null}
  </div>;
}
