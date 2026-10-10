"use client";

import { Fragment, type ClipboardEvent, type ReactNode, type RefObject } from "react";
import { customerPageSize } from "./navigation";
import styles from "./CustomerSheet.module.css";
import type { Column, SheetPayload, SheetRow } from "./schema";

type Bundle = { name: string; ids: string[]; fields: Column[] };

type Props = {
  payload: SheetPayload | null;
  combined: boolean;
  addingRow: boolean;
  focusId: string | null;
  sheetScroll: RefObject<HTMLDivElement | null>;
  focusedRow: RefObject<HTMLTableRowElement | null>;
  bundles: Bundle[];
  columns: Column[];
  detailColumns: Column[];
  expandedRows: string[];
  selection: { row: number; column: number; endRow: number; endColumn: number } | null;
  editing: { row: SheetRow; column: Column } | null;
  emptyContent: ReactNode;
  renderGroupedField: (column: Column, row?: SheetRow) => ReactNode;
  renderDateHeading: (row: SheetRow, index: number, span: number) => ReactNode;
  renderRowActions: (row: SheetRow) => ReactNode;
  renderDraftCell: (column: Column) => ReactNode;
  renderGridCell: (row: SheetRow, column: Column, rowIndex: number, columnIndex: number) => ReactNode;
  isDateOpen: (row: SheetRow) => boolean;
  onToggleExpanded: (rowId: string) => void;
  onCopy: (event: ClipboardEvent<HTMLDivElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
};

function locatedRowProps(row: SheetRow, focusId: string | null, focusedRow: Props["focusedRow"]) {
  return row.id === focusId ? { ref: focusedRow, tabIndex: -1, "data-located": true } : {};
}

export default function CustomerSheetTable(props: Props) {
  if (props.combined) return <div ref={props.sheetScroll} className={styles.scroll} role="region" aria-label="客户表格，可左右滚动查看完整字段" tabIndex={0}>
    <table className={styles.combinedTable} style={{ minWidth: 36 + props.bundles.length * 175 }}>
      <thead><tr><th>#</th>{props.bundles.map(bundle => <th key={bundle.name}>{bundle.name}</th>)}</tr></thead>
      <tbody>
        {props.addingRow && props.payload && <>
          <tr className={styles.newCombined}><td>新</td>{props.bundles.map(bundle => <td key={bundle.name}>{bundle.fields.map(column => props.renderGroupedField(column))}</td>)}</tr>
          {props.detailColumns.length > 0 && <tr><td colSpan={props.bundles.length + 1}><div className={styles.detailGrid}>{props.detailColumns.map(column => props.renderGroupedField(column))}</div></td></tr>}
        </>}
        {!props.payload
          ? <tr><td colSpan={props.bundles.length + 1} className={styles.empty}>正在读取客户…</td></tr>
          : props.payload.rows.length === 0
            ? <tr><td colSpan={props.bundles.length + 1} className={styles.empty}>{props.emptyContent}</td></tr>
            : props.payload.rows.map((row, index) => <Fragment key={row.id}>
              {props.renderDateHeading(row, index, props.bundles.length + 1)}
              {props.isDateOpen(row) && <>
                <tr {...locatedRowProps(row, props.focusId, props.focusedRow)}>
                  <td>{(props.payload!.page - 1) * customerPageSize + index + 1}{props.renderRowActions(row)}</td>
                  {props.bundles.map((bundle, bundleIndex) => <td key={bundle.name}>{bundle.fields.map(column => props.renderGroupedField(column, row))}{bundleIndex === 0 && props.detailColumns.length > 0 && <button className={styles.moreFields} aria-expanded={props.expandedRows.includes(row.id)} onClick={() => props.onToggleExpanded(row.id)}>{props.expandedRows.includes(row.id) ? "收起字段" : "更多字段"}</button>}</td>)}
                </tr>
                {props.expandedRows.includes(row.id) && props.detailColumns.length > 0 && <tr><td colSpan={props.bundles.length + 1}><div className={styles.detailGrid}>{props.detailColumns.map(column => props.renderGroupedField(column, row))}</div></td></tr>}
              </>}
            </Fragment>)}
      </tbody>
    </table>
  </div>;

  return <div ref={props.sheetScroll} className={styles.scroll} onCopy={props.onCopy} onPaste={props.onPaste}>
    <table className={styles.table}>
      <thead><tr><th className={styles.rowNumber}>#</th>{props.columns.map(column => <th data-column={column.id} key={column.id}>{column.name}</th>)}</tr></thead>
      <tbody>
        {props.addingRow && props.payload && <tr className={styles.draftRow} onPaste={event => event.stopPropagation()} onCopy={event => event.stopPropagation()}><td className={styles.rowNumber}>新</td>{props.columns.map(column => <td data-column={column.id} key={column.id}>{props.renderDraftCell(column)}</td>)}</tr>}
        {!props.payload
          ? <tr><td colSpan={props.columns.length + 1} className={styles.empty}>正在读取客户…</td></tr>
          : props.payload.rows.length === 0
            ? !props.addingRow && <tr><td colSpan={props.columns.length + 1} className={styles.empty}>{props.emptyContent}</td></tr>
            : props.payload.rows.map((row, rowIndex) => <Fragment key={row.id}>
              {props.renderDateHeading(row, rowIndex, props.columns.length + 1)}
              {props.isDateOpen(row) && <tr {...locatedRowProps(row, props.focusId, props.focusedRow)}>
                <td className={styles.rowNumber}>{(props.payload!.page - 1) * customerPageSize + rowIndex + 1}{props.renderRowActions(row)}</td>
                {props.columns.map((column, columnIndex) => {
                  const selected = !!props.selection && rowIndex >= Math.min(props.selection.row, props.selection.endRow) && rowIndex <= Math.max(props.selection.row, props.selection.endRow) && columnIndex >= Math.min(props.selection.column, props.selection.endColumn) && columnIndex <= Math.max(props.selection.column, props.selection.endColumn);
                  const active = props.editing?.row.id === row.id && props.editing.column.id === column.id;
                  return <td data-column={column.id} key={column.id} data-selected={selected} className={active ? styles.editing : undefined}>{props.renderGridCell(row, column, rowIndex, columnIndex)}</td>;
                })}
              </tr>}
            </Fragment>)}
      </tbody>
    </table>
  </div>;
}
