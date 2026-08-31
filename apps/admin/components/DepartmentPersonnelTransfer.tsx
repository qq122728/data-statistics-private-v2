"use client";

import { PersonnelTransferPanel } from "./PersonnelTransferPanel";

export function DepartmentPersonnelTransfer({
  onToast,
}: {
  onToast: (message: string, tone?: "ok" | "warn") => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <header>
        <h1 className="page-title">人员调动与工作交接</h1>
        <p className="page-subtitle">
          员工从 A 组调到 B 组时，只转移仍在进行的客户、本人设备和设备账号；过去的数据和已经结束的客户继续留在 A 组。
        </p>
      </header>
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
          <div><strong>① 选择人员和目标组</strong><p className="card-note" style={{ marginTop: 4 }}>可以跨组调动，也可以只调整岗位。</p></div>
          <div><strong>② 预览影响</strong><p className="card-note" style={{ marginTop: 4 }}>系统先列出将移动的客户、设备和冲突。</p></div>
          <div><strong>③ 确认后生效</strong><p className="card-note" style={{ marginTop: 4 }}>旧登录失效，历史归属不会被改写。</p></div>
        </div>
      </div>
      <PersonnelTransferPanel onToast={onToast} />
    </div>
  );
}
