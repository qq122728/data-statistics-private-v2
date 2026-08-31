"use client";

import { useState } from "react";
import type { BackendUser } from "@/lib/backend";
import { DepartmentCustomerProgress } from "./DepartmentCustomerProgress";
import { ExpertWorkbench } from "./ExpertWorkbench";
import { GroupOperatorWorkbench } from "./GroupOperatorWorkbench";

type CustomerView = "all" | "group" | "expert";

export function MemberCustomerProgress({ user }: { user: BackendUser }) {
  const isLead = user.roles.includes("LEAD");
  const available: Array<{ id: CustomerView; label: string }> = [
    ...(isLead ? [{ id: "all" as const, label: "全组客户进度" }] : []),
    { id: "group" as const, label: "炒群情况" },
    { id: "expert" as const, label: "专家情况" },
  ];
  const [view, setView] = useState<CustomerView>(available[0]?.id ?? "group");

  return <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
    <section className="card" style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div><h2 className="card-title">已进群客户进度</h2><p className="card-note">只管理已经进群的客户；炒群情况和专家情况由同一个组员账号继续更新，客户业绩始终归属最初来源组员。</p></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{available.map((item) => <button key={item.id} className="btn" data-variant={view === item.id ? "primary" : undefined} onClick={() => setView(item.id)}>{item.label}</button>)}</div>
    </section>
    {view === "all" ? <DepartmentCustomerProgress groups={user.groupId ? [{ id: user.groupId, name: user.groupName ?? "本小组" }] : []} /> : null}
    {view === "group" ? <GroupOperatorWorkbench /> : null}
    {view === "expert" ? <ExpertWorkbench /> : null}
  </div>;
}
