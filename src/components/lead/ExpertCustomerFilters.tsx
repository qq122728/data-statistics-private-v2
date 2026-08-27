export type ExpertCustomerTab = "queued" | "materials" | "tracking" | "registration" | "order" | "noInitialDeposit" | "ordered" | "stalled";

export function ExpertCustomerFilters({ tab, search, member, members, queuedCount, materialsCount, trackingCount, pendingRegistrationCount, pendingOrderCount, noInitialDepositCount, orderedCount, stalledCount, filteredCount, onTab, onSearch, onMember, onSearchSubmit }: {
  tab: ExpertCustomerTab;
  search: string;
  member: string;
  members: string[];
  queuedCount: number;
  materialsCount: number;
  trackingCount: number;
  pendingRegistrationCount: number;
  pendingOrderCount: number;
  noInitialDepositCount: number;
  orderedCount: number;
  stalledCount: number;
  filteredCount: number;
  onTab: (tab: ExpertCustomerTab) => void;
  onSearch: (value: string) => void;
  onMember: (value: string) => void;
  onSearchSubmit: () => void;
}) {
  return <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
    <div role="tablist" aria-label="专家客户阶段" className="flex items-center gap-1">
      <button type="button" className={`rounded-md px-2.5 py-1.5 text-sm font-semibold ${tab === "queued" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-white"}`} onClick={() => onTab("queued")}>排队中 {queuedCount}</button>
      <button type="button" className={`rounded-md px-2.5 py-1.5 text-sm font-semibold ${tab === "materials" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-white"}`} onClick={() => onTab("materials")}>交资料 {materialsCount}</button>
      <button type="button" className={`rounded-md px-2.5 py-1.5 text-sm font-semibold ${tab === "tracking" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-white"}`} onClick={() => onTab("tracking")}>追踪中 {trackingCount}</button>
      <button type="button" className={`rounded-md px-2.5 py-1.5 text-sm font-semibold ${tab === "registration" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-white"}`} onClick={() => onTab("registration")}>待注册 {pendingRegistrationCount}</button>
      <button type="button" className={`rounded-md px-2.5 py-1.5 text-sm font-semibold ${tab === "order" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-white"}`} onClick={() => onTab("order")}>待开单 {pendingOrderCount}</button>
      <button type="button" className={`rounded-md px-2.5 py-1.5 text-sm font-semibold ${tab === "noInitialDeposit" ? "bg-orange-600 text-white" : "text-slate-600 hover:bg-white"}`} onClick={() => onTab("noInitialDeposit")}>不愿充 {noInitialDepositCount}</button>
      <button type="button" className={`rounded-md px-2.5 py-1.5 text-sm font-semibold ${tab === "ordered" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-white"}`} onClick={() => onTab("ordered")}>已开单 {orderedCount}</button>
      <button type="button" className={`rounded-md px-2.5 py-1.5 text-sm font-semibold ${tab === "stalled" ? "bg-rose-600 text-white" : "text-slate-600 hover:bg-white"}`} onClick={() => onTab("stalled")}>杀不动 {stalledCount}</button>
      <span className="ml-2 whitespace-nowrap text-xs text-slate-500">当前显示 {filteredCount} 人</span>
    </div>
    <form className="ml-3 flex min-w-0 flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); onSearchSubmit(); }}>
      <input aria-label="搜索专家客户" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索号码或姓名" className="w-56 max-w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm" />
      <select aria-label="筛选专家人员" value={member} onChange={(event) => onMember(event.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"><option value="">全部专家</option>{members.map((name) => <option key={name}>{name}</option>)}</select>
      <button type="submit" className="rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50">搜索</button>
    </form>
  </div>;
}
