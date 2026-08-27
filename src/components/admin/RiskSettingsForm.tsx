"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { RiskSettings } from "../../lib/risk-settings";
import { WorkflowConfirmationDialog, type WorkflowConfirmation } from "../ui/WorkflowConfirmationDialog";

type NumericField = keyof RiskSettings;
type FieldDefinition = { name: NumericField; label: string; help: string; min: number; max?: number; step: number };

const sampleFields: FieldDefinition[] = [
  { name: "replyMinNewFans", label: "回复率最低提交号码数", help: "提交号码少于这个数时，回复率只显示“观察中”。", min: 0, step: 1 },
  { name: "groupMinNewFans", label: "入群率最低提交号码数", help: "提交号码数够了才判断入群率，避免小样本误判。", min: 0, step: 1 },
  { name: "leaveMinGroupJoin", label: "异常退群率最低入群数", help: "入群数没达标时，不用异常退群率给人下结论。", min: 0, step: 1 },
  { name: "expertMinGroupJoin", label: "推专家率最低入群数", help: "入群数达标后，推专家率才算有参考价值。", min: 0, step: 1 },
  { name: "registrationMinExpert", label: "注册率最低推专家数", help: "推专家样本太少时，注册率不参与正式判断。", min: 0, step: 1 },
  { name: "orderMinNewFans", label: "开单率最低提交号码数", help: "提交号码达到门槛后，开单率才进入排名和预警。", min: 0, step: 1 },
  { name: "efficiencyMinEffectiveFans", label: "效率最低有效粉数", help: "有效粉不够时，渠道校正效率不判好坏。", min: 0, step: 1 },
  { name: "priceComparisonMinOrders", label: "单价比较最低开单数", help: "开单数达到门槛后，才比较入金和开单相关单价。", min: 0, step: 1 },
];

function NumberInput({ field, value, onChange }: { field: FieldDefinition; value: number; onChange: (name: NumericField, value: number) => void }) {
  return <label className="block text-sm font-medium text-slate-800">
    {field.label}
    <input
      aria-label={field.label}
      type="number"
      value={value}
      min={field.min}
      max={field.max}
      step={field.step}
      required
      onChange={(event) => onChange(field.name, Number(event.target.value))}
      className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5"
    />
    <span className="mt-1.5 block text-xs font-normal leading-5 text-slate-500">{field.help}</span>
  </label>;
}

export function RiskSettingsForm({ settings }: { settings: RiskSettings }) {
  const router = useRouter();
  const [values, setValues] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<WorkflowConfirmation | null>(null);

  function update(name: NumericField, value: number) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function save(): Promise<boolean> {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/risk-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const payload = await response.json() as { error?: unknown };
        throw new Error(typeof payload.error === "string" ? payload.error : "保存失败");
      }
      setValues(await response.json() as RiskSettings);
      setMessage("已保存预警规则。系统只会给出建议，所有修改都能在操作日志中追溯。");
      router.refresh();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setConfirmation({
      title: "确认保存预警规则？",
      description: "保存后，系统会按新的样本门槛和预警阈值生成管理建议；不会自动停用员工或减少资源。",
      confirmLabel: "确认保存规则",
      target: `辅导观察 ${values.coachingDays} 天 · 限流观察 ${values.limitDays} 天 · 淘汰观察 ${values.eliminationDays} 天`,
      onConfirm: async () => { if (await save()) setConfirmation(null); },
    });
  }

  const stageFields: FieldDefinition[] = [
    { name: "trainingDays", label: "培训期结束日", help: "入职当天算第 0 天，到这一天仍属于培训期。", min: 1, step: 1 },
    { name: "observationDays", label: "观察期结束日", help: "超过这一天后才自动进入正式阶段。", min: 2, step: 1 },
  ];
  const lowPerformanceFields: FieldDefinition[] = [
    { name: "coachingEfficiency", label: "辅导效率阈值", help: "0.80 就是实际开单只达到同渠道参考值的 80%。", min: 0, max: 1, step: 0.0001 },
    { name: "coachingDays", label: "辅导连续天数", help: "只数据完整、样本达标的评价日才会计数。", min: 1, step: 1 },
    { name: "limitEfficiency", label: "限流观察效率阈值", help: "达到条件也只会建议限流观察，不会自动减少资源。", min: 0, max: 1, step: 0.0001 },
    { name: "limitDays", label: "限流观察连续天数", help: "必须由管理员查看证据后手工确认。", min: 1, step: 1 },
    { name: "eliminationEfficiency", label: "淘汰观察效率阈值", help: "这只是管理观察信号，不会自动停用账号。", min: 0, max: 1, step: 0.0001 },
    { name: "eliminationDays", label: "淘汰观察连续天数", help: "系统保留建议和证据，最终判断由管理员作出。", min: 1, step: 1 },
  ];

  return <section>
    <div className="mb-5">
      <h2 className="text-2xl font-bold">预警规则</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">这里控制“什么时候可以评价、连续多久才提醒”。样本不够时只显示观察中，不会把成员直接判为表现差。</p>
    </div>
    <form onSubmit={submit} className="max-w-5xl space-y-5">
      <div className="border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-semibold">员工阶段</h3>
        <p className="mt-1 text-sm text-slate-600">入职第 0–{values.trainingDays} 天是培训期，第 {values.trainingDays + 1}–{values.observationDays} 天是观察期，第 {values.observationDays + 1} 天起才算正式员工。</p>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">{stageFields.map((field) => <NumberInput key={field.name} field={field} value={values[field.name]} onChange={update} />)}</div>
      </div>

      <div className="border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-semibold">连续偏低</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">“合格评价日”就是数据已成熟、记录完整、渠道已定价且样本够用的一天。样本不足会暂停计数，不会直接判差。</p>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">{lowPerformanceFields.map((field) => <NumberInput key={field.name} field={field} value={values[field.name]} onChange={update} />)}</div>
        <div className="mt-5 space-y-2 rounded-md bg-blue-50 p-4 text-sm leading-6 text-blue-950">
          <p>连续 {values.coachingDays} 个合格评价日低于 {values.coachingEfficiency.toFixed(2)} 才建议辅导</p>
          <p>连续 {values.limitDays} 个合格评价日低于 {values.limitEfficiency.toFixed(2)} 才建议限流观察，仍需管理员确认</p>
          <p>连续 {values.eliminationDays} 个合格评价日低于 {values.eliminationEfficiency.toFixed(2)} 才建议淘汰观察，仍需管理员确认</p>
        </div>
      </div>

      <div className="border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-semibold">样本门槛</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">门槛是“数据至少要有多少才值得判断”。数字越大越稳，但成员进入正式评价会更慢。</p>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">{sampleFields.map((field) => <NumberInput key={field.name} field={field} value={values[field.name]} onChange={update} />)}</div>
      </div>

      {message && <p role="status" className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <button disabled={saving} className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60">{saving ? "保存中…" : "保存预警规则"}</button>
    </form>
    <WorkflowConfirmationDialog confirmation={confirmation} busy={saving} error={confirmation ? error : ""} onClose={() => { if (!saving) { setConfirmation(null); setError(""); } }} />
  </section>;
}
