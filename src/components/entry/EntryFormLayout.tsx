"use client";

import type { Icon } from "@phosphor-icons/react";
import { FloppyDisk, Plus, Rows, Trash } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Button } from "../ui/Button";

export type EntryStep<T extends string> = {
  id: T;
  label: string;
  description: string;
  icon: Icon;
};

export function EntryStepper<T extends string>({ steps, active, onChange }: {
  steps: EntryStep<T>[];
  active: T;
  onChange: (step: T) => void;
}) {
  return <nav data-testid="entry-stepper" aria-label="录入步骤" className="entry-stepper">
    <p className="entry-stepper-kicker">录入流程</p>
    <div className="entry-step-list">
      {steps.map((step, index) => {
        const StepIcon = step.icon;
        const selected = active === step.id;
        return <button key={step.id} type="button" aria-current={selected ? "step" : undefined} onClick={() => onChange(step.id)} className="entry-step" data-active={selected}>
          <span className="entry-step-icon"><StepIcon size={18} /></span>
          <span className="min-w-0"><span className="entry-step-number">第 {index + 1} 步</span><span className="entry-step-label">{step.label}</span></span>
        </button>;
      })}
    </div>
    <p className="entry-stepper-note">每类数据可分别保存，无需一次填完全部步骤。</p>
  </nav>;
}

export function EntryFormHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="entry-form-header"><p>{eyebrow}</p><h2>{title}</h2><span>{description}</span></header>;
}

export function EntryEmptyState({ title, description, onAdd }: { title: string; description: string; onAdd: () => void }) {
  return <div data-testid="entry-empty-state" className="entry-empty-state">
    <span className="entry-empty-icon"><Rows size={24} /></span>
    <h3>{title}</h3>
    <p>{description}</p>
    <Button type="button" variant="secondary" onClick={onAdd}><Plus size={16} />添加第一行</Button>
  </div>;
}

export function EntryFormActions({ onAdd, saving, saveLabel, hasRows }: { onAdd: () => void; saving: boolean; saveLabel: string; hasRows: boolean }) {
  return <div data-testid="entry-form-actions" className="entry-form-actions">
    <Button type="button" variant="secondary" onClick={onAdd} disabled={saving}><Plus size={16} />添加一行</Button>
    <Button type="submit" disabled={saving || !hasRows} className="min-w-32"><FloppyDisk size={16} />{saving ? "保存中…" : saveLabel}</Button>
  </div>;
}

export function EntryDeleteButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="entry-delete-button"><Trash size={15} />删除本行</button>;
}

export function EntryFeedback({ notice, error }: { notice: string; error: string }) {
  if (!notice && !error) return null;
  return <div className="px-5 pb-4">{notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">{notice}</p>}{error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}</div>;
}

export function EntryRows({ children }: { children: ReactNode }) {
  return <div className="entry-rows">{children}</div>;
}
