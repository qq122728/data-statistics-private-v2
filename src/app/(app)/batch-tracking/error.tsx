"use client";

import { AnalysisErrorState } from "../../../components/analytics/AnalysisState";

export default function BatchTrackingError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="page-shell"><AnalysisErrorState onReload={reset} /></main>;
}
