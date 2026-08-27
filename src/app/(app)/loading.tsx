import React from "react";

const skeletonRows = ["row-1", "row-2", "row-3", "row-4", "row-5"];
const metricCards = ["metric-1", "metric-2", "metric-3", "metric-4"];

function Skeleton({ className }: { className: string }) {
  return <div data-skeleton className={`page-loading-skeleton ${className}`} />;
}

export default function AppPageLoading() {
  return <main className="page-shell space-y-4" role="status" aria-live="polite" aria-busy="true">
    <span className="sr-only">正在加载页面</span>
    <div className="page-heading">
      <div className="w-full max-w-md space-y-3">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-full max-w-sm" />
      </div>
    </div>
    <section className="toolbar min-h-20" aria-hidden="true">
      <Skeleton className="h-10 w-44" />
      <Skeleton className="h-10 w-44" />
      <Skeleton className="h-10 w-52" />
      <Skeleton className="h-10 w-24" />
    </section>
    <section className="management-metric-grid metric-grid" aria-hidden="true">
      {metricCards.map((card) => <div key={card} className="metric-card space-y-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-3 w-32 max-w-full" />
      </div>)}
    </section>
    <section className="panel overflow-hidden" aria-hidden="true">
      <div className="panel-header">
        <div className="w-full max-w-xs space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
      <div className="divide-y divide-[#edf0f4] px-4">
        {skeletonRows.map((row) => <div key={row} className="grid min-h-14 grid-cols-[1.2fr_1fr_1fr_.7fr] items-center gap-5">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>)}
      </div>
    </section>
  </main>;
}
