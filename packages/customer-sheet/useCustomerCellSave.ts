"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { requestJson } from "./request-error";
import type { CellValue, Column, SheetPayload, SheetRow } from "./schema";

type Props = {
  payload: SheetPayload | null;
  setPayload: Dispatch<SetStateAction<SheetPayload | null>>;
  reload: () => Promise<void>;
  setSaveMessage: (status: string) => void;
};

export default function useCustomerCellSave({ payload, setPayload, reload, setSaveMessage }: Props) {
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [pendingSaves, setPendingSaves] = useState(0);

  function saveCell(row: SheetRow, column: Column, value: CellValue): Promise<void> {
    setPendingSaves(count => count + 1);
    setSaveMessage("保存中…");
    const task = saveQueue.current.catch(() => {}).then(async () => {
      const current = payloadRef.current?.rows.find(item => item.id === row.id);
      if (!current) throw new Error("当前记录已切换，请重新打开后填写");
      const result = await requestJson<Pick<SheetRow, "version" | "data" | "phone" | "ownerId" | "editable">>(`/api/customer-sheet/rows/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: current.version, values: { [column.id]: value } }),
      }, "客户资料操作");
      const latest = payloadRef.current;
      if (latest) {
        const next = { ...latest, rows: latest.rows.map(item => item.id === row.id ? { ...item, ...result } : item) };
        payloadRef.current = next;
        setPayload(next);
      }
      setSaveMessage(["normalLeft", "abnormalLeft"].includes(column.id)
        ? value === true ? `已记录${column.name}，已同步日报；可切换退群筛选查看` : `已取消${column.name}，已同步日报`
        : "已保存");
      await reload();
    }).catch(error => {
      setSaveMessage("保存失败，请检查标红的格子");
      throw error;
    }).finally(() => setPendingSaves(count => count - 1));
    saveQueue.current = task;
    return task;
  }

  return { pendingSaves, saveCell };
}
