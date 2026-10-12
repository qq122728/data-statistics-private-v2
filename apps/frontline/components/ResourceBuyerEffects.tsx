"use client";

import { useState, type ReactNode } from "react";
import { countryName } from "../../../packages/resource-buyer/options";
import { buyerUnitCost as cost, spendMoney, type EffectRow } from "./resource-buyer-format";
import type { BuyerPayload } from "./ResourceBuyerAttribution";
import styles from "./ResourceBuyerEffects.module.css";

const rowKey = (row: EffectRow) => JSON.stringify([row.buyerId, row.channelId, row.country]);
const percent = (part: number, whole: number) => whole ? `${(part / whole * 100).toFixed(1)}%` : "—";
function Spend({ row }: { row: EffectRow }) {
  return row.spend.length ? <>{row.spend.map(item => <span key={item.currency}>{spendMoney(item.amountCents, item.currency)}</span>)}</> : <>未登记</>;
}
export function ResourceBuyerEffects({ smsOnly = false, payload, filters, loading, onRefresh, onNumbers }: {
  smsOnly?: boolean; payload: BuyerPayload | null; filters: ReactNode; loading: boolean;
  onRefresh: () => void; onNumbers: (row: EffectRow, material: boolean) => void;
}) {
  const ownerLabel = smsOnly ? "供粉方" : "投手";
  const effectTitle = smsOnly ? "短信粉效果" : "投手效果";
  const [selection, setSelection] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("buyer");
  const [material, setMaterial] = useState("");
  const all = payload?.summary ?? [];
  const rows = all.filter(row => `${row.buyer} ${row.channel} ${countryName(row.country)}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selected = rows.find(row => rowKey(row) === selection) ?? rows[0];
  const materials = selected ? (payload?.materialSummary ?? []).filter(row => rowKey(row) === rowKey(selected)) : [];
  const materialRow = materials.find(row => (row.materialId || "unknown") === material) ?? materials[0];
  const showMaterials = selected && payload?.channels.find(channel => channel.id === selected.channelId)?.channelType === "ADS";
  const materialMode = tab === "material" && !!showMaterials;
  const detail = materialMode ? materialRow : selected;
  const total = (key: "imported" | "valid" | "opened") => all.reduce((sum, row) => sum + row[key], 0);
  return <div className={styles.effects} aria-busy={loading}>
    <div className={styles.toolbar}>
      <p className={styles.summary}>当月导入 <strong>{total("imported")}</strong><span>有效 <strong>{total("valid")}</strong></span><span>开单 <strong>{total("opened")}</strong></span></p>
      <div className={styles.filterBar}>{filters}<button className={styles.refresh} type="button" disabled={loading} onClick={onRefresh}>{loading ? "读取中…" : "刷新数据"}</button></div>
    </div>
    <div className={styles.workspace}>
      <aside className={styles.master} aria-label={`${ownerLabel}与国家列表`}>
        <div className={styles.listHeading}><h2>{ownerLabel} / 国家</h2><span>{rows.length} 项</span></div>
        <input className={styles.search} aria-label={`搜索${ownerLabel}、国家或渠道`} placeholder={`搜索${ownerLabel}、国家或渠道`} value={search} onChange={event => setSearch(event.target.value)} />
        <div className={styles.list}>{rows.map(row => <button type="button" key={rowKey(row)} aria-pressed={rowKey(row) === (selected && rowKey(selected))} onClick={() => { setSelection(rowKey(row)); setMaterial(""); }}>
          <strong>{row.buyer}<span> · {countryName(row.country)}</span></strong><span className={styles.channel}>{row.channel}</span><span className={styles.rowStats}><span>消耗 <Spend row={row} /></span><span>开单 {row.opened}</span></span>
        </button>)}{!rows.length ? <p className={styles.empty}>{loading ? `正在读取${ownerLabel}数据…` : search ? `没有找到符合条件的${ownerLabel}` : "当前月份、渠道和国家下暂无数据"}</p> : null}</div>
      </aside>
      <section className={styles.detail} aria-label={`${effectTitle}详情`}>
        {selected ? <>
          <header className={styles.detailHeading}><div><div className={styles.identity}><h2>{selected.buyer}</h2><span>{countryName(selected.country)}</span><span>{selected.channel}</span></div><p>客户后续转化持续累计，金额以已登记数据为准。</p></div><button type="button" disabled={!detail || loading} onClick={() => detail && onNumbers(detail, materialMode)}>查看对应号码</button></header>
          <div className={styles.tabs} role="tablist" aria-label="效果类型"><button role="tab" aria-selected={!materialMode} aria-controls="buyer-effect-panel" id="buyer-effect-tab" onClick={() => setTab("buyer")}>{effectTitle}</button>{showMaterials ? <button role="tab" aria-selected={materialMode} aria-controls="buyer-effect-panel" id="material-effect-tab" onClick={() => setTab("material")}>素材效果</button> : null}</div>
          <div role="tabpanel" id="buyer-effect-panel" aria-labelledby={materialMode ? "material-effect-tab" : "buyer-effect-tab"}>
            {materialMode ? <div className={styles.materialFilter}><label>查看素材<select value={materialRow?.materialId || "unknown"} onChange={event => setMaterial(event.target.value)}>{materials.map(row => <option key={row.materialId || "unknown"} value={row.materialId || "unknown"}>{row.material || "未指定素材"}</option>)}</select></label><p>仅统计归属该素材的号码和消耗，未分摊消耗仅计入投手汇总。</p></div> : null}
            {detail ? <>
              <h3>核心数据</h3><div className={styles.kpis}><div><span>投放消耗</span><strong><Spend row={detail} /></strong></div><div><span>单粉成本</span><strong>{cost(detail, detail.imported)}</strong></div><div><span>开单客户</span><strong>{detail.opened}</strong></div><div><span>开单客户成本</span><strong>{cost(detail, detail.opened)}</strong></div></div>
              <h3>转化数据</h3><dl className={styles.metrics}>
                {([["导入号码",detail.imported],["匹配客户",detail.matched],["待匹配",detail.pending],["跨小组重号",detail.ambiguous],["有效",detail.valid],["回复",detail.replied],["进群",detail.joined],["推专家",detail.expert],["注册",detail.registered],["开单",detail.opened],["有效率",percent(detail.valid,detail.matched)],["开单率",percent(detail.opened,detail.matched)]] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl><p className={styles.note}>有效率＝有效 / 匹配客户；开单率＝开单 / 匹配客户。未匹配和跨小组重号不计入转化人数。</p>
              <h3>资金与成本</h3><dl className={`${styles.metrics} ${styles.funds}`}>
                {([["首充（USD）",spendMoney(detail.firstCents,"USD")],["续充（USD）",spendMoney(detail.rechargeCents,"USD")],["出金（USD）",spendMoney(detail.withdrawalCents,"USD")],["净业绩（USD）",spendMoney(detail.netCents,"USD")],["有效客户成本",cost(detail,detail.valid)],["历史资金（USD）",spendMoney(detail.legacyCents,"USD")]] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl><p className={styles.note}>号码按导入批次月份统计，消耗按发生月份统计。单粉成本＝同期消耗 / 导入号码数；有效客户和开单成本分别除以对应人数；多币种分开显示，不合并计算成本。净业绩已含历史资金。</p>
            </> : <p className={styles.empty}>该投手在当前筛选下暂无素材数据。</p>}
          </div>
        </> : <div className={styles.emptyDetail}><h2>{loading ? "正在读取数据" : `暂无${effectTitle}`}</h2><p>请选择其他月份、渠道或国家，或在号码库导入号码。</p></div>}
      </section>
    </div>
  </div>;
}
