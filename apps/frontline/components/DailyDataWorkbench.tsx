"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { requestJson } from "@/lib/backend";

type Position = "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
type Status = "DRAFT" | "PENDING" | "RESOURCE_PENDING" | "RETURNED" | "APPROVED" | "CORRECTION_PENDING";
type Values = {
  dispatchCount: number; duplicateCount: number; lowAmountCount: number; noWsCount: number; effectiveCount: number;
  replyCount: number; joinCount: number; operatorReceivedCount: number; normalLeaveCount: number;
  abnormalLeaveCount: number; currentInGroupCount: number; expertIntroCount: number; expertReceivedCount: number;
  expertContactedCount: number; registrationCount: number; orderCount: number; cryptoInitialDepositCents: number;
  bankInitialDepositCents: number; cryptoRechargeCents: number; bankRechargeCents: number; withdrawalCents: number;
};
type Person = { id: string; name: string; active: boolean; current: boolean; roles: string[] };
type Entry = {
  id: string; businessDate: string; position: Position; status: Status; reviewReason: string | null;
  channel: { id: string; name: string }; sourceReception: Person | null; sourceGroupOperator: Person | null;
  currentRevision: (Values & { version: number; changeReason: string | null }) | null;
  approvedRevision: (Values & { version: number }) | null;
};
type Context = {
  actorId: string; today: string; timezone: string; positions: Position[];
  channels: Array<{ id: string; name: string; channelType: string }>;
  members: Person[];
  sourceReceptionPairings: Array<{ receptionistId: string; effectiveFrom: string; effectiveTo: string | null }>;
  entries: Entry[];
};

const positionLabel: Record<Position, string> = { RECEPTION: "接粉", GROUP_OPERATOR: "炒群", EXPERT: "专家" };
const statusMeta: Record<Status, { label: string; tone: string }> = {
  DRAFT: { label: "旧数据待处理", tone: "warn" }, PENDING: { label: "旧数据待处理", tone: "warn" },
  RESOURCE_PENDING: { label: "资源部核对中", tone: "warn" },
  RETURNED: { label: "资源部已退回", tone: "bad" }, APPROVED: { label: "已计入正式统计", tone: "ok" },
  CORRECTION_PENDING: { label: "旧纠错待处理", tone: "warn" },
};
const emptyValues: Values = {
  dispatchCount: 0, duplicateCount: 0, lowAmountCount: 0, noWsCount: 0, effectiveCount: 0,
  replyCount: 0, joinCount: 0, operatorReceivedCount: 0, normalLeaveCount: 0, abnormalLeaveCount: 0,
  currentInGroupCount: 0, expertIntroCount: 0, expertReceivedCount: 0, expertContactedCount: 0,
  registrationCount: 0, orderCount: 0, cryptoInitialDepositCents: 0, bankInitialDepositCents: 0,
  cryptoRechargeCents: 0, bankRechargeCents: 0, withdrawalCents: 0,
};

function NumberField({ label, value, onChange, hint }: { label: string; value: number; onChange: (value: number) => void; hint?: string }) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(String(value)); }, [focused, value]);
  return <label><span className="label">{label}</span><input className="field tnum" type="number" min="0" step="1" value={text} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); if (text === "") { setText("0"); onChange(0); } }} onChange={(event) => { const raw = event.target.value; setText(raw); if (raw !== "") onChange(Math.max(0, Number.parseInt(raw, 10) || 0)); }} style={{ width: "100%" }} />{hint ? <span className="muted" style={{ display: "block", marginTop: 4, fontSize: 11.5 }}>{hint}</span> : null}</label>;
}

function MoneyField({ label, cents, onChange }: { label: string; cents: number; onChange: (value: number) => void }) {
  const [text, setText] = useState((cents / 100).toFixed(2));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText((cents / 100).toFixed(2)); }, [cents, focused]);
  return <label><span className="label">{label}</span><div style={{ position: "relative" }}><span style={{ position: "absolute", left: 11, top: 9, color: "var(--ink-3)" }}>$</span><input className="field tnum" type="number" min="0" step="0.01" value={text} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); if (text === "") { setText("0.00"); onChange(0); } }} onChange={(event) => { const raw = event.target.value; setText(raw); if (raw !== "") onChange(Math.max(0, Math.round((Number(raw) || 0) * 100))); }} style={{ width: "100%", paddingLeft: 25 }} /></div></label>;
}

function rowSummary(entry: Entry) {
  const v = entry.currentRevision ?? emptyValues;
  if (entry.position === "RECEPTION") return `下发 ${v.dispatchCount} · 有效 ${v.effectiveCount} · 回复 ${v.replyCount} · 进群 ${v.joinCount}`;
  if (entry.position === "GROUP_OPERATOR") return `接手 ${v.operatorReceivedCount} · 在群 ${v.currentInGroupCount} · 推专家 ${v.expertIntroCount}`;
  const deposit = v.cryptoInitialDepositCents + v.bankInitialDepositCents + v.cryptoRechargeCents + v.bankRechargeCents;
  return `接手 ${v.expertReceivedCount} · 注册 ${v.registrationCount} · 开单 ${v.orderCount} · 总入金 $${(deposit / 100).toFixed(2)}`;
}

function isHistoricalImport(entry: Entry) {
  const reason = entry.currentRevision?.changeReason ?? "";
  return reason.includes("迁移") || reason.includes("结转") || reason.includes("代录") || reason.includes("历史导入");
}

export function DailyDataWorkbench() {
  const [context, setContext] = useState<Context | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [position, setPosition] = useState<Position>("RECEPTION");
  const [businessDate, setBusinessDate] = useState("");
  const [channelId, setChannelId] = useState("");
  const [sourceReceptionId, setSourceReceptionId] = useState("");
  const [sourceReceptionTouched, setSourceReceptionTouched] = useState(false);
  const [sourceGroupOperatorId, setSourceGroupOperatorId] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [values, setValues] = useState<Values>(emptyValues);

  async function load() {
    setLoading(true); setError("");
    try {
      const next = await requestJson<Context>("/api/daily-stats");
      setContext(next);
      setBusinessDate((current) => current || next.today);
      setPosition((current) => next.positions.includes(current) ? current : next.positions[0] ?? "RECEPTION");
      setChannelId((current) => current || next.channels[0]?.id || "");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "每日数据读取失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const allGroupMembers = useMemo(() => context?.members ?? [], [context]);
  const defaultReceptionIds = useMemo(() => [...new Set((context?.sourceReceptionPairings ?? [])
    .filter((pairing) => pairing.effectiveFrom <= businessDate && (!pairing.effectiveTo || pairing.effectiveTo >= businessDate))
    .map((pairing) => pairing.receptionistId))], [businessDate, context]);
  const defaultReceptionMembers = useMemo(() => allGroupMembers.filter((member) => defaultReceptionIds.includes(member.id)), [allGroupMembers, defaultReceptionIds]);
  const otherReceptionMembers = useMemo(() => allGroupMembers.filter((member) => !defaultReceptionIds.includes(member.id)), [allGroupMembers, defaultReceptionIds]);
  const effectiveCount = Math.max(0, values.dispatchCount - values.duplicateCount - values.lowAmountCount - values.noWsCount);

  useEffect(() => {
    if (!context || editingId || position !== "GROUP_OPERATOR" || sourceReceptionTouched) return;
    setSourceReceptionId(defaultReceptionIds.length === 1 ? defaultReceptionIds[0] : "");
  }, [context, defaultReceptionIds, editingId, position, sourceReceptionTouched]);

  function setValue(key: keyof Values, value: number) { setValues((current) => ({ ...current, [key]: value })); }
  function resetForm(nextPosition = position) {
    setEditingId(null); setPosition(nextPosition); setSourceReceptionId(""); setSourceGroupOperatorId("");
    setSourceReceptionTouched(false);
    setChangeReason(""); setValues(emptyValues); setSuccess(""); setError("");
  }
  function edit(entry: Entry) {
    setEditingId(entry.id); setPosition(entry.position); setBusinessDate(entry.businessDate); setChannelId(entry.channel.id);
    setSourceReceptionId(entry.sourceReception?.id ?? ""); setSourceGroupOperatorId(entry.sourceGroupOperator?.id ?? "");
    setSourceReceptionTouched(true);
    setValues({ ...emptyValues, ...(entry.currentRevision ?? {}) }); setChangeReason(""); setError(""); setSuccess("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setSuccess("");
    try {
      await requestJson("/api/daily-stats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        ...(editingId ? { entryId: editingId } : {}), businessDate, position, channelId,
        sourceReceptionId: sourceReceptionId || null, sourceGroupOperatorId: sourceGroupOperatorId || null,
        changeReason: changeReason || null, values,
      }) });
      const successMessage = position === "RECEPTION"
        ? (editingId ? "修改已保存，资源部刷新后会看到最新版" : "数据已保存，已直接进入资源部核对列表")
        : (editingId ? "修改已保存，最新版已直接计入正式统计" : "数据已保存并直接计入正式统计，可继续填写另一条来源线");
      resetForm(position);
      setSuccess(successMessage);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); }
    finally { setBusy(false); }
  }

  if (loading && !context) return <section className="card" style={{ padding: 48, textAlign: "center" }}>正在读取每日数据…</section>;
  if (!context) return <section className="card" style={{ padding: 24, color: "var(--bad)" }}>{error || "每日数据不可用"}</section>;

  const editingEntry = editingId ? context.entries.find((entry) => entry.id === editingId) : null;
  return <div style={{ display: "grid", gap: 18 }}>
    <section className="card" style={{ padding: 20 }}>
      <div className="card-head"><div><h2 className="card-title">填写每日数据</h2><p className="card-note">只填写统计数字，不需要导入具体号码；客户进度不会自动改变这里的数据。</p></div><span className="badge" data-tone="ok">独立统计账</span></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0" }}>{context.positions.map((item) => <button key={item} type="button" className="btn" data-variant={position === item ? "primary" : undefined} onClick={() => resetForm(item)}>{positionLabel[item]}数据</button>)}</div>
      {error ? <div className="notice" data-tone="bad" style={{ marginBottom: 12 }}>{error}</div> : null}
      {success ? <div className="notice" data-tone="ok" style={{ marginBottom: 12 }}>{success}</div> : null}
      <form onSubmit={save} style={{ display: "grid", gap: 16 }}>
        <div className="form-grid cols-3">
          <label><span className="label">统计日期</span><input className="field" type="date" max={context.today} value={businessDate} onChange={(event) => { setBusinessDate(event.target.value); if (!editingId) setSourceReceptionTouched(false); }} required style={{ width: "100%" }} /></label>
          <label><span className="label">渠道</span><select className="field" value={channelId} onChange={(event) => setChannelId(event.target.value)} required style={{ width: "100%" }}><option value="">请选择</option>{context.channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
          <label><span className="label">填写岗位</span><input className="field" value={positionLabel[position]} disabled style={{ width: "100%" }} /></label>
          {position !== "RECEPTION" ? <label><span className="label">来源接粉</span><select className="field" value={sourceReceptionId} onChange={(event) => { setSourceReceptionId(event.target.value); setSourceReceptionTouched(true); }} required style={{ width: "100%" }}><option value="">{position === "GROUP_OPERATOR" && defaultReceptionIds.length > 1 ? `请选择当天实际来源（${defaultReceptionIds.length} 个默认配对）` : "请选择"}</option>{position === "GROUP_OPERATOR" && defaultReceptionMembers.length ? <optgroup label="当天默认配对">{defaultReceptionMembers.map((member) => <option key={member.id} value={member.id}>{member.name}{member.id === context.actorId ? "（本人）" : ""}{member.current ? "" : "（历史成员）"}</option>)}</optgroup> : null}<optgroup label={position === "GROUP_OPERATOR" ? "本人或本组其他成员" : "本组全部成员"}>{(position === "GROUP_OPERATOR" ? otherReceptionMembers : allGroupMembers).map((member) => <option key={member.id} value={member.id}>{member.name}{member.id === context.actorId ? "（本人）" : ""}{member.current ? "" : "（历史成员）"}</option>)}</optgroup></select>{position === "GROUP_OPERATOR" && sourceReceptionId && !defaultReceptionIds.includes(sourceReceptionId) ? <small style={{ display: "block", marginTop: 4, color: "var(--warn)" }}>当前选择不是当天默认配对，请确认这条数据的实际来源。</small> : position === "GROUP_OPERATOR" ? <small className="muted">系统按统计日期优先选择当时的配对；兼岗或临时协作时可改选本人及本组其他成员。</small> : null}</label> : null}
          {position === "EXPERT" ? <label><span className="label">来源炒群</span><select className="field" value={sourceGroupOperatorId} onChange={(event) => setSourceGroupOperatorId(event.target.value)} required style={{ width: "100%" }}><option value="">请选择</option>{allGroupMembers.map((member) => <option key={member.id} value={member.id}>{member.name}{member.current ? "" : "（历史成员）"}</option>)}</select><small className="muted">专家来源可选择本组所有现任或历史成员，不按当前岗位过滤。</small></label> : null}
        </div>

        {position === "RECEPTION" ? <div className="form-grid cols-4">
          <NumberField label="总下发粉数量" value={values.dispatchCount} onChange={(value) => setValue("dispatchCount", value)} />
          <NumberField label="撞粉" value={values.duplicateCount} onChange={(value) => setValue("duplicateCount", value)} hint="从总下发中扣除后计算有效粉" />
          <NumberField label="低金额" value={values.lowAmountCount} onChange={(value) => setValue("lowAmountCount", value)} />
          <NumberField label="无 WhatsApp" value={values.noWsCount} onChange={(value) => setValue("noWsCount", value)} />
          <label><span className="label">有效粉（自动计算）</span><input className="field tnum" value={effectiveCount} disabled style={{ width: "100%", fontWeight: 700 }} /></label>
          <NumberField label="回复" value={values.replyCount} onChange={(value) => setValue("replyCount", value)} />
          <NumberField label="进群" value={values.joinCount} onChange={(value) => setValue("joinCount", value)} />
        </div> : null}

        {position === "GROUP_OPERATOR" ? <div className="form-grid cols-5">
          <NumberField label="接手/进群数量" value={values.operatorReceivedCount} onChange={(value) => setValue("operatorReceivedCount", value)} />
          <NumberField label="正常退群" value={values.normalLeaveCount} onChange={(value) => setValue("normalLeaveCount", value)} />
          <NumberField label="异常退群" value={values.abnormalLeaveCount} onChange={(value) => setValue("abnormalLeaveCount", value)} />
          <NumberField label="当前在群" value={values.currentInGroupCount} onChange={(value) => setValue("currentInGroupCount", value)} hint="当天结束时的快照" />
          <NumberField label="推专家" value={values.expertIntroCount} onChange={(value) => setValue("expertIntroCount", value)} />
        </div> : null}

        {position === "EXPERT" ? <>
          <div className="form-grid cols-4">
            <NumberField label="接手客户" value={values.expertReceivedCount} onChange={(value) => setValue("expertReceivedCount", value)} />
            <NumberField label="专家已联系" value={values.expertContactedCount} onChange={(value) => setValue("expertContactedCount", value)} />
            <NumberField label="注册" value={values.registrationCount} onChange={(value) => setValue("registrationCount", value)} />
            <NumberField label="开单" value={values.orderCount} onChange={(value) => setValue("orderCount", value)} />
          </div>
          <div className="form-grid cols-5">
            <MoneyField label="加密货币首充" cents={values.cryptoInitialDepositCents} onChange={(value) => setValue("cryptoInitialDepositCents", value)} />
            <MoneyField label="银行卡首充" cents={values.bankInitialDepositCents} onChange={(value) => setValue("bankInitialDepositCents", value)} />
            <MoneyField label="加密货币续充" cents={values.cryptoRechargeCents} onChange={(value) => setValue("cryptoRechargeCents", value)} />
            <MoneyField label="银行卡续充" cents={values.bankRechargeCents} onChange={(value) => setValue("bankRechargeCents", value)} />
            <MoneyField label="出金" cents={values.withdrawalCents} onChange={(value) => setValue("withdrawalCents", value)} />
          </div>
        </> : null}

        {editingEntry?.approvedRevision ? <label><span className="label">更正原因</span><textarea className="field" rows={2} value={changeReason} onChange={(event) => setChangeReason(event.target.value)} required placeholder="例如：回复数少填 1 人" style={{ width: "100%" }} /></label> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {editingId ? <button type="button" className="btn" onClick={() => resetForm(position)}>取消修改</button> : null}
          <button type="submit" className="btn" data-variant="primary" data-confirm-action={editingId ? "保存每日数据修改" : "保存每日数据"} disabled={busy}>{busy ? "保存中…" : editingId ? "保存修改" : "保存数据"}</button>
        </div>
      </form>
    </section>

    <section className="card">
      <div className="card-head"><div><h2 className="card-title">我的填写记录</h2><p className="card-note">接粉保存后由资源部直接核对；炒群和专家保存后直接进入正式统计。8 月 27 日等历史导入记录也归本人，可直接点“编辑”更正；即使后来换过岗位，旧岗位记录仍可修改。</p></div><button className="btn" data-size="sm" onClick={() => void load()}>刷新</button></div>
      <div className="table-scroll"><table className="grid-table"><thead><tr><th>日期/岗位</th><th>渠道与来源</th><th>数据摘要</th><th>状态</th><th style={{ textAlign: "center" }}>操作</th></tr></thead><tbody>
        {!context.entries.length ? <tr><td colSpan={5} style={{ padding: 38, textAlign: "center", color: "var(--ink-3)" }}>还没有填写记录</td></tr> : context.entries.map((entry) => <tr key={entry.id}>
          <td><strong>{entry.businessDate}</strong><div className="muted">{positionLabel[entry.position]}</div>{isHistoricalImport(entry) ? <span className="badge" data-tone="ok" style={{ marginTop: 5 }}>历史导入 · 可编辑</span> : null}</td>
          <td><strong>{entry.channel.name}</strong><div className="muted">{entry.sourceReception ? `接粉：${entry.sourceReception.name}` : ""}{entry.sourceGroupOperator ? ` · 炒群：${entry.sourceGroupOperator.name}` : ""}</div></td>
          <td>{rowSummary(entry)}{entry.currentRevision?.changeReason ? <div className="muted">更正：{entry.currentRevision.changeReason}</div> : null}</td>
          <td><span className="badge" data-tone={statusMeta[entry.status].tone}>{statusMeta[entry.status].label}</span>{entry.reviewReason ? <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 5 }}>{entry.reviewReason}</div> : null}</td>
          <td><div style={{ display: "flex", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
            {["DRAFT", "RETURNED", "RESOURCE_PENDING", "APPROVED"].includes(entry.status) ? <button className="btn" data-size="sm" onClick={() => edit(entry)}>编辑</button> : <span className="muted">旧流程数据</span>}
          </div></td>
        </tr>)}</tbody></table></div>
    </section>
  </div>;
}
