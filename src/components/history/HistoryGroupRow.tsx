"use client";

import { useId, useState, type MouseEvent } from "react";
import type { HistoryGroup } from "../../lib/history-groups";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import {
  formatHistoryMetric,
  historyChannelLabel,
  historyMetricDisplay,
} from "./history-display";

export function HistoryGroupRow({
  group,
  currentUserId,
  onEdit,
}: {
  group: HistoryGroup;
  currentUserId: string;
  onEdit?: (group: HistoryGroup, trigger: HTMLButtonElement) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const isOwnGroup = group.enteredBy.id === currentUserId;
  const nonzeroMetrics = historyMetricDisplay.filter(({ field }) => group.metrics[field] !== 0);

  function toggle() {
    setExpanded((current) => !current);
  }

  function handleRowClick(event: MouseEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    toggle();
  }

  return <article
    data-testid="history-group-row"
    data-history-group-key={group.key}
    className="border-t border-slate-200 first:border-t-0"
    onClick={handleRowClick}
  >
    <div className="history-record-row">
      <div className="font-semibold text-slate-700">{group.sourceDate}</div>
      <div className="min-w-0">
        <p className="m-0 truncate font-semibold text-slate-900">{historyChannelLabel(group)}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {!group.batch.channel.active ? <Badge>渠道已停用</Badge> : null}
          {!group.batch.group.active ? <Badge>小组已停用</Badge> : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap gap-1">
        {nonzeroMetrics.length ? nonzeroMetrics.map(({ field, label }) => <span key={field} className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-sm text-blue-700">
          <span>{label}</span><strong>{formatHistoryMetric(field, group.metrics[field])}</strong>
        </span>) : <span className="text-sm text-slate-400">各项指标均为 0</span>}
      </div>
      <div className="text-sm text-slate-600">
        <span>{group.enteredBy.name}</span>
        {!group.enteredBy.active ? <Badge className="ml-2">成员已停用</Badge> : null}
      </div>
      <div className="flex items-center justify-end gap-2">
        {isOwnGroup && group.editable ? <Button type="button" variant="secondary" onClick={(event) => onEdit?.(group, event.currentTarget)}>编辑</Button> : <Button type="button" variant="secondary" onClick={toggle}>{expanded ? "收起详情" : "查看详情"}</Button>}
      </div>
    </div>
    {expanded ? <div id={detailsId} className="border-t border-slate-100 bg-slate-50 px-4 py-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {historyMetricDisplay.map(({ field, label }) => <div key={field} data-metric-label={label} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <dt className="text-xs font-medium text-slate-500">{label}</dt>
          <dd className="mt-1 text-base font-semibold text-slate-900">{formatHistoryMetric(field, group.metrics[field])}</dd>
        </div>)}
      </dl>
    </div> : null}
  </article>;
}
