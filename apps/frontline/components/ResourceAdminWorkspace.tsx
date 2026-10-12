"use client";

import { useEffect, useState } from "react";
import { accountRoleLabel } from "../../../packages/auth/account-role";
import type { BackendUser } from "@/lib/backend";
import { ManagerAccounts } from "@/components/HeadquartersWorkspace";
import { ResourceMaterialLibrary } from "@/components/ResourceMaterialLibrary";
import { ResourceSpendWorkspace } from "@/components/ResourceSpendWorkspace";
import { ResourceBuyerAttribution } from "@/components/ResourceBuyerAttribution";
import { WorkspaceNavButton, WorkspaceNavGroup, WorkspaceShell } from "@/components/WorkspaceShell";

type View = "buyers" | "materials" | "accounts" | "spend" | "numbers";

export default function ResourceAdminWorkspace({ user, onLogout }: { user: BackendUser; onLogout: () => void }) {
  const [view, setView] = useState<View>("buyers");
  const [detailMaterial, setDetailMaterial] = useState("");
  const [detailMonth, setDetailMonth] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return <WorkspaceShell
    mark="资"
    workspaceLabel="资源总管理"
    title={view === "buyers" ? "投手效果" : view === "numbers" ? "号码库" : view === "materials" ? "素材库" : view === "spend" ? "消耗登记" : "人员账号管理"}
    subtitle="查看投流与短信渠道，管理资源负责人账号"
    userName={user.name}
    userLabel={accountRoleLabel(user)}
    onLogout={onLogout}
    scope={{ label: "管理范围", value: "投流与短信全部渠道" }}
    navigation={<>
      <WorkspaceNavGroup label="资源后台">
        <WorkspaceNavButton active={view === "buyers"} icon="analysis" onClick={() => setView("buyers")}>投手效果</WorkspaceNavButton>
        <WorkspaceNavButton active={view === "numbers"} icon="devices" onClick={() => { setDetailMaterial(""); setDetailMonth(""); setView("numbers"); }}>号码库</WorkspaceNavButton>
        <WorkspaceNavButton active={view === "spend"} icon="calendar" onClick={() => setView("spend")}>消耗登记</WorkspaceNavButton>
        <WorkspaceNavButton active={view === "materials"} icon="channel" onClick={() => setView("materials")}>素材库</WorkspaceNavButton>
        <WorkspaceNavButton active={view === "accounts"} icon="accounts" onClick={() => setView("accounts")}>人员账号管理</WorkspaceNavButton>
      </WorkspaceNavGroup>
    </>}
  >
    <div style={{ marginBottom: view === "buyers" ? 4 : 12 }}><a href="/" style={{ color: "#1d63ca", fontSize: 13 }}>返回总公司工作台</a></div>
    {notice ? <p role="status" style={{ color: "#167149" }}>{notice}</p> : null}
    <div hidden={view !== "buyers" && view !== "numbers"}><ResourceBuyerAttribution readOnly active={view === "buyers" || view === "numbers"} mode={view === "numbers" ? "numbers" : "effects"} onOpenNumbers={() => setView("numbers")} initialMaterialId={detailMaterial} initialMonth={detailMonth} /></div>
    {view === "materials" ? <ResourceMaterialLibrary readOnly onViewNumbers={(id, month) => { setDetailMaterial(id); setDetailMonth(month); setView("numbers"); }} /> : view === "spend" ? <ResourceSpendWorkspace readOnly /> : view === "accounts" ? <ManagerAccounts companies={[]} resourceOnly notify={setNotice} onTransfer={() => window.location.assign("/")} /> : null}

  </WorkspaceShell>;
}
