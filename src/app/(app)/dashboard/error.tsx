"use client";

import { AnalysisErrorState } from "../../../components/analytics/AnalysisState";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="page-shell"><AnalysisErrorState onReload={reset} /></main>;
}
