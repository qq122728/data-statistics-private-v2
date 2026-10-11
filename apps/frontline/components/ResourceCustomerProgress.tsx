"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ProgressPayload } from "../../../packages/customer-sheet/management-types";
import { requestJson } from "@/lib/backend";
import styles from "./ResourceCustomerProgress.module.css";

type Stage = "all" | "pending" | "group" | "expert" | "ordered";
const stages: { value: Stage; label: string }[] = [
  { value: "all", label: "全部客户" },
  { value: "pending", label: "待进群" },
  { value: "group", label: "在群跟进" },
  { value: "expert", label: "专家跟进" },
  { value: "ordered", label: "已开单客户" },
];
const stageName: Record<Exclude<Stage, "all" | "ordered">, string> = { pending: "待进群", group: "在群跟进", expert: "专家跟进" };
const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ResourceCustomerProgress() {
  const [payload, setPayload] = useState<ProgressPayload | null>(null);
  const [channelId, setChannelId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [stage, setStage] = useState<Stage>("all");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ channelId, groupId, stage, q: appliedSearch, page: String(page) });
      const result = await requestJson<ProgressPayload>(`/api/customer-sheet/management?${query}`);
      setPayload(result);
    } catch (caught) {
      setPayload(null);
      setError(caught instanceof Error ? caught.message : "客户进度读取失败");
    } finally {
      setLoading(false);
    }
  }, [channelId, groupId, stage, appliedSearch, page]);
  useEffect(() => { void load(); }, [load]);

  const groupNames = new Map(payload?.groups.map(group => [group.id, group.name]) ?? []);
  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim());
  }

  return <section className={styles.card}>
    <div className={styles.heading}><div><h2>客户进度表</h2><p>仅显示已授权渠道的客户；已开单按首充金额大于 0 统计，日期取实际首充／开单日期。号码和金额只读。</p></div><button type="button" onClick={() => void load()} disabled={loading}>刷新</button></div>
    <form className={styles.filters} onSubmit={submitSearch}>
      <label>渠道<select value={channelId} onChange={event => { setChannelId(event.target.value); setPage(1); }}><option value="">全部授权渠道</option>{payload?.channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
      <label>小组<select value={groupId} onChange={event => { setGroupId(event.target.value); setPage(1); }}><option value="">全部关联小组</option>{payload?.groups.map(group => <option key={group.id} value={group.id}>{group.companyName} / {group.departmentName} / {group.name}</option>)}</select></label>
      <label className={styles.search}>号码或客户编号<input value={search} onChange={event => setSearch(event.target.value)} placeholder="输入完整号码、尾号 4 位或客户编号" /></label>
      <button type="submit">查询</button>
    </form>
    <div className={styles.stages}>{stages.map(item => <button type="button" key={item.value} aria-pressed={stage === item.value} onClick={() => { setStage(item.value); setPage(1); }}>{item.label} <strong>{payload?.counts[item.value] ?? "—"}</strong></button>)}</div>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {loading ? <p className={styles.message}>正在读取客户进度…</p> : null}
    {!loading && payload ? <>
      <div className={styles.tableWrap}><table><thead><tr><th>客户号码 / 编号</th><th>首充金额</th><th>小组</th><th>来源渠道</th><th>接粉人</th><th>阶段 / 状态</th><th>接粉日期</th><th>进群日期</th><th>介绍专家日期</th><th>开单日期</th><th>续充金额</th><th>出金金额</th><th>净业绩</th></tr></thead><tbody>
        {payload.rows.map(row => <tr key={row.id}><td><strong>{row.phone.length === 6 ? `尾号 ${row.phone}` : row.phone}</strong><small>{row.code}</small></td><td><strong>{money(row.firstDepositCents)}</strong></td><td>{groupNames.get(row.groupId) ?? "原归属小组"}</td><td>{row.channel}</td><td>{row.owner}</td><td>{stageName[row.stage]}<small>{row.status}</small></td><td>{row.intakeOn || "—"}</td><td>{row.joinedOn || "—"}</td><td>{row.expertOn || "—"}</td><td>{row.orderedOn || "—"}</td><td>{money(row.rechargeCents)}</td><td>{money(row.withdrawalCents)}</td><td><strong>{money(row.netCents)}</strong></td></tr>)}
        {!payload.rows.length ? <tr><td colSpan={13} className={styles.empty}>当前筛选范围没有客户</td></tr> : null}
      </tbody></table></div>
      <div className={styles.pagination}><span>共 {payload.total} 位客户 · 第 {payload.page}/{payload.pages} 页</span><div><button type="button" disabled={payload.page <= 1} onClick={() => setPage(payload.page - 1)}>上一页</button><button type="button" disabled={payload.page >= payload.pages} onClick={() => setPage(payload.page + 1)}>下一页</button></div></div>
    </> : null}
  </section>;
}
