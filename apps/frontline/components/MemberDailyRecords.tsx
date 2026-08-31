"use client";

import { useEffect, useMemo, useState } from "react";
import { requestJson } from "@/lib/backend";

type Values = {
  dispatchCount: number; duplicateCount: number; lowAmountCount: number; noWsCount: number; manualInvalidCount: number;
  lawyerRealCaseCount: number; lawyerAddedCount: number; lawyerExpertAddedCount: number; customerServicePushCount: number;
  effectiveCount: number; replyCount: number; joinCount: number; normalLeaveCount: number; abnormalLeaveCount: number;
  currentInGroupCount: number; expertIntroCount: number; registrationCount: number; orderCount: number;
  cryptoInitialDepositCents: number; bankInitialDepositCents: number; cryptoRechargeCents: number;
  bankRechargeCents: number; withdrawalCents: number;
};
type UnifiedEntry = {
  entryId: string | null; businessDate: string; status: string;
  channel: { id: string; name: string };
  values: Values;
};
type Context = { groupType: "HACKER" | "LAWYER"; unifiedEntries: UnifiedEntry[] };
type HistoryRow = Values & { key: string; businessDate: string; channelName: string; statuses: string[] };

const EMPTY: Values = {
  dispatchCount: 0, duplicateCount: 0, lowAmountCount: 0, noWsCount: 0, manualInvalidCount: 0,
  lawyerRealCaseCount: 0, lawyerAddedCount: 0, lawyerExpertAddedCount: 0, customerServicePushCount: 0,
  effectiveCount: 0, replyCount: 0, joinCount: 0, normalLeaveCount: 0, abnormalLeaveCount: 0,
  currentInGroupCount: 0, expertIntroCount: 0, registrationCount: 0, orderCount: 0,
  cryptoInitialDepositCents: 0, bankInitialDepositCents: 0, cryptoRechargeCents: 0,
  bankRechargeCents: 0, withdrawalCents: 0,
};

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? `${(numerator / denominator * 100).toFixed(1)}%` : "—";
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(cents / 100);
}

function rowsFrom(entries: UnifiedEntry[]) {
  return entries.map((entry) => ({
    ...EMPTY,
    ...entry.values,
    key: `${entry.businessDate}:${entry.channel.id}`,
    businessDate: entry.businessDate,
    channelName: entry.channel.name,
    statuses: [entry.status],
  })).sort((a, b) => b.businessDate.localeCompare(a.businessDate) || a.channelName.localeCompare(b.channelName));
}

export function MemberDailyRecords({ mode: _mode }: { mode: "history" | "finance" }) {
  const [entries, setEntries] = useState<UnifiedEntry[]>([]);
  const [groupType, setGroupType] = useState<"HACKER" | "LAWYER">("HACKER");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const result = await requestJson<Context>(`/api/daily-stats${params.size ? `?${params}` : ""}`);
      setEntries(result.unifiedEntries);
      setGroupType(result.groupType);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "历史数据读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  const rows = useMemo(() => rowsFrom(entries), [entries]);

  return <div className="member-history">
    <section className="card member-history__toolbar">
      <div><h2>我的历史数据</h2><p>同一天、同一渠道合并为一行，不再按接粉、炒群、专家账号拆开。</p></div>
      <div className="member-history__filters">
        <label><span>开始日期</span><input className="field" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label><span>结束日期</span><input className="field" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <button className="btn" data-variant="primary" onClick={() => void load()} disabled={loading}>{loading ? "查询中…" : "查询"}</button>
      </div>
    </section>
    {error ? <div className="notice" data-tone="bad" role="alert">{error}</div> : null}
    <section className="card member-history__card">
      <div className="table-scroll">{groupType === "LAWYER" ? <table className="grid-table member-history__table">
        <thead><tr><th>日期</th><th>来源渠道</th><th>接粉</th><th>回复</th><th>未回复</th><th>小金额</th><th>真实案件</th><th>回复率</th><th>添加律师</th><th>添加专家</th><th>添加律师率</th><th>添加专家率</th><th>推客服</th><th>注册</th><th>开单</th><th>加密货币充值</th><th>银行卡充值</th><th>出金</th></tr></thead>
        <tbody>
          {loading && !rows.length ? <tr><td colSpan={18} className="member-history__empty">正在读取真实历史数据…</td></tr> : null}
          {!loading && !rows.length ? <tr><td colSpan={18} className="member-history__empty">所选日期没有填写过数据。</td></tr> : null}
          {rows.map((row) => <tr key={row.key}><td><strong>{row.businessDate}</strong></td><td>{row.channelName}</td><td>{row.dispatchCount}</td><td>{row.replyCount}</td><td>{Math.max(0, row.dispatchCount - row.replyCount)}</td><td>{row.lowAmountCount}</td><td>{row.lawyerRealCaseCount}</td><td>{percent(row.replyCount, row.dispatchCount)}</td><td>{row.lawyerAddedCount}</td><td>{row.lawyerExpertAddedCount}</td><td>{percent(row.lawyerAddedCount, row.dispatchCount)}</td><td>{percent(row.lawyerExpertAddedCount, row.dispatchCount)}</td><td>{row.customerServicePushCount}</td><td>{row.registrationCount}</td><td>{row.orderCount}</td><td>{money(row.cryptoInitialDepositCents + row.cryptoRechargeCents)}</td><td>{money(row.bankInitialDepositCents + row.bankRechargeCents)}</td><td>{money(row.withdrawalCents)}</td></tr>)}
        </tbody>
      </table> : <table className="grid-table member-history__table">
        <thead><tr><th>日期</th><th>来源渠道</th><th>添加</th><th>有效</th><th>回复</th><th>回复率</th><th>进群</th><th>进群率</th><th>异常退群率</th><th>当前在群</th><th>推专家</th><th>注册</th><th>注册率</th><th>开单</th><th>开单率</th><th>首充</th><th>续充</th><th>出金</th><th>净业绩</th></tr></thead>
        <tbody>{loading && !rows.length ? <tr><td colSpan={19} className="member-history__empty">正在读取真实历史数据…</td></tr> : null}{!loading && !rows.length ? <tr><td colSpan={19} className="member-history__empty">所选日期没有填写过数据。</td></tr> : null}{rows.map((row) => { const effective = Math.max(0, row.dispatchCount - row.duplicateCount - row.lowAmountCount - row.noWsCount - row.manualInvalidCount); const current = Math.max(0, row.joinCount - row.normalLeaveCount - row.abnormalLeaveCount); const first = row.cryptoInitialDepositCents + row.bankInitialDepositCents; const recharge = row.cryptoRechargeCents + row.bankRechargeCents; return <tr key={row.key}><td><strong>{row.businessDate}</strong></td><td>{row.channelName}</td><td>{row.dispatchCount}</td><td><strong>{effective}</strong></td><td>{row.replyCount}</td><td>{percent(row.replyCount, effective)}</td><td>{row.joinCount}</td><td>{percent(row.joinCount, effective)}</td><td>{percent(row.abnormalLeaveCount, Math.max(0, row.joinCount - row.normalLeaveCount))}</td><td>{current}</td><td>{row.expertIntroCount}</td><td>{row.registrationCount}</td><td>{percent(row.registrationCount, row.expertIntroCount)}</td><td>{row.orderCount}</td><td>{percent(row.orderCount, row.registrationCount)}</td><td>{money(first)}</td><td>{money(recharge)}</td><td>{money(row.withdrawalCents)}</td><td><strong>{money(first + recharge - row.withdrawalCents)}</strong></td></tr>; })}</tbody>
      </table>}</div>
      <footer className="table-footer"><span>共 {rows.length} 条渠道记录</span><button className="btn" data-size="sm" onClick={() => void load()}>刷新</button></footer>
    </section>
  </div>;
}
