export type GroupCustomerView = "inGroup" | "introduced" | "expertProgress" | "ordered" | "left";
export type GroupCustomerStatusFilter = "" | "IN_GROUP_PENDING_EXPERT" | "LEFT";
export type GroupCustomerExpertStageFilter = "" | "QUEUED" | "MATERIALS" | "TRACKING" | "PENDING_REGISTRATION" | "PENDING_ORDER" | "DECLINED_DEPOSIT" | "ORDERED" | "STALLED";

export type GroupCustomerFilterValues = {
  search: string;
  member: string;
  expertStage: GroupCustomerExpertStageFilter;
  channel: string;
  view: GroupCustomerView;
  leaveRisk: "" | "EARLY" | "WATCH" | "NORMAL" | "UNKNOWN";
  leaveOrder: "" | "ordered" | "not-ordered";
  stage: GroupCustomerStatusFilter;
};

export function GroupCustomerFilters({
  values,
  members,
  channels,
  inGroupCount,
  introducedCount,
  expertProgressCount,
  orderedCount,
  leftCount,
  earlyLeftCount,
  filteredCount,
  onChange,
  onSearchSubmit,
}: {
  values: GroupCustomerFilterValues;
  members: string[];
  channels: string[];
  inGroupCount: number;
  introducedCount: number;
  expertProgressCount: number;
  orderedCount: number;
  leftCount: number;
  earlyLeftCount: number;
  filteredCount: number;
  onChange: (next: Partial<GroupCustomerFilterValues>) => void;
  onSearchSubmit: () => void;
}) {
  return <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
      <div role="tablist" aria-label="群客户阶段" className="flex flex-wrap items-center gap-1">
        <button type="button" className={`rounded-md px-2.5 py-1.5 text-sm font-semibold ${values.view === "inGroup" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-white"}`} onClick={() => onChange({ view: "inGroup" })}>在群待推专家 {inGroupCount}</button>
        <button type="button" className={`rounded-md px-2.5 py-1.5 text-sm font-semibold ${values.view === "introduced" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-white"}`} onClick={() => onChange({ view: "introduced" })}>已推专家 {introducedCount}</button>
        <button type="button" className={`rounded-md px-2.5 py-1.5 text-sm font-semibold ${values.view === "expertProgress" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-white"}`} onClick={() => onChange({ view: "expertProgress" })}>专家跟进 {expertProgressCount}</button>
        <button type="button" className={`rounded-md px-2.5 py-1.5 text-sm font-semibold ${values.view === "ordered" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-white"}`} onClick={() => onChange({ view: "ordered" })}>已开单 {orderedCount}</button>
        <button type="button" className={`rounded-md px-2.5 py-1.5 text-sm font-semibold ${values.view === "left" ? "bg-rose-600 text-white" : "text-slate-600 hover:bg-white"}`} onClick={() => onChange({ view: "left" })}>已退群 {leftCount}{earlyLeftCount ? ` · 异常 ${earlyLeftCount}` : ""}</button>
        <span className="ml-2 whitespace-nowrap text-xs text-slate-500">当前显示 {filteredCount} 人</span>
      </div>
      <form className="ml-3 flex min-w-0 flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); onSearchSubmit(); }}>
        <input aria-label="搜索群客户" value={values.search} onChange={(event) => onChange({ search: event.target.value })} placeholder="搜索号码或姓名" className="w-56 max-w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm" />
        <select aria-label="筛选接粉人员" value={values.member} onChange={(event) => onChange({ member: event.target.value })} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"><option value="">全部接粉</option>{members.map((name) => <option key={name}>{name}</option>)}</select>
        <button type="submit" className="rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50">搜索</button>
      </form>
    </div>
    <details className="mt-2 text-sm">
      <summary className="w-fit cursor-pointer select-none text-slate-500 hover:text-slate-800">更多筛选</summary>
      <div className="mt-2 flex flex-wrap gap-2">
        <select aria-label="筛选专家阶段" value={values.expertStage} onChange={(event) => onChange({ expertStage: event.target.value as GroupCustomerExpertStageFilter })} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"><option value="">全部专家阶段</option><option value="QUEUED">排队中</option><option value="MATERIALS">交资料</option><option value="TRACKING">追踪中</option><option value="PENDING_REGISTRATION">待注册</option><option value="PENDING_ORDER">待开单</option><option value="DECLINED_DEPOSIT">不愿充</option><option value="ORDERED">已开单</option><option value="STALLED">杀不动</option></select>
        <select aria-label="筛选群状态" value={values.stage} onChange={(event) => onChange({ stage: event.target.value as GroupCustomerStatusFilter })} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"><option value="">全部群状态</option><option value="IN_GROUP_PENDING_EXPERT">在群 · 待推专家</option><option value="LEFT">已退群</option></select>
        <select aria-label="筛选渠道" value={values.channel} onChange={(event) => onChange({ channel: event.target.value })} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"><option value="">全部渠道</option>{channels.map((name) => <option key={name}>{name}</option>)}</select>
        {values.view === "left" ? <select aria-label="筛选退群时间" value={values.leaveRisk} onChange={(event) => onChange({ leaveRisk: event.target.value as GroupCustomerFilterValues["leaveRisk"] })} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"><option value="">全部退群时间</option><option value="EARLY">1–8天异常退群</option><option value="WATCH">9–13天观察退群</option><option value="NORMAL">14天起正常退群</option><option value="UNKNOWN">日期待核对</option></select> : null}
        {values.view === "left" ? <select aria-label="筛选退群开单结果" value={values.leaveOrder} onChange={(event) => onChange({ leaveOrder: event.target.value as GroupCustomerFilterValues["leaveOrder"] })} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"><option value="">全部开单结果</option><option value="ordered">已开单退群</option><option value="not-ordered">未开单退群</option></select> : null}
      </div>
    </details>
  </div>;
}
