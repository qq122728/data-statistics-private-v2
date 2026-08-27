"use client";

import type { HistoryGroup } from "../../lib/history-groups";
import type { AnalysisFilters } from "../../lib/analytics/types";
import { HistoryGroupList } from "./HistoryGroupList";
import type { HistoryBatch, HistoryRole } from "./history-display";

export type { HistoryBatch, HistoryRole } from "./history-display";

export function EventHistoryTable({
  groups,
  batches,
  currentUser,
  initialFilters,
  onEdit,
}: {
  groups: HistoryGroup[];
  batches: HistoryBatch[];
  currentUser: { id: string; role: HistoryRole };
  initialFilters?: Partial<AnalysisFilters>;
  onEdit?: (group: HistoryGroup, trigger: HTMLButtonElement) => void;
}) {
  return <HistoryGroupList groups={groups} batches={batches} currentUser={currentUser} initialFilters={initialFilters} onEdit={onEdit} />;
}
