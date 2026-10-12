"use client";

import { countryName } from "../../../packages/resource-buyer/options";
import { buyerUnitCost, spendMoney, type EffectRow } from "./resource-buyer-format";
import styles from "./ResourceBuyerAttribution.module.css";

const costColumns = [
  { label: "单粉成本", field: "imported", unit: "个导入号码" },
  { label: "有效粉成本", field: "valid", unit: "个有效客户" },
  { label: "进群成本", field: "joined", unit: "人进群" },
  { label: "推专家成本", field: "expert", unit: "人推专家" },
  { label: "注册成本", field: "registered", unit: "人注册" },
  { label: "开单成本", field: "opened", unit: "人开单" },
] as const;

export function ResourceBuyerCostTable({ smsOnly = false, rows, loading }: { smsOnly?: boolean; rows: EffectRow[]; loading: boolean }) {
  return <section className={styles.card} aria-label={smsOnly ? "短信粉成本表" : "投手成本表"} aria-busy={loading}>
    <header><h3>{smsOnly ? "短信粉成本表" : "投手成本表"}</h3><p>登记消耗后自动计算。跟随上方月份、渠道和国家筛选，每个{smsOnly ? "供粉方" : "投手"}按渠道、国家单独核算。</p></header>
    <div className={styles.tableWrap}><table className={styles.costTable}>
      <thead><tr><th scope="col">{smsOnly ? "供粉方" : "投手／供粉方"}</th><th scope="col">渠道</th><th scope="col">国家</th><th scope="col">总消耗</th>{costColumns.map(column => <th key={column.field} scope="col">{column.label}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={JSON.stringify([row.buyerId, row.channelId, row.country])}>
        <th scope="row">{row.buyer}</th><td>{row.channel}</td><td>{countryName(row.country)}</td>
        <td>{row.spend.length ? row.spend.map(spend => <div key={spend.currency}>{spendMoney(spend.amountCents, spend.currency)}</div>) : <small>未登记</small>}</td>
        {costColumns.map(column => <td key={column.field}><strong>{buyerUnitCost(row, row[column.field])}</strong><small>{row[column.field]} {column.unit}</small></td>)}
      </tr>)}{!rows.length ? <tr><td className={styles.empty} colSpan={10}>{loading ? "正在计算投手成本…" : "当前筛选下暂无号码或消耗记录"}</td></tr> : null}</tbody>
    </table></div>
    <p className={styles.importHint}>单粉成本＝消耗 ÷ 导入号码数（导入时已去重）；有效粉、进群、推专家、注册、开单成本＝消耗 ÷ 对应人数。号码按导入批次月份、消耗按发生月份统计，后续转化持续更新。未登记消耗或人数为 0 时显示“—”；多币种不合并计算。</p>
  </section>;
}
