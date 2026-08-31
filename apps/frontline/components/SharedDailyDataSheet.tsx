"use client";

import { useMemo, useState } from "react";

export type DailyPosition = "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";

type Metric = {
  key: string;
  label: string;
  kind?: "number" | "money" | "rate" | "computed";
  tone?: "bad" | "ok";
};

const POSITION_LABEL: Record<DailyPosition, string> = { RECEPTION: "接粉", GROUP_OPERATOR: "炒群", EXPERT: "专家" };
const MEMBERS: Record<DailyPosition, string[]> = {
  RECEPTION: ["前台接粉 A", "前台接粉 B", "小七", "牛少", "安强", "初一"],
  GROUP_OPERATOR: ["前台炒群 A", "前台炒群 B", "金水", "阿彪", "毛泰"],
  EXPERT: ["A组组长", "前台专家 A", "名将", "黑八", "阿阳"],
};
const METRICS: Record<DailyPosition, Metric[]> = {
  RECEPTION: [
    { key: "dispatch", label: "总下发粉" }, { key: "duplicate", label: "撞粉", tone: "bad" },
    { key: "lowAmount", label: "低金额", tone: "bad" }, { key: "noWs", label: "无 WS", tone: "bad" },
    { key: "effective", label: "有效粉", kind: "computed", tone: "ok" }, { key: "reply", label: "回复" },
    { key: "join", label: "进群" }, { key: "replyRate", label: "回复率", kind: "rate" },
    { key: "joinRate", label: "进群率", kind: "rate" },
  ],
  GROUP_OPERATOR: [
    { key: "received", label: "接手/进群" }, { key: "normalLeave", label: "正常退群", tone: "bad" },
    { key: "abnormalLeave", label: "异常退群", tone: "bad" }, { key: "current", label: "当前在群", kind: "computed", tone: "ok" },
    { key: "introduced", label: "推专家" }, { key: "leaveRate", label: "退群率", kind: "rate" },
    { key: "introducedRate", label: "推专家率", kind: "rate" },
  ],
  EXPERT: [
    { key: "received", label: "接手客户" }, { key: "contacted", label: "已联系" },
    { key: "registered", label: "注册" }, { key: "ordered", label: "开单" },
    { key: "cryptoDeposit", label: "加密货币首充", kind: "money", tone: "ok" },
    { key: "bankDeposit", label: "银行卡首充", kind: "money", tone: "ok" },
    { key: "recharge", label: "续充", kind: "money", tone: "ok" },
    { key: "withdrawal", label: "出金", kind: "money", tone: "bad" },
    { key: "registrationRate", label: "注册率", kind: "rate" }, { key: "orderRate", label: "开单率", kind: "rate" },
  ],
};

const BASE_VALUES: Record<DailyPosition, number[][]> = {
  RECEPTION: [
    [42, 3, 2, 1, 0, 14, 7], [35, 2, 1, 2, 0, 11, 6], [31, 1, 2, 0, 0, 9, 5],
    [28, 2, 0, 1, 0, 8, 3], [25, 0, 1, 2, 0, 7, 4], [19, 1, 0, 1, 0, 5, 2],
  ],
  GROUP_OPERATOR: [
    [18, 2, 1, 0, 7, 0, 0], [16, 1, 1, 0, 6, 0, 0], [21, 2, 0, 0, 8, 0, 0],
    [14, 1, 2, 0, 4, 0, 0], [12, 0, 1, 0, 5, 0, 0],
  ],
  EXPERT: [
    [9, 7, 4, 2, 1800, 0, 500, 0, 0, 0], [12, 9, 5, 3, 2500, 800, 300, 0, 0, 0],
    [8, 6, 3, 1, 1200, 0, 0, 0, 0, 0], [11, 8, 4, 2, 2000, 500, 600, 200, 0, 0],
    [7, 6, 2, 1, 800, 0, 200, 0, 0, 0],
  ],
};

function localToday() {
  return new Intl.DateTimeFormat("en-CA").format(new Date());
}

function withCurrentMember(position: DailyPosition, currentName: string) {
  const members = MEMBERS[position];
  if (members.includes(currentName)) return members;
  return [currentName, ...members.slice(1)];
}

function formula(position: DailyPosition, metric: string, values: Record<string, number>) {
  if (metric === "effective") return Math.max(0, (values.dispatch ?? 0) - (values.duplicate ?? 0) - (values.lowAmount ?? 0) - (values.noWs ?? 0));
  if (metric === "current") return Math.max(0, (values.received ?? 0) - (values.normalLeave ?? 0) - (values.abnormalLeave ?? 0));
  if (metric === "replyRate") return values.effective ? (values.reply ?? 0) / values.effective * 100 : 0;
  if (metric === "joinRate") return values.effective ? (values.join ?? 0) / values.effective * 100 : 0;
  if (metric === "leaveRate") return values.received ? ((values.normalLeave ?? 0) + (values.abnormalLeave ?? 0)) / values.received * 100 : 0;
  if (metric === "introducedRate") return values.received ? (values.introduced ?? 0) / values.received * 100 : 0;
  if (metric === "registrationRate") return values.received ? (values.registered ?? 0) / values.received * 100 : 0;
  if (metric === "orderRate") return values.received ? (values.ordered ?? 0) / values.received * 100 : 0;
  return values[metric] ?? 0;
}

function initialGrid(position: DailyPosition, members: string[]) {
  const metrics = METRICS[position];
  return Object.fromEntries(members.map((member, memberIndex) => {
    const raw = BASE_VALUES[position][memberIndex] ?? [];
    const values: Record<string, number> = {};
    metrics.forEach((metric, metricIndex) => { values[metric.key] = raw[metricIndex] ?? 0; });
    values.effective = formula(position, "effective", values);
    values.current = formula(position, "current", values);
    return [member, values];
  }));
}

export function SharedDailyDataSheet({
  currentName,
  initialPosition,
  availablePositions,
  editablePositions = availablePositions,
  leadView = false,
}: {
  currentName: string;
  initialPosition: DailyPosition;
  availablePositions: DailyPosition[];
  editablePositions?: DailyPosition[];
  leadView?: boolean;
}) {
  const [position, setPosition] = useState(initialPosition);
  const [date, setDate] = useState(localToday());
  const [channel, setChannel] = useState("FB-M");
  const [saved, setSaved] = useState(false);
  const [editingHistory, setEditingHistory] = useState(false);
  const [reason, setReason] = useState("");
  const members = useMemo(() => leadView && position !== "EXPERT" ? MEMBERS[position] : withCurrentMember(position, currentName), [currentName, leadView, position]);
  const [grids, setGrids] = useState<Record<DailyPosition, Record<string, Record<string, number>>>>(() => ({
    RECEPTION: initialGrid("RECEPTION", withCurrentMember("RECEPTION", initialPosition === "RECEPTION" ? currentName : MEMBERS.RECEPTION[0])),
    GROUP_OPERATOR: initialGrid("GROUP_OPERATOR", withCurrentMember("GROUP_OPERATOR", initialPosition === "GROUP_OPERATOR" ? currentName : MEMBERS.GROUP_OPERATOR[0])),
    EXPERT: initialGrid("EXPERT", withCurrentMember("EXPERT", initialPosition === "EXPERT" ? currentName : MEMBERS.EXPERT[0])),
  }));
  const metrics = METRICS[position];
  const grid = grids[position];

  function memberValues(member: string) {
    const values = grid[member] ?? {};
    const effective = formula(position, "effective", values);
    const current = formula(position, "current", values);
    return { ...values, effective, current };
  }

  function setValue(member: string, key: string, value: number) {
    setGrids((current) => ({ ...current, [position]: { ...current[position], [member]: { ...(current[position][member] ?? {}), [key]: Math.max(0, value) } } }));
    setSaved(false);
  }

  function canEdit(member: string, metric: Metric) {
    return editablePositions.includes(position) && member === currentName && metric.kind !== "computed" && metric.kind !== "rate";
  }

  const totals = Object.fromEntries(metrics.map((metric) => {
    if (metric.kind === "rate") {
      const values = Object.fromEntries(metrics.filter((item) => item.kind !== "rate").map((item) => [item.key, members.reduce((sum, member) => sum + formula(position, item.key, memberValues(member)), 0)]));
      return [metric.key, formula(position, metric.key, values)];
    }
    return [metric.key, members.reduce((sum, member) => sum + formula(position, metric.key, memberValues(member)), 0)];
  }));

  function display(value: number, metric: Metric) {
    if (metric.kind === "rate") return `${value.toFixed(1)}%`;
    if (metric.kind === "money") return `$${value.toLocaleString()}`;
    return String(Math.round(value));
  }

  const isHistorical = date < localToday();
  const monthMultiplier = 18;

  return <section className="daily-sheet-prototype">
    <div className="daily-sheet-prototype__hero card">
      <div><span className="daily-sheet-prototype__kicker">共享每日数据表 · 原型</span><h2>每个人填写自己的列，合计和比例系统计算</h2><p>这是独立统计账，与客户进度互不影响。白色输入框可填写，浅色格由系统自动计算。</p></div>
      <div className="daily-sheet-prototype__identity"><span>当前登录</span><strong>{currentName}</strong><small>{leadView ? "组长 · 可查看整组" : `${POSITION_LABEL[position]} · 仅编辑自己的列`}</small></div>
    </div>

    <div className="daily-sheet-prototype__controls card">
      <div className="daily-sheet-prototype__positions">{availablePositions.map((item) => <button key={item} data-active={position === item} onClick={() => setPosition(item)}>{POSITION_LABEL[item]}数据</button>)}</div>
      <label>统计日期<input className="field" type="date" max={localToday()} value={date} onChange={(event) => { setDate(event.target.value); setEditingHistory(event.target.value < localToday()); setSaved(false); }} /></label>
      <label>渠道<select className="field" value={channel} onChange={(event) => setChannel(event.target.value)}><option>FB-M</option><option>FB-Q</option><option>短信粉嘉豪</option><option>德国投流 B</option></select></label>
      <span className="badge" data-tone={isHistorical ? "warn" : "ok"}>{isHistorical ? "历史数据 · 修改需原因" : "今日数据"}</span>
    </div>

    <div className="daily-sheet-prototype__section card">
      <div className="daily-sheet-prototype__section-head"><div><h3>本月累计</h3><p>{date.slice(0, 7)} · {channel} · 根据每天手工填写的数据累计</p></div><span>只读</span></div>
      <SheetGrid position={position} metrics={metrics} members={members} getValues={memberValues} totals={totals} multiplier={monthMultiplier} display={display} />
    </div>

    <div className="daily-sheet-prototype__section card" data-entry>
      <div className="daily-sheet-prototype__section-head"><div><h3>{date} 每日录入</h3><p>每个员工只填写自己的列；组长与资源部看到的是同一张表。</p></div><div className="daily-sheet-prototype__legend"><i data-kind="editable" />本人填写 <i data-kind="formula" />系统计算 <i data-kind="locked" />他人数据</div></div>
      <div className="daily-sheet-prototype__scroll"><table className="daily-sheet-prototype__grid">
        <thead><tr><th>数据指标</th><th>总计</th>{members.map((member) => <th key={member} data-self={member === currentName}>{member}<small>{member === currentName ? "我的列" : "已保存"}</small></th>)}</tr></thead>
        <tbody>{metrics.map((metric) => <tr key={metric.key} data-tone={metric.tone}>
          <th>{metric.label}{metric.kind === "computed" || metric.kind === "rate" ? <small>系统计算</small> : null}</th>
          <td className="daily-sheet-prototype__total">{display(totals[metric.key] ?? 0, metric)}</td>
          {members.map((member) => {
            const value = formula(position, metric.key, memberValues(member));
            const editable = canEdit(member, metric);
            return <td key={member} data-self={member === currentName} data-formula={metric.kind === "computed" || metric.kind === "rate"}>
              {editable ? <label className="daily-sheet-prototype__input">{metric.kind === "money" ? <span>$</span> : null}<input aria-label={`${member}-${metric.label}`} type="number" min="0" step={metric.kind === "money" ? "0.01" : "1"} value={grid[member]?.[metric.key] ?? 0} onChange={(event) => setValue(member, metric.key, Number(event.target.value))} /></label> : <span>{display(value, metric)}</span>}
            </td>;
          })}
        </tr>)}</tbody>
      </table></div>
      {editingHistory ? <div className="daily-sheet-prototype__reason"><label><span>历史更正原因</span><input className="field" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：8 月 29 日回复数少填 1 人" /></label><small>保存后会记录修改前数字、修改后数字、操作人和时间。</small></div> : null}
      <div className="daily-sheet-prototype__save"><span>{saved ? "✓ 已保存，资源部刷新后可以直接看到" : "修改只影响每日统计，不会改变客户进度"}</span><button className="btn" data-variant="primary" disabled={isHistorical && !reason.trim()} onClick={() => setSaved(true)}>{saved ? "已保存" : "保存当天数据"}</button></div>
    </div>
  </section>;
}

function SheetGrid({ position, metrics, members, getValues, totals, multiplier, display }: {
  position: DailyPosition; metrics: Metric[]; members: string[]; getValues: (member: string) => Record<string, number>;
  totals: Record<string, number>; multiplier: number; display: (value: number, metric: Metric) => string;
}) {
  return <div className="daily-sheet-prototype__scroll"><table className="daily-sheet-prototype__grid" data-summary>
    <thead><tr><th>数据指标</th><th>总计</th>{members.map((member) => <th key={member}>{member}</th>)}</tr></thead>
    <tbody>{metrics.map((metric) => <tr key={metric.key} data-tone={metric.tone}>
      <th>{metric.label}</th><td className="daily-sheet-prototype__total">{display(metric.kind === "rate" ? totals[metric.key] : totals[metric.key] * multiplier, metric)}</td>
      {members.map((member) => <td key={member}>{display(metric.kind === "rate" ? formula(position, metric.key, getValues(member)) : formula(position, metric.key, getValues(member)) * multiplier, metric)}</td>)}
    </tr>)}</tbody>
  </table></div>;
}
