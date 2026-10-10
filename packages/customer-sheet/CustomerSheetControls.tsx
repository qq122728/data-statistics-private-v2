"use client";

import MonthDaySelect from "./MonthDaySelect";
import styles from "./CustomerSheet.module.css";
import type { SheetPayload } from "./schema";
import { previousDate } from "./date-groups";

type View = "pending" | "group" | "expert";

type ToolbarProps = {
  groups: { id: string; name: string }[];
  groupId: string;
  addingRow: boolean;
  busy: boolean;
  cellSaves: number;
  view: string;
  showStatistics: boolean;
  responsibility: string;
  assignee: string;
  mine: boolean;
  members: SheetPayload["members"];
  actorId?: string;
  referenceNames?: SheetPayload["referenceNames"];
  trash: boolean;
  query: string;
  navigationBusy: boolean;
  payloadReady: boolean;
  status: string;
  statusOptions: string[];
  canConfigure: boolean;
  canCreate: boolean;
  combined: boolean;
  roomy: boolean;
  onView: (view: View) => void;
  onStatistics: () => void;
  onGroup: (groupId: string) => void;
  onResponsibility: (responsibility: string) => void;
  onAssignee: (assignee: string) => void;
  onTrash: () => void;
  onQuery: (query: string) => void;
  onFind: () => void;
  onStatus: (status: string) => void;
  onColumns: () => void;
  onCombined: () => void;
  onRoomy: () => void;
  onImport: () => void;
  onNew: () => void;
};

export function CustomerSheetToolbar(props: ToolbarProps) {
  return <div className={styles.toolbar}>
    <div className={styles.viewControls}>
      <nav className={styles.tabs} aria-label="跟进视图">
        <button disabled={props.addingRow || props.busy} data-active={!props.showStatistics && props.view === "pending"} onClick={() => props.onView("pending")}>添加数据</button>
        <button data-active={!props.showStatistics && props.view === "group"} onClick={() => props.onView("group")}>在群跟进</button>
        <button data-active={!props.showStatistics && props.view === "expert"} onClick={() => props.onView("expert")}>专家跟进</button>
        <button data-active={props.showStatistics} onClick={props.onStatistics}>号码统计</button>
      </nav>
      <div className={styles.ownerControls}>
        {props.groups.length > 1 && <select aria-label="小组" disabled={props.addingRow || props.busy} value={props.groupId} onChange={event => props.onGroup(event.target.value)}>{props.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select>}
        <div className={styles.scope}>
          <select aria-label="负责人类型" value={props.responsibility} onChange={event => props.onResponsibility(event.target.value)}><option value="owner">接粉负责人</option><option value="operator">群内负责人</option><option value="expert">专家负责人</option></select>
          <select aria-label="负责人筛选" value={props.mine ? props.assignee : "all"} onChange={event => props.onAssignee(event.target.value)}>
            <option value="me">我自己</option><option value="all">全组人员</option>
            {props.mine && props.assignee !== "me" && props.assignee !== "all" && !props.members.some(member => member.id === props.assignee) && <option value={props.assignee}>{props.referenceNames?.[props.assignee] || "原接粉负责人"}</option>}
            {props.members.filter(member => member.id !== props.actorId).map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </div>
        <button disabled={props.busy || props.cellSaves > 0 || props.addingRow} data-active={props.trash} onClick={props.onTrash}>{props.trash ? "返回客户" : "已删除"}</button>
      </div>
    </div>
    <div className={styles.filterControls}>
      <input className={styles.search} aria-label="搜索客户" placeholder="搜索完整号码、尾号四位、编号、姓名或备注" value={props.query} onChange={event => props.onQuery(event.target.value)} />
      <button className={styles.finderLaunch} disabled={props.navigationBusy || !props.payloadReady} onClick={props.onFind}>找号码 · 全部进度</button>
      <select disabled={props.trash} aria-label="筛选状态" value={props.status} onChange={event => props.onStatus(event.target.value)}><option value="">全部状态</option>{props.statusOptions.map(status => <option key={status}>{status}</option>)}</select>
      <details className={styles.tableSettings}><summary>表格设置</summary><div>
        <button onClick={props.onColumns} disabled={!props.payloadReady}>显示列{props.canConfigure ? " / 自定义" : ""}</button>
        <button onClick={props.onCombined}>{props.combined ? "逐列模式" : "整合模式"}</button>
        <button aria-pressed={props.roomy} onClick={props.onRoomy}>行高：{props.roomy ? "宽松" : "紧凑"}</button>
      </div></details>
      {props.canCreate && !props.trash && <><button className={styles.primary} onClick={props.onImport}>{props.view === "pending" ? "导入号码" : "导入客户"}</button><button disabled={props.addingRow || props.busy} onClick={props.onNew}>＋ 新增一行</button></>}
    </div>
  </div>;
}

type DateToolbarProps = {
  label: string;
  range: string;
  from: string;
  to: string;
  today?: string;
  combined: boolean;
  disabled: boolean;
  onRange: (range: string, date: string) => void;
  onFrom: (date: string) => void;
  onTo: (date: string) => void;
  onExpand: () => void;
  onCollapse: () => void;
};

export function CustomerDateToolbar(props: DateToolbarProps) {
  return <div className={styles.dateToolbar} aria-label="客户日期筛选">
    <strong>{props.label}</strong>
    {[["all", "全部"], ["today", "今天"], ["yesterday", "昨天"], ["custom", "自定义"]].map(([value, label]) => <button key={value} data-active={props.range === value} disabled={props.disabled} onClick={() => props.onRange(value, value === "today" ? props.today || "" : value === "yesterday" && props.today ? previousDate(props.today) : "")}>{label}</button>)}
    {props.range === "custom" && <><MonthDaySelect label={`${props.label}开始`} value={props.from} onChange={props.onFrom} /><span>至</span><MonthDaySelect label={`${props.label}结束`} value={props.to} onChange={props.onTo} /></>}
    <span className={styles.dateHint}>日期从新到旧 · 同日按编号排列{props.combined ? " · 表格可左右滚动" : ""}</span>
    <button onClick={props.onExpand}>展开本页</button><button onClick={props.onCollapse}>收起本页</button>
  </div>;
}
