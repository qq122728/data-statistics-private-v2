"use client";

import { AnalysisErrorState } from "../../../components/analytics/AnalysisState";

export default function MemberOverviewError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="page-shell space-y-4"><div className="page-heading"><div><h1 className="page-title">组员数据总览</h1><p className="page-description">筛选条件已保留，重试不会把错误当成 0。</p></div></div><AnalysisErrorState onReload={reset} /></main>;
}
