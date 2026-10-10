"use client";
import { useEffect, useRef, useState } from "react";
import { customerStageNames, type CustomerFinderPayload, type CustomerLocation } from "./navigation";
import styles from "./CustomerSheet.module.css";
import { requestErrorMessage } from "./request-error";

export default function CustomerFinder({ groupId, groupName, initialQuery, onOpen, onClose }: { groupId: string; groupName: string; initialQuery: string; onOpen: (row: CustomerLocation) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<CustomerFinderPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { dialog.current?.showModal(); queryInput.current?.focus(); return () => { request.current?.abort(); }; }, []);
  function reset() { request.current?.abort(); request.current = null; setBusy(false); setResult(null); setError(""); }
  async function search(page = 1) {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch(`/api/customer-sheet/find?${new URLSearchParams({ groupId, q: query, page: String(page) })}`, { cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "查找失败，请重试");
      if (request.current === controller) setResult(data);
    } catch (error) { if (!controller.signal.aborted) setError(requestErrorMessage(error,"查找号码")); }
    finally { if (request.current === controller) setBusy(false); }
  }
  return <dialog ref={dialog} className={styles.finderDialog} aria-labelledby="customer-finder-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h3 id="customer-finder-title">找号码</h3><button onClick={onClose} aria-label="关闭找号码">关闭</button></header>
    <p>{groupName} · 查找全部进度及删除归档，不受当前页面的日期、状态和负责人筛选影响。</p>
    <form className={styles.finderForm} onSubmit={event => { event.preventDefault(); void search(); }}>
      <input ref={queryInput} autoFocus aria-label="要找的号码或编号" value={query} onChange={event => { reset(); setQuery(event.target.value); }} maxLength={100} placeholder="尾号四位、完整号码或客户编号" />
      <button className={styles.primary} disabled={busy || !query.trim()}>{busy ? "查找中…" : "查找"}</button>
    </form>
    <p>同组账号可查看、搜索完整号码，也可用尾号四位或编号查找；跨组管理查看仍打码。</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {result && <><p role="status">找到 {result.total} 位客户{result.total > 1 ? "，请按负责人和编号选择" : ""}。</p>
      {result.total === 0 ? <p>本组可查看范围内没有匹配记录。请核对尾号四位、客户编号及当前小组；永久删除的客户不会出现在结果中。</p> : <>
        <p>页码按“该接粉负责人 · 全部日期 · 全部状态”计算；点击时会重新定位。</p>
        <ul className={styles.finderResults}>{result.matches.map(row => <li key={row.id}>
          <div><strong>{row.phone}</strong><span>编号 {row.code}</span><span>接粉负责人：{row.ownerName}</span></div>
          <div><strong>{row.deleted ? "删除归档" : customerStageNames[row.stage]}</strong><span>{row.status}</span><span>{row.date || (row.deleted ? "未记录进群日期" : "待补日期")} · 第 {row.page}/{row.pages} 页</span></div>
          <button className={styles.primary} onClick={() => onOpen(row)} aria-label={`直接打开 ${row.code} ${row.phone}`}>直接打开</button>
        </li>)}</ul>
        {result.pages > 1 && <nav className={styles.pagination} aria-label="查找结果分页"><button disabled={busy || result.page <= 1} onClick={() => void search(result.page - 1)}>上一批结果</button><span>第 {result.page}/{result.pages} 页</span><button disabled={busy || result.page >= result.pages} onClick={() => void search(result.page + 1)}>下一批结果</button></nav>}
      </>}
    </>}
  </dialog>;
}
