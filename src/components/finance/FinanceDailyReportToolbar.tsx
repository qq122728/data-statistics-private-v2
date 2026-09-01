"use client";

import { useMemo, useState } from "react";
import { ArrowsClockwise, DownloadSimple } from "@phosphor-icons/react";
import { localDateYYYYMMDD } from "../../lib/dates";

type GroupOption = { id: string; name: string; timezone: string };

export function FinanceDailyReportToolbar({
  groups,
  initialGroupId,
  initialDate,
  fallbackTimezone,
  canSelectGroup,
}: {
  groups: GroupOption[];
  initialGroupId: string;
  initialDate: string;
  fallbackTimezone: string;
  canSelectGroup: boolean;
}) {
  const [groupId, setGroupId] = useState(initialGroupId);
  const [date, setDate] = useState(initialDate);
  const timezone = useMemo(
    () => groups.find((group) => group.id === groupId)?.timezone ?? fallbackTimezone,
    [fallbackTimezone, groupId, groups],
  );
  const exportUrl = new URLSearchParams({ date, ...(groupId ? { groupId } : {}) });

  function changeGroup(nextGroupId: string) {
    setGroupId(nextGroupId);
    const nextTimezone = groups.find((group) => group.id === nextGroupId)?.timezone ?? fallbackTimezone;
    setDate(localDateYYYYMMDD(new Date(), nextTimezone));
  }

  return <form className="flex flex-wrap items-end gap-2" action="/finance-reports">
    <label className="field-label">报表日期
      <input className="control" name="date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
    </label>
    {canSelectGroup && <label className="field-label">小组
      <select className="control min-w-40" name="groupId" value={groupId} onChange={(event) => changeGroup(event.target.value)}>
        <option value="">全部小组</option>
        {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select>
    </label>}
    <span className="rounded-full bg-white px-3 py-2 text-xs font-medium text-blue-700">按 {timezone} 切日</span>
    <button className="report-toolbar-button finance-report-refresh" type="submit"><ArrowsClockwise size={16} weight="bold" aria-hidden="true" />更新日期</button>
    <a className="report-toolbar-button report-toolbar-primary finance-report-export" href={`/api/exports/member-daily?${exportUrl.toString()}`}><DownloadSimple size={17} weight="bold" aria-hidden="true" />导出日报 Excel</a>
  </form>;
}
