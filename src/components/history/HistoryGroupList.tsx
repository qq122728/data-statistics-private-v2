"use client";

import { FunnelSimple, X } from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { compareHistoryGroups } from "../../lib/history-group-order";
import { normalizeChannelName } from "../../lib/channel-names";
import type { AnalysisFilters } from "../../lib/analytics/types";
import type { HistoryGroup } from "../../lib/history-groups";
import { HistoryEditDrawer } from "./HistoryEditDrawer";
import { HistoryGroupRow } from "./HistoryGroupRow";
import {
  historyChannelKey,
  historyChannelLabel,
  type HistoryBatch,
  type HistoryRole,
} from "./history-display";

type CurrentUser = { id: string; role: HistoryRole };

export function HistoryGroupList({
  groups,
  batches,
  currentUser,
  initialFilters = {},
  onEdit,
}: {
  groups: HistoryGroup[];
  batches: HistoryBatch[];
  currentUser: CurrentUser;
  initialFilters?: Partial<AnalysisFilters>;
  onEdit?: (group: HistoryGroup, trigger: HTMLButtonElement) => void;
}) {
  const [occurredOn, setOccurredOn] = useState("");
  const [sourceDate, setSourceDate] = useState(initialFilters.sourceDateFrom === initialFilters.sourceDateTo ? initialFilters.sourceDateFrom ?? "" : "");
  const [selectedChannel, setSelectedChannel] = useState("");
  const [enteredById, setEnteredById] = useState(initialFilters.memberId ?? "");
  const [sourceDateFrom, setSourceDateFrom] = useState(initialFilters.sourceDateFrom ?? "");
  const [sourceDateTo, setSourceDateTo] = useState(initialFilters.sourceDateTo ?? "");
  const [normalizedName, setNormalizedName] = useState(initialFilters.normalizedName ? normalizeChannelName(initialFilters.normalizedName) : "");
  const [localGroups, setLocalGroups] = useState(groups);
  const [selectedGroup, setSelectedGroup] = useState<HistoryGroup | null>(null);
  const [notice, setNotice] = useState("");
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);

  const channels = useMemo(() => Array.from(new Map(localGroups.map((group) => [
    historyChannelKey(group),
    { key: historyChannelKey(group), label: historyChannelLabel(group), active: group.batch.channel.active && group.batch.group.active },
  ])).values()), [localGroups]);
  const members = useMemo(() => Array.from(new Map(localGroups.map((group) => [group.enteredBy.id, group.enteredBy])).values()), [localGroups]);
  const filteredGroups = localGroups.filter((group) =>
    (!occurredOn || group.occurredOn === occurredOn)
    && (!sourceDate || group.sourceDate === sourceDate)
    && (!sourceDateFrom || group.sourceDate >= sourceDateFrom)
    && (!sourceDateTo || group.sourceDate <= sourceDateTo)
    && (!normalizedName || normalizeChannelName(group.batch.channel.normalizedName ?? group.batch.channel.name) === normalizedName)
    && (!selectedChannel || historyChannelKey(group) === selectedChannel)
    && (!enteredById || group.enteredBy.id === enteredById));
  const hasFilters = Boolean(occurredOn || sourceDate || sourceDateFrom || sourceDateTo || normalizedName || selectedChannel || enteredById);
  const hasInitialFilters = Boolean(initialFilters.sourceDateFrom || initialFilters.sourceDateTo || initialFilters.normalizedName || initialFilters.memberId);

  function clear() {
    setOccurredOn("");
    setSourceDate("");
    setSourceDateFrom("");
    setSourceDateTo("");
    setNormalizedName("");
    setSelectedChannel("");
    setEnteredById("");
  }

  function edit(group: HistoryGroup, trigger: HTMLButtonElement) {
    if (group.enteredBy.id !== currentUser.id) return;
    editTriggerRef.current = trigger;
    setNotice("");
    setSelectedGroup(group);
    onEdit?.(group, trigger);
  }

  function closeEditor() {
    setSelectedGroup(null);
    window.requestAnimationFrame(() => editTriggerRef.current?.focus());
  }

  function replaceGroup(updatedGroup: HistoryGroup) {
    if (!selectedGroup) return;
    setLocalGroups((current) => current
      .map((group) => group.key === selectedGroup.key ? updatedGroup : group)
      .sort(compareHistoryGroups));
    setSelectedGroup(null);
    setNotice("历史数据已更新");
    window.requestAnimationFrame(() => editTriggerRef.current?.focus());
  }

  return <>
    <div className="history-filter-bar">
      <div className="history-filter-label"><FunnelSimple size={17} aria-hidden="true" />筛选</div>
      <label className="history-filter-field"><span>发生日期</span><input aria-label="发生日期" type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} className="control" /></label>
      <label className="history-filter-field"><span>来源日期</span><input aria-label="来源日期" type="date" value={sourceDate} onChange={(event) => setSourceDate(event.target.value)} className="control" /></label>
      <label className="history-filter-field"><span>渠道 · 小组</span><select aria-label="渠道 · 小组" value={selectedChannel} onChange={(event) => setSelectedChannel(event.target.value)} className="control min-w-40">
        <option value="">全部渠道</option>
        {channels.map((channel) => <option key={channel.key} value={channel.key}>{channel.label}{!channel.active ? "（已停用）" : ""}</option>)}
      </select></label>
      {currentUser.role !== "RECEPTION" ? <label className="history-filter-field"><span>成员</span><select aria-label="成员" value={enteredById} onChange={(event) => setEnteredById(event.target.value)} className="control min-w-36">
        <option value="">全部成员</option>
        {members.map((member) => <option key={member.id} value={member.id}>{member.name}{!member.active ? "（已停用）" : ""}</option>)}
      </select></label> : null}
      {sourceDateFrom !== sourceDateTo ? <span className="history-filter-scope">来源范围：{sourceDateFrom || "最早"} 至 {sourceDateTo || "最近"}</span> : null}
      {normalizedName ? <span className="analysis-status" data-tone="neutral">渠道：{initialFilters.normalizedName?.trim() || normalizedName}</span> : null}
      <span className="history-filter-count">共 {filteredGroups.length} 条</span>
      {hasFilters ? hasInitialFilters
        ? <a href="/history" className="history-filter-clear"><X size={14} aria-hidden="true" />清除</a>
        : <button onClick={clear} type="button" className="history-filter-clear"><X size={14} aria-hidden="true" />清除</button> : null}
    </div>
    <div className="history-records panel">
      <div className="history-records-head" aria-hidden="true"><span>来源日期</span><span>渠道 / 小组</span><span>数据摘要</span><span>录入人</span><span>操作</span></div>
      {filteredGroups.length ? <div>{filteredGroups.map((group) => <HistoryGroupRow key={group.key} group={group} currentUserId={currentUser.id} onEdit={edit} />)}</div> : <div className="empty-state">没有符合条件的历史记录</div>}
    </div>
    {notice ? <p role="status" className="fixed bottom-5 right-5 z-40 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 shadow-lg">{notice}</p> : null}
    {selectedGroup ? <HistoryEditDrawer key={selectedGroup.key} group={selectedGroup} batches={batches} onClose={closeEditor} onSaved={replaceGroup} /> : null}
  </>;
}
