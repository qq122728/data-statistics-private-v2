"use client";

import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/backend";
import { customerStageNames } from "../../../packages/customer-sheet/navigation";
import { expertStatuses } from "../../../packages/customer-sheet/schema";
import type { ProgressDetail, ProgressPayload } from "../../../packages/customer-sheet/management-types";
import styles from "./ManagementCustomerProgress.module.css";

const defaults = { companyId: "", departmentId: "", groupId: "", q: "", stage: "all", status: "", role: "ownerId", assignee: "", dateField: "intakeOn", from: "", to: "", page: "1", pageSize: "50" };
const dateText = (value: string) => value ? value.slice(0, 10) : "—";
const money = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function shiftDay(day: string, amount: number) { const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); }
function updatedText(value: string) { return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }

export function ManagementCustomerProgress({ permissionLabel }: { permissionLabel: string }) {
  const [filters, setFilters] = useState(defaults), [search, setSearch] = useState("");
  const [payload, setPayload] = useState<ProgressPayload>(), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0), [jumpPage, setJumpPage] = useState("");
  const [detailId, setDetailId] = useState(""), [detail, setDetail] = useState<ProgressDetail>(), [detailError, setDetailError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const query = new URLSearchParams(filters).toString();
  function change(values: Partial<typeof defaults>) { setFilters(current => ({ ...current, ...values, page: "1" })); }
  function clear() { setSearch(""); setFilters(defaults); }
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    void requestJson<ProgressPayload>(`/api/customer-sheet/management?${query}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setPayload(result); })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "客户读取失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, refresh]);
  useEffect(() => {
    if (!detailId) { dialog.current?.close(); return; }
    dialog.current?.showModal(); const controller = new AbortController(); setDetail(undefined); setDetailError("");
    void requestJson<ProgressDetail>(`/api/customer-sheet/management?rowId=${encodeURIComponent(detailId)}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setDetail(result); })
      .catch(caught => { if (!controller.signal.aborted) setDetailError(caught instanceof Error ? caught.message : "详情读取失败"); });
    return () => controller.abort();
  }, [detailId]);
  const groups = payload?.groups || [];
  const companies = [...new Map(groups.filter(g => g.companyId).map(g => [g.companyId, g.companyName])).entries()];
  const departments = [...new Map(groups.filter(g => g.departmentId && (!filters.companyId || g.companyId === filters.companyId)).map(g => [g.departmentId, g.departmentName])).entries()];
  const visibleGroups = groups.filter(g => (!filters.companyId || g.companyId === filters.companyId) && (!filters.departmentId || g.departmentId === filters.departmentId));
  const statuses = filters.stage === "expert" ? expertStatuses : filters.stage === "pending" ? ["待跟进"] : filters.stage === "group" ? ["正常在群", "正常退群", "异常退群"] : ["待跟进", "正常在群", "正常退群", "异常退群", ...expertStatuses];
  const rangeInvalid = Boolean(filters.from && filters.to && filters.from > filters.to);
  function quickDate(kind: string) {
    const today = payload?.today;
    if (!today || kind === "all") { change({ from: "", to: "" }); return; }
    change({ from: kind === "month" ? `${today.slice(0, 7)}-01` : shiftDay(today, kind === "3" ? -2 : kind === "7" ? -6 : 0), to: today });
  }
  const page = payload?.page || 1, pages = payload?.pages || 1;
  return <section className={styles.workspace} aria-label="客户进度总表">
    <div className={styles.toolbar}>
      <label>公司<select aria-label="公司" value={filters.companyId} onChange={e => change({ companyId: e.target.value, departmentId: "", groupId: "", assignee: "" })}><option value="">全部公司</option>{companies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>部门<select aria-label="部门" value={filters.departmentId} onChange={e => change({ departmentId: e.target.value, groupId: "", assignee: "" })}><option value="">全部部门</option>{departments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>小组<select aria-label="小组" value={filters.groupId} onChange={e => change({ groupId: e.target.value, assignee: "" })}><option value="">全部小组</option>{visibleGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      <form className={styles.search} onSubmit={e => { e.preventDefault(); change({ q: search.trim() }); }}><input aria-label="搜索客户" placeholder="尾号4位 / 客户编号 / 姓名或备注" value={search} onChange={e => setSearch(e.target.value)} maxLength={100} /><button type="submit" className={styles.primary}>搜索</button></form>
      <select aria-label="负责人类型" value={filters.role} onChange={e => change({ role: e.target.value, assignee: "" })}><option value="ownerId">接粉负责人</option><option value="operatorId">群负责人</option><option value="expertId">专家负责人</option></select>
      <select aria-label="负责人" value={filters.assignee} onChange={e => change({ assignee: e.target.value })}><option value="">全部人员</option>{payload?.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      <button type="button" onClick={() => setRefresh(n => n + 1)} disabled={loading}>刷新数据</button>
    </div>
    <div className={styles.toolbar}>
      <select aria-label="日期类型" value={filters.dateField} onChange={e => change({ dateField: e.target.value })}><option value="intakeOn">接粉日期</option><option value="joinedOn">进群日期</option><option value="expertOn">加专家日期</option></select>
      <input type="date" aria-label="开始日期" value={filters.from} onChange={e => change({ from: e.target.value })} /><span>至</span><input type="date" aria-label="结束日期" value={filters.to} onChange={e => change({ to: e.target.value })} />
      {[["all", "不限日期"], ["today", "今天"], ["3", "近3天"], ["7", "近7天"], ["month", "本月"]].map(([key, label]) => <button key={key} type="button" disabled={!payload?.today} onClick={() => quickDate(key)}>{label}</button>)}
      <button type="button" className={styles.textButton} onClick={clear}>清除筛选</button><span className={styles.hint}>搜索覆盖当前范围全部页</span>
    </div>
    <div className={styles.tabs} aria-label="客户阶段">
      {(["all", "pending", "group", "expert"] as const).map(stage => <button type="button" key={stage} aria-pressed={filters.stage === stage} className={filters.stage === stage ? styles.active : ""} onClick={() => change({ stage, status: "" })}>{stage === "all" ? "全部客户" : customerStageNames[stage]} <b>{payload?.counts[stage] ?? "—"}</b></button>)}
      <select aria-label="客户状态" value={filters.status} onChange={e => change({ status: e.target.value })}><option value="">全部状态</option>{statuses.map(status => <option key={status}>{status}</option>)}</select><span className={styles.hint}>在群跟进包含专家客户，标签人数不相加</span>
    </div>
    <div className={styles.resultBar} role="status">{loading ? "正在读取客户…" : `当前筛选：${payload?.total || 0} 位客户`}{!loading && filters.q ? ` · 搜索“${filters.q}”` : ""}<span>{permissionLabel} · 此处人数不代表每日业绩</span></div>
    {rangeInvalid || error ? <div role="alert" className={styles.error}>{rangeInvalid ? "开始日期不能晚于结束日期" : error}<button type="button" onClick={() => setRefresh(n => n + 1)}>重试</button></div> : null}
    <div className={styles.tableWrap} aria-busy={loading}>
      <table className={styles.table}><thead><tr>{["#", "客户号码 / 编号", "部门 / 小组", "当前阶段", "接粉负责人", "群负责人", "专家负责人", "渠道", "接粉日期", "进群日期", "加专家日期", "在群天数", "最近更新", "操作"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{!loading && !error && !rangeInvalid ? payload?.rows.map((row, index) => {
          const group = groups.find(g => g.id === row.groupId);
          return <tr key={row.id}><td>{(page - 1) * (payload?.pageSize || 50) + index + 1}</td><td><strong>{row.phone}</strong><small>{row.code}</small></td><td title={`${group?.companyName || ""} / ${group?.departmentName || ""}`}><span>{group?.departmentName || "未归属部门"}</span><small>{group?.name}</small></td><td><span className={styles.stage} data-stage={row.stage}>{row.status}</span><small>{customerStageNames[row.stage]}</small></td><td>{row.owner}</td><td>{row.operator}</td><td>{row.expert}</td><td>{row.channel}</td><td>{dateText(row.intakeOn)}</td><td>{dateText(row.joinedOn)}</td><td>{dateText(row.expertOn)}</td><td>{row.days === null ? "—" : `${row.days} 天`}</td><td title="北京时间">{updatedText(row.updatedAt)}</td><td><button type="button" className={styles.textButton} onClick={() => setDetailId(row.id)} aria-label={`查看 ${row.code} 详情`}>查看详情</button></td></tr>;
        }) : null}
        {!loading && !error && payload?.total === 0 ? <tr><td className={styles.empty} colSpan={14}>当前条件下没有客户，可清除筛选或使用尾号四位、客户编号查找。<button type="button" onClick={clear}>清除筛选</button></td></tr> : null}{loading ? <tr><td className={styles.empty} colSpan={14}>正在读取客户…</td></tr> : null}</tbody>
      </table>
    </div>
    <div className={styles.pagination}><span>共 {payload?.total || 0} 位客户</span><label>每页<select aria-label="每页条数" value={filters.pageSize} onChange={e => change({ pageSize: e.target.value })}>{[20, 50, 100].map(size => <option key={size}>{size}</option>)}</select>条</label><button type="button" disabled={loading || page <= 1} onClick={() => setFilters(f => ({ ...f, page: String(page - 1) }))}>上一页</button><span>第 {page} / {pages} 页</span><button type="button" disabled={loading || page >= pages} onClick={() => setFilters(f => ({ ...f, page: String(page + 1) }))}>下一页</button><form onSubmit={e => { e.preventDefault(); const target = Number(jumpPage); if (Number.isInteger(target) && target >= 1 && target <= pages) { setFilters(f => ({ ...f, page: String(target) })); setJumpPage(""); } }}><input aria-label="跳转页码" type="number" min="1" max={pages} value={jumpPage} onChange={e => setJumpPage(e.target.value)} /><button type="submit" disabled={loading || !jumpPage}>跳转</button></form></div>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="progress-detail-title" onClose={() => setDetailId("")}>
      <div className={styles.detailHeading}><strong id="progress-detail-title">客户详情 · 只读{detail ? ` · ${detail.row.phone}` : ""}</strong><button type="button" autoFocus onClick={() => setDetailId("")}>关闭</button></div>
      {detailError ? <p role="alert" className={styles.error}>{detailError}</p> : !detail ? <p>正在读取详情…</p> : <>
        <p className={styles.attribution}>原接粉统计归属：{detail.row.originalGroup} / {detail.row.originalOwner}。当前跟进负责人以本页记录为准。</p>
        {[["base", "接粉与负责人"], ["group", "在群跟进"], ["expert", "专家跟进"]].map(([stage, title]) => <section key={stage}><h3>{title}</h3><dl className={styles.fields}>{detail.fields.filter(field => field.stage === stage).map(field => <div key={field.id}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl></section>)}
        <section><h3>资金流水</h3><p className={styles.attribution}>投资总额 {money(detail.total)} · 出金 {money(detail.withdrawal)}{detail.legacyBalance > 0 ? ` · 历史累计金额 ${money(detail.legacyBalance)}（未拆分流水）` : ""}</p><table className={styles.table}><thead><tr>{["日期", "编号", "类型", "方式", "金额"].map(text => <th key={text}>{text}</th>)}</tr></thead><tbody>{detail.funds.map((fund, index) => <tr key={index}><td>{dateText(fund.date)}</td><td>{fund.code}</td><td>{fund.kind}</td><td>{fund.method}</td><td>{money(fund.amount)}</td></tr>)}{!detail.funds.length ? <tr><td colSpan={5}>暂无资金流水</td></tr> : null}</tbody></table></section>
      </>}
    </dialog>
  </section>;
}
