"use client";

import { useMemo } from "react";
import type { ResourceField, ResourceTotals } from "./resource-fields";
import styles from "./ResourceReportTable.module.css";

export type ResourceReportEntity = { id: string; name: string; sub?: string; totals: ResourceTotals; total?: boolean };
export function ResourceReportTable({ title, note, entities, fields, layout = "rows", moneyDecimals = 0 }: {
  title: string; note?: string; entities: ResourceReportEntity[]; fields: readonly ResourceField[];
  layout?: "rows" | "columns"; moneyDecimals?: number;
}) {
  const money = useMemo(() => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: moneyDecimals }), [moneyDecimals]);
  function cell(field: ResourceField, totals: ResourceTotals) {
    const value = field.value(totals);
    return value == null ? "—" : field.kind === "money" ? money.format(value / 100) : field.kind === "rate" ? `${(value * 100).toFixed(1)}%` : value;
  }
  const name = (entity: ResourceReportEntity) => <><strong>{entity.name}</strong>{entity.sub ? <small>{entity.sub}</small> : null}</>;
  return <section className={styles.card}>
    <header className={styles.heading}><h2>{title}</h2>{note ? <p>{note}</p> : null}</header>
    <p className={styles.scrollHint}>表格可左右滚动查看完整字段；表头和名称固定，数据较多时可在表格内上下滚动。</p>
    <div className={styles.wrap} role="region" aria-label={`${title}，可左右及上下滚动`} tabIndex={0}>
      <table className={styles.table} aria-label={title}>
        {layout === "rows" ? <>
          <thead><tr><th scope="col">名称</th>{fields.map(f => <th key={f.id} scope="col" data-metric={f.id}>{f.label}</th>)}</tr></thead>
          <tbody>{entities.map(e => <tr key={e.id} data-entity={e.id} className={e.total ? styles.total : undefined}><th scope="row">{name(e)}</th>{fields.map(f => <td key={f.id} data-metric={f.id}>{cell(f, e.totals)}</td>)}</tr>)}</tbody>
        </> : <>
          <thead><tr><th scope="col">数据指标</th>{entities.map(e => <th key={e.id} scope="col" data-entity={e.id} className={e.total ? styles.total : undefined}>{name(e)}</th>)}</tr></thead>
          <tbody>{fields.map(f => <tr key={f.id} data-metric={f.id}><th scope="row">{f.label}</th>{entities.map(e => <td key={e.id} data-entity={e.id} className={e.total ? styles.total : undefined}>{cell(f, e.totals)}</td>)}</tr>)}</tbody>
        </>}
      </table>
    </div>
    {!entities.length ? <p className={styles.empty}>当前筛选范围暂无数据</p> : null}
  </section>;
}
