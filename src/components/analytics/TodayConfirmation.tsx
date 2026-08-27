"use client";

import { useState } from "react";
import { Button } from "../ui/Button";
import { WorkflowConfirmationDialog, type WorkflowConfirmation } from "../ui/WorkflowConfirmationDialog";

type ConfirmationRole = "ADMIN" | "RESOURCE_MANAGER" | "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";

export function TodayConfirmation({
  businessDate,
  initialConfirmedAt,
  role,
}: {
  businessDate: string;
  initialConfirmedAt?: string | Date | null;
  role: ConfirmationRole;
}) {
  const [confirmedAt, setConfirmedAt] = useState(initialConfirmedAt ? new Date(initialConfirmedAt) : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<WorkflowConfirmation | null>(null);
  if (role === "ADMIN" || role === "RESOURCE_MANAGER") return null;

  const confirmedTime = confirmedAt?.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  async function confirmToday(): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/daily-confirmations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessDate }),
      });
      const result = await response.json() as { confirmedAt?: string; error?: string };
      if (!response.ok || !result.confirmedAt) {
        setError(result.error ?? "确认失败，请稍后重试");
        return false;
      }
      setConfirmedAt(new Date(result.confirmedAt));
      return true;
    } catch {
      setError("网络连接失败，无法确认今日数据");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function requestConfirmToday() {
    setError("");
    setConfirmation({
      title: "确认今日数据已填写完成？",
      description: "确认后会记录确认时间，表示你已核对今天需要填写的数据。",
      confirmLabel: "确认今日完成",
      target: businessDate,
      onConfirm: async () => { if (await confirmToday()) setConfirmation(null); },
    });
  }

  return <div className="space-y-2"><Button type="button" disabled={busy || Boolean(confirmedAt)} onClick={requestConfirmToday}>
    {confirmedAt ? `已确认 ${confirmedTime}` : "确认今日数据已填写完成"}
  </Button>{error ? <p role="alert" className="m-0 text-sm text-red-600">{error}</p> : null}<WorkflowConfirmationDialog confirmation={confirmation} busy={busy} error={confirmation ? error : ""} onClose={() => { if (!busy) { setConfirmation(null); setError(""); } }} /></div>;
}
