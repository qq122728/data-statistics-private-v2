"use client";

export type ReceptionMemberPerformance = {
  id: string;
  name: string;
  active: boolean;
  total: number;
  invalid: number;
  valid: number;
  replied: number;
  joined: number;
  pendingReply: number;
  pendingJoin: number;
};

function rate(value: number, total: number) {
  return total ? `${((value / total) * 100).toFixed(1)}%` : "暂无样本";
}

export function ReceptionPerformanceTable({ members }: { members: ReceptionMemberPerformance[] }) {
  const summary = members.reduce((total, member) => ({
    submitted: total.submitted + member.total,
    valid: total.valid + member.valid,
    replied: total.replied + member.replied,
    joined: total.joined + member.joined,
    pending: total.pending + member.pendingReply + member.pendingJoin,
  }), { submitted: 0, valid: 0, replied: 0, joined: 0, pending: 0 });

  const summaryItems = [
    ["接粉人员", members.length],
    ["添加数据", summary.submitted],
    ["有效数据", summary.valid],
    ["回复", summary.replied],
    ["进群", summary.joined],
    ["待跟进", summary.pending],
  ] as const;

  return (
    <section className="lead-member-performance reception-performance overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-4">
        <h2 className="m-0 text-base font-semibold text-slate-900">接粉明细</h2>
        <p className="mb-0 mt-1 text-sm text-slate-500">本组汇总与人员对比；点击后续成员明细可再看每日变化，此页不展示客户电话号码。</p>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-3 xl:grid-cols-6">
        {summaryItems.map(([label, value]) => <div key={label} className="px-4 py-3"><span className="block text-xs text-slate-500">{label}</span><strong className={label === "待跟进" && value ? "mt-1 block text-lg text-red-700" : "mt-1 block text-lg text-slate-900"}>{value}</strong></div>)}
      </div>
      <div className="data-table-wrap border-t border-slate-200">
        <table className="data-table min-w-[930px]">
          <thead>
            <tr>
              <th>接粉成员</th>
              <th>添加数据</th>
              <th>有效数据</th>
              <th>回复</th>
              <th>回复率</th>
              <th>进群</th>
              <th>进群率</th>
              <th>待跟进</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const pending = member.pendingReply + member.pendingJoin;
              return <tr key={member.id}>
                <td><strong>{member.name}</strong><span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${member.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{member.active ? "在岗" : "已停用"}</span></td>
                <td><strong>{member.total}</strong>{member.invalid ? <span className="ml-1 text-xs text-slate-400">含无效 {member.invalid}</span> : null}</td>
                <td><strong>{member.valid}</strong></td>
                <td><strong>{member.replied}</strong></td>
                <td><strong className={member.valid && member.replied / member.valid < 0.5 ? "text-amber-700" : "text-slate-900"}>{rate(member.replied, member.valid)}</strong></td>
                <td><strong>{member.joined}</strong></td>
                <td><strong className={member.replied && member.joined / member.replied < 0.5 ? "text-amber-700" : "text-slate-900"}>{rate(member.joined, member.replied)}</strong></td>
                <td><strong className={pending ? "text-red-700" : "text-emerald-700"}>{pending}</strong><span className="ml-1 text-xs text-slate-500">回复 {member.pendingReply} · 进群 {member.pendingJoin}</span></td>
              </tr>;
            })}
            {!members.length ? <tr><td colSpan={8} className="py-8 text-center text-sm text-slate-500">本组还没有接粉成员。</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
