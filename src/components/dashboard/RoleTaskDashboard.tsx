export type RoleTaskRow = {
  id: string;
  phone: string;
  customerName: string | null;
  ownerName?: string;
  source: string;
  status: string;
  lastAction: string;
};

export type RoleTaskQueue = {
  key: string;
  label: string;
  description: string;
  href: string;
  rows: RoleTaskRow[];
  tone?: "blue" | "amber" | "red" | "emerald";
};

const toneClasses = {
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const maskedPhone = (phone: string) => phone.length < 7
  ? phone
  : `${phone.slice(0, 3)}****${phone.slice(-4)}`;

export function RoleTaskDashboard({
  title,
  description,
  queues,
  emptyMessage,
}: {
  title: string;
  description: string;
  queues: RoleTaskQueue[];
  emptyMessage: string;
}) {
  return (
    <main className="page-shell space-y-4">
      <div className="page-heading">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-description">{description}</p>
        </div>
      </div>
      <RoleTaskPanel queues={queues} emptyMessage={emptyMessage} />
    </main>
  );
}

export function RoleTaskPanel({
  queues,
  emptyMessage,
  compact = false,
}: {
  queues: RoleTaskQueue[];
  emptyMessage: string;
  compact?: boolean;
}) {
  const priorityRows = queues
    .flatMap((queue) => queue.rows.slice(0, 4).map((row) => ({ queue, row })))
    .slice(0, 12);

  if (compact) return <section className="panel lead-dashboard-section overflow-hidden">
    <div className="panel-header"><div><h2 className="panel-title">客户流程待办</h2><p className="panel-subtitle">需要组长介入的客户，按优先级集中展示</p></div><div className="lead-task-counts">{queues.map((queue) => <a key={queue.key} href={queue.href}><span>{queue.label}</span><strong>{queue.rows.length}</strong></a>)}</div></div>
    <div className="data-table-wrap"><table className="data-table"><thead><tr><th>待办</th><th>手机号 / 姓名</th><th>归属</th><th>来源</th><th>当前情况</th><th>最近动作</th><th>操作</th></tr></thead><tbody>{priorityRows.map(({ queue, row }) => <tr key={`${queue.key}:${row.id}`}><td><span className="analysis-status" data-tone={queue.tone === "red" ? "danger" : queue.tone === "amber" ? "warning" : queue.tone === "emerald" ? "success" : "neutral"}>{queue.label}</span></td><td><strong>{maskedPhone(row.phone)}</strong><span className="ml-2 text-xs text-slate-500">{row.customerName ?? "未填姓名"}</span></td><td>{row.ownerName ?? "—"}</td><td>{row.source}</td><td>{row.status}</td><td>{row.lastAction}</td><td><a href={queue.href} className="font-semibold text-[#0b66ff]">去处理</a></td></tr>)}{!priorityRows.length ? <tr><td colSpan={7} className="lead-dashboard-empty">{emptyMessage}</td></tr> : null}</tbody></table></div>
  </section>;

  return (
    <>
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {queues.map((queue) => (
          <a key={queue.key} href={queue.href} data-tone={queue.tone ?? "blue"} className={`role-task-card rounded-lg border px-4 py-3 transition hover:-translate-y-0.5 hover:shadow-sm ${toneClasses[queue.tone ?? "blue"]}`}>
            <div className="flex items-center justify-between gap-3">
              <strong className="text-sm">{queue.label}</strong>
              <span className="text-2xl font-bold">{queue.rows.length}</span>
            </div>
            <p className="mb-0 mt-1 text-xs opacity-80">{queue.description}</p>
          </a>
        ))}
      </section>
      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">优先处理明细</h2>
            <p className="panel-subtitle">按流程阶段集中展示，点击“去处理”进入对应工作页</p>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>待办</th>
                <th>手机号 / 姓名</th>
                <th>归属</th>
                <th>来源</th>
                <th>当前情况</th>
                <th>最近动作</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {priorityRows.map(({ queue, row }) => (
                <tr key={`${queue.key}:${row.id}`}>
                  <td><span className="analysis-status" data-tone={queue.tone === "red" ? "danger" : queue.tone === "amber" ? "warning" : queue.tone === "emerald" ? "success" : "neutral"}>{queue.label}</span></td>
                  <td><strong>{maskedPhone(row.phone)}</strong><span className="ml-2 text-xs text-slate-500">{row.customerName ?? "未填姓名"}</span></td>
                  <td>{row.ownerName ?? "—"}</td>
                  <td>{row.source}</td>
                  <td>{row.status}</td>
                  <td>{row.lastAction}</td>
                  <td><a href={queue.href} className="font-semibold text-[#0b66ff]">去处理</a></td>
                </tr>
              ))}
              {!priorityRows.length && <tr><td colSpan={7} className="empty-state">{emptyMessage}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
