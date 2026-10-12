"use client";

import { Fragment, useState, type ReactNode } from "react";
import { CaretDown, CaretRight, MagnifyingGlass } from "@phosphor-icons/react";
import { countryName } from "../../../packages/resource-buyer/options";
import { buyerUnitCost as cost, spendMoney, type EffectRow } from "./resource-buyer-format";
import { groupBuyerEffects, sumEffects } from "./resource-buyer-groups";
import type { BuyerPayload } from "./ResourceBuyerAttribution";
import styles from "./ResourceBuyerEffects.module.css";

const number = (value: number) => value.toLocaleString("en-US");
const percent = (part: number, whole: number) => whole ? `${(part / whole * 100).toFixed(1)}%` : "—";
const counts = [["imported", "导入"], ["matched", "匹配"], ["pending", "待匹配"], ["ambiguous", "跨组重号"], ["valid", "有效"], ["replied", "回复"], ["joined", "进群"], ["expert", "推专家"], ["registered", "注册"], ["opened", "开单"]] as const;
const amounts = [["firstCents", "首充"], ["rechargeCents", "续充"], ["withdrawalCents", "出金"], ["netCents", "净业绩"], ["legacyCents", "历史资金"]] as const;
const visibleCounts = (all: boolean) => counts.filter(([key]) => all || (key !== "pending" && key !== "ambiguous"));
const visibleAmounts = (all: boolean) => amounts.filter(([key]) => all || (key !== "withdrawalCents" && key !== "legacyCents"));

function Metrics({ row, all }: { row: EffectRow; all: boolean }) {
  return <>
    {visibleCounts(all).map(([key]) => <td key={key} className={key === "opened" && row.opened > 0 ? styles.emphasis : undefined}>{number(row[key])}</td>)}
    {all ? <td>{percent(row.valid, row.matched)}</td> : null}<td>{percent(row.opened, row.matched)}</td>
    <td className={styles.spend}>{row.spend.length ? row.spend.map(item => <span key={item.currency}>{spendMoney(item.amountCents, item.currency)}</span>) : <span className={styles.muted}>未登记</span>}</td>
    <td>{cost(row, row.imported)}</td>{all ? <td>{cost(row, row.valid)}</td> : null}<td>{cost(row, row.opened)}</td>
    {visibleAmounts(all).map(([key]) => <td key={key} className={key === "netCents" && row.netCents > 0 ? styles.positive : undefined}>{(row[key] / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>)}
  </>;
}

export function ResourceBuyerEffects({ smsOnly = false, payload, filters, loading, onRefresh, onNumbers }: {
  smsOnly?: boolean; payload: BuyerPayload | null; filters: ReactNode; loading: boolean;
  onRefresh: () => void; onNumbers: (row: EffectRow, material: boolean, country: string | null) => void;
}) {
  const owner = smsOnly ? "供粉方" : "投手";
  const [allMetrics, setAllMetrics] = useState(false);
  const columns = allMetrics ? 24 : 18;
  const [search, setSearch] = useState("");
  const [materialTab, setMaterialTab] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const materialMode = !smsOnly && materialTab;
  const source = (materialMode ? payload?.materialSummary : payload?.summary) ?? [];
  const query = search.trim().toLocaleLowerCase();
  const groups = groupBuyerEffects(source).filter(group => `${group.total.buyer} ${group.total.channel}`.toLocaleLowerCase().includes(query));
  const total = sumEffects(groups.flatMap(group => group.children));
  const isOpen = (key: string, index: number) => expanded[key] ?? index < 2;
  const expandAll = (open: boolean) => setExpanded(current => ({ ...current, ...Object.fromEntries(groups.map(group => [group.key, open])) }));
  return <section className={styles.effects} aria-busy={loading}>
    <header className={styles.heading}><div><h2>{smsOnly ? "短信粉效果" : "投手效果"}</h2><p>先看{owner}整体效果，展开后查看各国家明细。</p></div>
      {!smsOnly ? <div className={styles.tabs} aria-label="效果类型"><button type="button" aria-pressed={!materialMode} onClick={() => setMaterialTab(false)}>投手汇总</button><button type="button" aria-pressed={materialMode} onClick={() => setMaterialTab(true)}>素材明细</button></div> : null}
    </header>
    <div className={styles.toolbar}>
      <label className={styles.searchLabel}>搜索{owner}<div className={styles.search}><MagnifyingGlass size={17} aria-hidden="true" /><input aria-label={`搜索${owner}或渠道`} placeholder={`${owner}名称或渠道`} value={search} onChange={event => setSearch(event.target.value)} /></div></label>
      <div className={styles.filters}>{filters}<button className={styles.refresh} type="button" disabled={loading} onClick={onRefresh}>{loading ? "读取中…" : "刷新数据"}</button></div>
    </div>
    <div className={styles.summary}>{loading ? <span role="status">正在读取当前筛选数据…</span> : !payload ? <span>暂无可用数据</span> : <div><span>当前导入 <strong>{number(total.imported)}</strong></span><span>匹配 <strong>{number(total.matched)}</strong></span><span>有效 <strong>{number(total.valid)}</strong></span><span>开单 <strong>{number(total.opened)}</strong></span><span className={styles.summaryCount}>共 {groups.length} 位{owner}</span></div>}<div className={styles.expandActions}><button className={styles.metricSwitch} type="button" aria-pressed={allMetrics} onClick={() => setAllMetrics(current => !current)}>{allMetrics ? "切换核心指标" : "显示全部指标"}</button><button type="button" onClick={() => expandAll(true)}>全部展开</button><span> / </span><button type="button" onClick={() => expandAll(false)}>全部收起</button></div></div>
    {materialMode ? <p className={styles.notice}>素材明细仅统计已指定素材的号码与消耗；完整合计及未分摊消耗请看“投手汇总”。</p> : null}
    <div className={styles.tableHint}><span>蓝色行是{owner}合计，展开后按国家查看{materialMode ? "素材" : ""}。</span><span>左右滑动查看成本与资金 →</span></div>
    <div className={styles.tableWrap} role="region" aria-label={`${owner}与国家效果表，可横向滚动`} tabIndex={0}>
      <table className={`${styles.table} ${!allMetrics ? styles.coreTable : ""}`}>
        <thead><tr><th rowSpan={2} className={styles.nameColumn} scope="col">{owner} / 国家{materialMode ? " / 素材" : ""}</th><th rowSpan={2} className={styles.channelColumn} scope="col">渠道</th><th colSpan={allMetrics ? 12 : 9} scope="colgroup">号码与转化</th><th colSpan={allMetrics ? 4 : 3} scope="colgroup">消耗与成本</th><th colSpan={allMetrics ? 5 : 3} scope="colgroup">资金（USD）</th><th rowSpan={2} scope="col">操作</th></tr>
          <tr>{visibleCounts(allMetrics).map(([key, label]) => <th key={key} scope="col">{label}</th>)}{allMetrics ? <th scope="col">有效率</th> : null}<th scope="col">开单率</th><th scope="col">消耗</th><th scope="col">单粉成本</th>{allMetrics ? <th scope="col">有效客户成本</th> : null}<th scope="col">开单客户成本</th>{visibleAmounts(allMetrics).map(([key, label]) => <th key={key} scope="col">{label}</th>)}</tr></thead>
        <tbody>{groups.map((group, index) => {
          const open = isOpen(group.key, index);
          const countries = new Set(group.children.map(row => row.country)).size;
          return <Fragment key={group.key}><tr className={styles.buyerRow}><th scope="row" className={styles.nameColumn}><button className={styles.buyerToggle} type="button" aria-expanded={open} aria-label={`${open ? "收起" : "展开"}${group.total.buyer}的国家明细`} onClick={() => setExpanded(current => ({ ...current, [group.key]: !open }))}>{open ? <CaretDown size={15} aria-hidden="true" /> : <CaretRight size={15} aria-hidden="true" />}<span title={group.total.buyer}>{group.total.buyer}</span><small>{countries} 国</small></button></th><td className={styles.channelColumn}>{group.total.channel}</td><Metrics row={group.total} all={allMetrics} /><td>{!materialMode ? <button className={styles.link} type="button" disabled={loading} onClick={() => onNumbers(group.total, false, null)}>查看号码</button> : "—"}</td></tr>
            {open ? group.children.map(row => <tr className={styles.countryRow} key={JSON.stringify([row.country, row.materialId])}><th scope="row" className={styles.nameColumn}><span className={styles.countryName}>{countryName(row.country)}{materialMode ? <small>{row.material || "未指定素材"}</small> : null}</span></th><td className={styles.channelColumn}>{row.channel}</td><Metrics row={row} all={allMetrics} /><td><button className={styles.link} type="button" disabled={loading} onClick={() => onNumbers(row, materialMode, row.country)}>查看号码</button></td></tr>) : null}</Fragment>;
        })}{!groups.length ? <tr><td colSpan={columns} className={styles.empty}>{loading ? "正在读取数据…" : query ? `没有找到符合条件的${owner}` : "当前月份、渠道和国家下暂无数据"}</td></tr> : null}</tbody>
        {groups.length ? <tfoot><tr><th scope="row" className={styles.nameColumn}>当前筛选合计</th><td className={styles.channelColumn}>全部</td><Metrics row={total} all={allMetrics} /><td>—</td></tr></tfoot> : null}
      </table>
    </div>
    <div className={styles.footer}><span>共 {groups.length} 位{owner} · 已展开 {groups.filter((group, index) => isOpen(group.key, index)).length} 位</span><span>同名但不同渠道的{owner}分别汇总</span></div>
    <p className={styles.note}>号码按导入批次月份统计，后续转化持续累计。有效率＝有效 ÷ 匹配；开单率＝开单 ÷ 匹配。未匹配及跨小组重号不计入转化人数。</p>
    <p className={styles.note}>消耗按发生月份统计；单粉、有效客户、开单客户成本分别除以对应人数。多币种消耗分开显示，不合并计算成本。净业绩已含历史资金。</p>
  </section>;
}
