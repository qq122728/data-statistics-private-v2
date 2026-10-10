"use client";

import { useEffect, useState } from "react";
import { readResourceFieldPreference, resolveResourceVisibility, resourcePreferenceKey, visibleResourceFields, type ResourceBusiness, type ResourceFieldPreference, type ResourceFieldVisibility } from "./resource-fields";
import styles from "./ResourceReportTable.module.css";

export function useResourceFields({ userId, business, reportType, historyContext, historicalValues, previousMonth }: {
  userId: string; business: ResourceBusiness; reportType: string; historyContext: string; historicalValues: boolean; previousMonth: boolean;
}) {
  const key = resourcePreferenceKey(userId, business, reportType);
  const context = JSON.stringify([historyContext, historicalValues, previousMonth]);
  const [saved, setSaved] = useState<{ key: string; preference: ResourceFieldPreference } | null>(null);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    let preference: ResourceFieldPreference = {};
    try { preference = readResourceFieldPreference(localStorage.getItem(key)); setStorageError(false); }
    catch { setStorageError(true); }
    setSaved({ key, preference });
  }, [key]);
  const ready = saved?.key === key;
  const preference = ready ? saved.preference : {};
  const visibility = resolveResourceVisibility(preference, context, historicalValues || previousMonth);
  function update(next: ResourceFieldVisibility) {
    if (!ready) return;
    const preference: ResourceFieldPreference = { rates: next.rates, leaves: next.leaves, historical: { context, expanded: next.historical } };
    setSaved({ key, preference });
    try { localStorage.setItem(key, JSON.stringify(preference)); setStorageError(false); }
    catch { setStorageError(true); }
  }
  return { fields: visibleResourceFields(business, visibility), visibility, update, business, ready, storageError, historicalValues, previousMonth };
}

export type ResourceFieldControlsState = ReturnType<typeof useResourceFields>;
export function ResourceFieldControls({ state }: { state: ResourceFieldControlsState }) {
  if (state.business === "LAWYER") return <p className={styles.explanation}>律师组保留完整手填指标，回复率按接粉计算。</p>;
  return <div className={styles.controls}>
    <div className={styles.options} role="group" aria-label="资源报表显示栏目">
      <strong>显示栏目</strong>
      {([ ["rates", "转化率"], ["leaves", "退群明细"], ["historical", "历史无效分类"] ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={state.visibility[key]} disabled={!state.ready} onChange={event => state.update({ ...state.visibility, [key]: event.target.checked })} />{label}</label>)}
      <button type="button" disabled={!state.ready} onClick={() => state.update({ rates: true, leaves: true, historical: true })}>展开全部</button>
      <button type="button" disabled={!state.ready} onClick={() => state.update({ rates: false, leaves: false, historical: false })}>恢复常用</button>
    </div>
    <p>常用数量与资金始终显示；展开或收起只改变显示，不改数量、合计和原有导出。</p>
    {state.historicalValues || state.previousMonth ? <p className={styles.history} role="status">{state.historicalValues ? "当前范围含历史无效分类数据。" : "当前范围涉及旧月份，历史分类默认展开以便核对。"}{state.visibility.historical ? "已展开历史无效分类。" : "历史无效分类已收起，可勾选上方栏目重新查看。"}</p> : null}
    {state.storageError ? <p role="status">此浏览器暂时无法保存显示偏好；当前选择仍生效，重新打开后可能恢复默认。</p> : null}
  </div>;
}
