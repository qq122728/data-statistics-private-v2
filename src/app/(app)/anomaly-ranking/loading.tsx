export default function MemberOverviewLoading() {
  return <main className="page-shell space-y-4"><div className="page-heading"><div><h1 className="page-title">组员数据总览</h1><p className="page-description">公共筛选和摘要已保留，正在读取当前页签。</p></div></div><section role="status" aria-live="polite" aria-busy="true" className="panel p-4"><span className="sr-only">正在加载组员列表</span><div className="space-y-3">{Array.from({ length: 8 }, (_, index) => <div key={index} data-skeleton="true" className="page-loading-skeleton h-12" />)}</div></section></main>;
}
