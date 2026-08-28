"use client";

import { CheckCircle, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HistoryGroup, HistoryMetricTotals } from "../../lib/history-groups";
import { BatchPicker } from "../entry/BatchPicker";
import { FieldError } from "../entry/FieldError";
import { Button } from "../ui/Button";
import { validateFanBreakdown } from "../../lib/validation";
import {
  formatHistoryMetric,
  historyMetricDisplay,
  type HistoryBatch,
} from "./history-display";

const countFields = [
  { field: "newFans", label: "提交号码数量" },
  { field: "effectiveFans", label: "有效粉数量" },
  { field: "noNumber", label: "无号码数量" },
  { field: "duplicateFans", label: "撞粉数量" },
  { field: "replies", label: "回复数量" },
  { field: "groupJoin", label: "入群数量" },
  { field: "groupLeave", label: "退群数量" },
  { field: "expertIntro", label: "推专家数量" },
  { field: "registration", label: "注册数量" },
  { field: "order", label: "开单数量" },
] as const satisfies ReadonlyArray<{
  field: Exclude<keyof HistoryMetricTotals, "rechargeCents" | "withdrawalCents" | "channelPerformanceCents">;
  label: string;
}>;

type CountField = (typeof countFields)[number]["field"];
type AmountField = "recharge" | "withdrawal" | "channelPerformance";
type Draft = {
  occurredOn: string;
  batchId: string;
  metrics: Record<CountField | AmountField, string>;
};
type ParsedDraft = { occurredOn: string; batchId: string; metrics: HistoryMetricTotals };
type FieldErrors = Record<string, string>;
type Change = { field: string; label: string; from: string; to: string };

function initialDraft(group: HistoryGroup): Draft {
  return {
    occurredOn: group.occurredOn,
    batchId: group.batchId,
    metrics: {
      newFans: String(group.metrics.newFans),
      effectiveFans: String(group.metrics.effectiveFans),
      noNumber: String(group.metrics.noNumber),
      duplicateFans: String(group.metrics.duplicateFans),
      replies: String(group.metrics.replies),
      groupJoin: String(group.metrics.groupJoin),
      groupLeave: String(group.metrics.groupLeave),
      expertIntro: String(group.metrics.expertIntro),
      registration: String(group.metrics.registration),
      order: String(group.metrics.order),
      recharge: (group.metrics.rechargeCents / 100).toFixed(2),
      withdrawal: (group.metrics.withdrawalCents / 100).toFixed(2),
      channelPerformance: (group.metrics.channelPerformanceCents / 100).toFixed(2),
    },
  };
}

function yuanToCents(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return 0;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

function parseDraft(draft: Draft): { value: ParsedDraft | null; fields: FieldErrors } {
  const fields: FieldErrors = {};
  const metrics = {} as HistoryMetricTotals;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.occurredOn)) fields.occurredOn = "请选择发生日期";
  if (!draft.batchId) fields.batchId = "请选择来源批次";
  for (const { field, label } of countFields) {
    const raw = draft.metrics[field].trim();
    const value = !raw ? 0 : /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isSafeInteger(value)) fields[`metrics.${field}`] = `${label}请填写非负整数`;
    else metrics[field] = value;
  }
  for (const [draftField, metricField] of [
    ["recharge", "rechargeCents"],
    ["withdrawal", "withdrawalCents"],
    ["channelPerformance", "channelPerformanceCents"],
  ] as const) {
    const amountCents = yuanToCents(draft.metrics[draftField]);
    if (amountCents === null) fields[`metrics.${metricField}`] = "请填写最多两位小数的非负美元金额";
    else metrics[metricField] = amountCents;
  }

  const breakdown = validateFanBreakdown(metrics);
  if (!breakdown.valid) fields["metrics.effectiveFans"] = breakdown.message;

  return {
    value: Object.keys(fields).length ? null : { occurredOn: draft.occurredOn, batchId: draft.batchId, metrics },
    fields,
  };
}

function batchLabel(batch: HistoryBatch): string {
  return `${batch.sourceDate} · ${batch.channel.name} · ${batch.group.name}`;
}

function serverFieldErrors(value: unknown): FieldErrors {
  if (!value || typeof value !== "object") return {};
  const rawFields = (value as { fields?: unknown }).fields;
  if (!rawFields || typeof rawFields !== "object" || Array.isArray(rawFields)) return {};
  return Object.fromEntries(Object.entries(rawFields).flatMap(([field, messages]) => {
    if (typeof messages === "string") return [[field, messages]];
    if (Array.isArray(messages) && typeof messages[0] === "string") return [[field, messages[0]]];
    return [];
  }));
}

export function HistoryEditDrawer({
  group,
  batches,
  onClose,
  onSaved,
}: {
  group: HistoryGroup;
  batches: HistoryBatch[];
  onClose: () => void;
  onSaved: (group: HistoryGroup) => void;
}) {
  const [draft, setDraft] = useState(() => initialDraft(group));
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const writableBatches = useMemo(() => batches.some((batch) => batch.id === group.batchId)
    ? batches
    : [{
        id: group.batch.id,
        sourceDate: group.sourceDate,
        group: { id: group.batch.group.id, name: group.batch.group.name },
        channel: { id: group.batch.channel.id, name: group.batch.channel.name },
      }, ...batches], [batches, group]);
  const parsed = useMemo(() => parseDraft(draft), [draft]);
  const batchById = useMemo(() => new Map(writableBatches.map((batch) => [batch.id, batch])), [writableBatches]);
  const originalBatch = batchById.get(group.batchId);
  const selectedBatch = batchById.get(draft.batchId);
  const changes = useMemo<Change[]>(() => {
    if (!parsed.value) return [];
    const next: Change[] = [];
    if (parsed.value.occurredOn !== group.occurredOn) next.push({ field: "occurredOn", label: "发生日期", from: group.occurredOn, to: parsed.value.occurredOn });
    if (parsed.value.batchId !== group.batchId) next.push({ field: "batchId", label: "来源批次", from: originalBatch ? batchLabel(originalBatch) : group.sourceDate, to: selectedBatch ? batchLabel(selectedBatch) : parsed.value.batchId });
    for (const { field, label } of historyMetricDisplay) {
      if (parsed.value.metrics[field] !== group.metrics[field]) next.push({
        field: `metrics.${field}`,
        label,
        from: formatHistoryMetric(field, group.metrics[field]),
        to: formatHistoryMetric(field, parsed.value.metrics[field]),
      });
    }
    return next;
  }, [group, originalBatch, parsed.value, selectedBatch]);
  const hasPotentialChanges = parsed.value ? changes.length > 0 : true;

  useEffect(() => {
    const background = document.querySelector<HTMLElement>(".app-shell");
    const backgroundWasInert = background?.hasAttribute("inert") ?? false;
    background?.setAttribute("inert", "");
    closeButtonRef.current?.focus();

    return () => {
      if (!backgroundWasInert) background?.removeAttribute("inert");
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!saving) onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  function clearFieldError(field: string) {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function updateDraft(change: Partial<Pick<Draft, "occurredOn" | "batchId">>) {
    setDraft((current) => ({ ...current, ...change }));
    setReviewing(false);
    setError("");
    for (const field of Object.keys(change)) clearFieldError(field);
  }

  function updateMetric(field: CountField | AmountField, value: string) {
    setDraft((current) => ({ ...current, metrics: { ...current.metrics, [field]: value } }));
    setReviewing(false);
    setError("");
    const amountMetricField = {
      recharge: "rechargeCents",
      withdrawal: "withdrawalCents",
      channelPerformance: "channelPerformanceCents",
    }[field as AmountField];
    clearFieldError(`metrics.${amountMetricField ?? field}`);
  }

  function inspectChanges() {
    setError("");
    setFieldErrors(parsed.fields);
    if (!parsed.value) {
      setReviewing(false);
      setError("请检查填写内容");
      return;
    }
    setReviewing(changes.length > 0);
  }

  async function save() {
    const checked = parseDraft(draft);
    if (!checked.value || !changes.length) {
      setFieldErrors(checked.fields);
      setReviewing(false);
      return;
    }
    setSaving(true);
    setError("");
    setFieldErrors({});
    try {
      const response = await fetch("/api/history", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventIds: group.eventIds,
          fingerprint: group.fingerprint,
          ...checked.value,
        }),
      });
      const result = await response.json().catch(() => ({})) as { error?: unknown; fields?: unknown; group?: HistoryGroup };
      if (!response.ok) {
        setFieldErrors(serverFieldErrors(result));
        setError(typeof result.error === "string" ? result.error : "保存失败，请稍后重试");
        setReviewing(false);
        return;
      }
      if (!result.group) throw new Error("服务器未返回更新后的数据");
      onSaved(result.group);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败，请稍后重试");
      setReviewing(false);
    } finally {
      setSaving(false);
    }
  }

  const drawer = <div
    data-testid="history-edit-backdrop"
    className="history-edit-backdrop"
    onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}
  >
    <aside ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="history-edit-title" tabIndex={-1} className="history-edit-drawer">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div><p className="m-0 text-xs font-bold tracking-wider text-blue-600">历史记录</p><h2 id="history-edit-title" className="mt-1 text-xl font-bold text-slate-900">编辑历史数据</h2><p className="mt-1 text-sm text-slate-500">先检查变更，确认后才会保存。</p></div>
        <button ref={closeButtonRef} type="button" aria-label="关闭编辑" disabled={saving} onClick={onClose} className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"><X size={19} aria-hidden="true" /></button>
      </header>

      <div className="history-edit-body">
        {error ? <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="field-label">发生日期<input aria-label="发生日期" type="date" value={draft.occurredOn} onChange={(event) => updateDraft({ occurredOn: event.target.value })} required aria-invalid={fieldErrors.occurredOn ? true : undefined} aria-describedby={fieldErrors.occurredOn ? "history-occurred-on-error" : undefined} className="control w-full" /><FieldError id="history-occurred-on-error" label="发生日期" message={fieldErrors.occurredOn} /></label>
          <label className="field-label">录入人<input aria-label="录入人" value={group.enteredBy.name} readOnly className="control w-full bg-slate-50 text-slate-500" /></label>
          <div className="sm:col-span-2"><BatchPicker batches={writableBatches} value={draft.batchId} onChange={(batchId) => updateDraft({ batchId })} error={fieldErrors.batchId} /></div>
        </div>

        <section className="history-edit-section" aria-labelledby="history-edit-acquisition"><h3 id="history-edit-acquisition">提交号码与回复</h3><div className="grid gap-4 sm:grid-cols-2">{countFields.slice(0, 5).map(({ field, label }) => <CountInput key={field} field={field} label={label} value={draft.metrics[field]} error={fieldErrors[`metrics.${field}`]} onChange={(value) => updateMetric(field, value)} />)}</div></section>
        <section className="history-edit-section" aria-labelledby="history-edit-group"><h3 id="history-edit-group">入群与退群</h3><div className="grid gap-4 sm:grid-cols-2">{countFields.slice(5, 7).map(({ field, label }) => <CountInput key={field} field={field} label={label} value={draft.metrics[field]} error={fieldErrors[`metrics.${field}`]} onChange={(value) => updateMetric(field, value)} />)}</div></section>
        <section className="history-edit-section" aria-labelledby="history-edit-conversion"><h3 id="history-edit-conversion">转化与入金</h3><div className="grid gap-4 sm:grid-cols-2">{countFields.slice(7).map(({ field, label }) => <CountInput key={field} field={field} label={label} value={draft.metrics[field]} error={fieldErrors[`metrics.${field}`]} onChange={(value) => updateMetric(field, value)} />)}<label className="field-label">总入金（美元）<input aria-label="总入金（美元）" type="number" min="0" step="0.01" value={draft.metrics.recharge} onChange={(event) => updateMetric("recharge", event.target.value)} aria-invalid={fieldErrors["metrics.rechargeCents"] ? true : undefined} aria-describedby={fieldErrors["metrics.rechargeCents"] ? "history-recharge-error" : undefined} className="control w-full" /><FieldError id="history-recharge-error" label="总入金（美元）" message={fieldErrors["metrics.rechargeCents"]} /></label></div></section>
        <section className="history-edit-section" aria-labelledby="history-edit-financial"><h3 id="history-edit-financial">财务记录</h3><div className="grid gap-4 sm:grid-cols-2">
          <label className="field-label">出金金额（美元）<input aria-label="出金金额（美元）" type="number" min="0" step="0.01" value={draft.metrics.withdrawal} onChange={(event) => updateMetric("withdrawal", event.target.value)} aria-invalid={fieldErrors["metrics.withdrawalCents"] ? true : undefined} aria-describedby={fieldErrors["metrics.withdrawalCents"] ? "history-withdrawal-error" : undefined} className="control w-full" /><FieldError id="history-withdrawal-error" label="出金金额（美元）" message={fieldErrors["metrics.withdrawalCents"]} /></label>
          <label className="field-label">通道业绩（美元）<input aria-label="通道业绩（美元）" type="number" min="0" step="0.01" value={draft.metrics.channelPerformance} onChange={(event) => updateMetric("channelPerformance", event.target.value)} aria-invalid={fieldErrors["metrics.channelPerformanceCents"] ? true : undefined} aria-describedby={fieldErrors["metrics.channelPerformanceCents"] ? "history-channel-performance-error" : undefined} className="control w-full" /><FieldError id="history-channel-performance-error" label="通道业绩（美元）" message={fieldErrors["metrics.channelPerformanceCents"]} /></label>
        </div></section>

        {reviewing ? <section className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4" aria-labelledby="history-change-heading">
          <div className="flex items-center gap-2 text-blue-800"><CheckCircle size={19} weight="fill" aria-hidden="true" /><h3 id="history-change-heading" className="text-sm font-bold">请确认本次变更</h3></div>
          <ul aria-label="变更内容" className="mt-3 grid gap-2">{changes.map((change) => <li key={change.field} className="rounded-lg bg-white px-3 py-2 text-sm text-slate-700"><strong>{change.label}</strong>：{change.from} → {change.to}</li>)}</ul>
        </section> : null}
      </div>

      <footer className="history-edit-footer">
        {reviewing ? <><Button type="button" variant="secondary" disabled={saving} onClick={() => setReviewing(false)}>返回修改</Button><Button type="button" disabled={saving || changes.length === 0} onClick={save}>{saving ? "保存中…" : "确认保存"}</Button></> : <Button type="button" disabled={!hasPotentialChanges || saving} onClick={inspectChanges} className="min-w-32">检查修改</Button>}
      </footer>
    </aside>
  </div>;

  return typeof document === "undefined" ? null : createPortal(drawer, document.body);
}

function CountInput({ field, label, value, error, onChange }: {
  field: CountField;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const errorId = `history-${field}-error`;
  return <label className="field-label">{label}<input aria-label={label} type="number" min="0" step="1" value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} className="control w-full" /><FieldError id={errorId} label={label} message={error} /></label>;
}
