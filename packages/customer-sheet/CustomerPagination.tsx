import { customerPageSize } from "./navigation";
import styles from "./CustomerSheet.module.css";

export default function CustomerPagination({ total, page, pages, disabled, position, onPage }: { total: number; page: number; pages: number; disabled: boolean; position: "顶部" | "底部"; onPage: (page: number) => void }) {
  const last = Math.min(page * customerPageSize, total);
  const remaining = Math.max(0, total - last);
  return <nav className={styles.pagination} aria-label={`${position}客户分页`}>
    <strong>共 {total} 人</strong><span>{total ? `当前第 ${(page - 1) * customerPageSize + 1}–${last} 人` : "当前 0 人"}</span>
    <span>第 {page}/{pages} 页</span>
    <button disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>上一页</button>
    <label>跳到 <select aria-label={`${position}页码`} disabled={disabled || pages <= 1} value={page} onChange={event => onPage(Number(event.target.value))}>
      {Array.from({ length: pages }, (_, index) => <option key={index + 1} value={index + 1}>第 {index + 1} 页</option>)}
    </select></label>
    <button className={remaining ? styles.primary : undefined} disabled={disabled || !remaining} onClick={() => onPage(page + 1)}>{remaining ? `下一页，还有${remaining}人` : "已是最后一页"}</button>
  </nav>;
}
