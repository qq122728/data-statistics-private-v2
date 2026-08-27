"use client";

import type { ReactNode } from "react";
import { Button } from "../ui/Button";

export function AnalysisState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <section className="panel empty-state"><h2 className="text-base font-semibold text-slate-700">{title}</h2>{description ? <p className="mt-2">{description}</p> : null}{action ? <div className="mt-4">{action}</div> : null}</section>;
}

export function AnalysisErrorState({ onReload }: { onReload: () => void }) {
  return <AnalysisState
    title="查询数据时出错"
    description="当前筛选条件已保留，可重新加载再试一次。"
    action={<Button type="button" onClick={onReload}>重新加载</Button>}
  />;
}

export function AnalysisFilterNotice({ message }: { message?: string }) {
  return message ? <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{message}</p> : null;
}
