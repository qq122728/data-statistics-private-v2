"use client";

import { useCallback, useState } from "react";
import { requestJson } from "@/lib/backend";
import { normalizeImportedCustomerNumber } from "@/lib/import-parse";
import { IconCheck, IconPlus } from "./Icons";

type WorkspaceRole = "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
type HistoricalStage = "NOT_REPLIED" | "REPLIED" | "JOINED" | "INTRODUCED" | "CONTACTED" | "TRACKING" | "REGISTERED";
type MemberOption = { id: string; name: string; current: boolean; roles: string[] };
type ClaimContext = {
  baselineOn: string;
  today: string;
  actor: { id: string; name: string };
  allowedStages: HistoricalStage[];
  channels: Array<{ id: string; name: string }>;
  members: {
    reception: MemberOption[];
    groupOperator: MemberOption[];
    expert: MemberOption[];
  };
  claims: Array<{
    id: string;
    phone: string;
    customerName: string | null;
    historicalBaselineStage: HistoricalStage | null;
    historicalReviewStatus: "PENDING" | "APPROVED" | "RETURNED" | null;
    historicalSourceName: string | null;
    invalidReason: string | null;
    notes: string | null;
    ownerId: string;
    groupOperatorOwnerId: string | null;
    expertOwnerId: string | null;
    canEdit: boolean;
    batch: { channelId: string; sourceDate: string };
  }>;
};

const roleStages: Record<WorkspaceRole, HistoricalStage[]> = {
  RECEPTION: ["NOT_REPLIED", "REPLIED"],
  GROUP_OPERATOR: ["JOINED", "INTRODUCED"],
  EXPERT: ["INTRODUCED", "CONTACTED", "TRACKING", "REGISTERED"],
};

const stageLabels: Record<HistoricalStage, string> = {
  NOT_REPLIED: "启用前未回复",
  REPLIED: "启用前已回复、未入群",
  JOINED: "启用前已进群、未推专家",
  INTRODUCED: "启用前已推专家、未注册",
  CONTACTED: "启用前专家已接触、待完善资料",
  TRACKING: "启用前专家跟进中、未注册",
  REGISTERED: "启用前已注册、未开单",
};

const reviewLabels = { PENDING: "正在保存", APPROVED: "已记录", RETURNED: "需修改" } as const;

function MemberSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: MemberOption[];
  onChange: (value: string) => void;
}) {
  return <div>
    <label className="label">{label} *</label>
    <select className="field" style={{ width: "100%" }} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">请选择</option>
      {options.map((member) => <option key={member.id} value={member.id}>
        {member.name}{member.current ? "" : "（历史成员）"}
      </option>)}
    </select>
  </div>;
}

export function HistoricalCustomerClaimPanel({ workspaceRole, onSaved }: { workspaceRole: WorkspaceRole; onSaved?: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<ClaimContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [phone, setPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [channelId, setChannelId] = useState("");
  const [baselineOn, setBaselineOn] = useState("");
  const [baselineStage, setBaselineStage] = useState<HistoricalStage>(roleStages[workspaceRole][0]);
  const [receptionOwnerId, setReceptionOwnerId] = useState("");
  const [groupOperatorOwnerId, setGroupOperatorOwnerId] = useState("");
  const [expertOwnerId, setExpertOwnerId] = useState("");
  const [notes, setNotes] = useState("");
  const [editingClaimId, setEditingClaimId] = useState<string | null>(null);

  const applyContext = useCallback((result: ClaimContext, keepOwners = false) => {
    setContext(result);
    setBaselineOn(result.baselineOn);
    const stages = roleStages[workspaceRole].filter((stage) => result.allowedStages.includes(stage));
    setBaselineStage((current) => stages.includes(current) ? current : stages[0]);
    setChannelId((current) => result.channels.some((channel) => channel.id === current) ? current : (result.channels[0]?.id ?? ""));
    if (!keepOwners) {
      setReceptionOwnerId(workspaceRole === "RECEPTION" ? result.actor.id : (result.members.reception[0]?.id ?? ""));
      setGroupOperatorOwnerId(workspaceRole === "GROUP_OPERATOR" ? result.actor.id : (result.members.groupOperator[0]?.id ?? ""));
      setExpertOwnerId(workspaceRole === "EXPERT" ? result.actor.id : (result.members.expert[0]?.id ?? ""));
    } else {
      setReceptionOwnerId((current) => result.members.reception.some((member) => member.id === current) ? current : (workspaceRole === "RECEPTION" ? result.actor.id : (result.members.reception[0]?.id ?? "")));
      setGroupOperatorOwnerId((current) => result.members.groupOperator.some((member) => member.id === current) ? current : (workspaceRole === "GROUP_OPERATOR" ? result.actor.id : (result.members.groupOperator[0]?.id ?? "")));
      setExpertOwnerId((current) => result.members.expert.some((member) => member.id === current) ? current : (workspaceRole === "EXPERT" ? result.actor.id : (result.members.expert[0]?.id ?? "")));
    }
  }, [workspaceRole]);

  async function load(date?: string, keepOwners = false) {
    setLoading(true);
    setError("");
    try {
      const query = date ? `?baselineOn=${encodeURIComponent(date)}` : "";
      applyContext(await requestJson<ClaimContext>(`/api/historical-claims${query}`), keepOwners);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "历史认领选项读取失败");
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!context) await load();
  }

  async function changeBaselineOn(value: string) {
    setBaselineOn(value);
    if (value) await load(value, true);
  }

  async function submit() {
    setError("");
    setSuccess("");
    if (!phone.trim()) { setError("请填写客户号码"); return; }
    if (!channelId) { setError("请选择历史渠道"); return; }
    if (!baselineOn) { setError("请选择启用前状态日期"); return; }
    if (!receptionOwnerId) { setError("请选择当时的接粉负责人"); return; }
    if (["JOINED", "INTRODUCED", "CONTACTED", "TRACKING", "REGISTERED"].includes(baselineStage) && !groupOperatorOwnerId) { setError("请选择当时的炒群负责人"); return; }
    if (["INTRODUCED", "CONTACTED", "TRACKING", "REGISTERED"].includes(baselineStage) && !expertOwnerId) { setError("请选择当时的专家负责人"); return; }
    setSaving(true);
    try {
      await requestJson("/api/historical-claims", {
        method: editingClaimId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimId: editingClaimId ?? undefined,
          phone: phone.trim(),
          customerName: customerName.trim() || undefined,
          channelId,
          baselineStage,
          baselineOn,
          receptionOwnerId,
          groupOperatorOwnerId: ["JOINED", "INTRODUCED", "CONTACTED", "TRACKING", "REGISTERED"].includes(baselineStage) ? groupOperatorOwnerId : undefined,
          expertOwnerId: ["INTRODUCED", "CONTACTED", "TRACKING", "REGISTERED"].includes(baselineStage) ? expertOwnerId : undefined,
          notes: notes.trim() || undefined,
        }),
      });
      setPhone(""); setCustomerName(""); setNotes("");
      setEditingClaimId(null);
      setSuccess(editingClaimId ? "客户进度已保存；不会改变每日统计。" : "客户进度已保存到本人的通讯录；不会增加或修改每日统计。");
      await load(baselineOn, true);
      await onSaved?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  const availableStages = roleStages[workspaceRole].filter((stage) => context?.allowedStages.includes(stage));

  async function editReturned(claim: ClaimContext["claims"][number]) {
    setEditingClaimId(claim.id);
    setPhone(claim.phone);
    setCustomerName(claim.customerName ?? "");
    setChannelId(claim.batch.channelId);
    setBaselineStage(claim.historicalBaselineStage ?? roleStages[workspaceRole][0]);
    setReceptionOwnerId(claim.ownerId);
    setGroupOperatorOwnerId(claim.groupOperatorOwnerId ?? "");
    setExpertOwnerId(claim.expertOwnerId ?? "");
    setNotes(claim.notes ?? "");
    setError("");
    setSuccess("");
    await changeBaselineOn(claim.batch.sourceDate);
  }

  function cancelEdit() {
    setEditingClaimId(null);
    setPhone("");
    setCustomerName("");
    setNotes("");
    setError("");
  }

  return <>
    <button type="button" className="btn" data-variant={open ? "primary" : undefined} onClick={() => void toggle()}>
      <IconPlus size={14} />添加一行
    </button>
    {open ? <div style={{
      width: "100%", border: "1.5px dashed var(--accent)", borderRadius: "var(--radius-lg)",
      background: "var(--accent-soft)", padding: 14, display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ width: 20, height: 20, borderRadius: 999, background: "var(--accent)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>+</span>
        <strong>{editingClaimId ? "编辑客户进度行" : "添加客户进度行"}</strong>
        <span className="muted">填写具体客户和本岗位状态；这里只维护客户进度，不增加或修改每日统计。</span>
      </div>

      {loading && !context ? <div className="muted">正在读取真实渠道和历史人员…</div> : null}
      {error ? <div role="alert" style={{ color: "var(--bad)" }}>{error}</div> : null}
      {success ? <div role="status" style={{ color: "var(--ok)" }}>{success}</div> : null}

      {context ? <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
          <div><label className="label">客户号码 *</label><input className="field" style={{ width: "100%" }} value={phone} onChange={(event) => setPhone(event.target.value)} onBlur={(event) => setPhone(normalizeImportedCustomerNumber(event.target.value))} placeholder="输入任意长度，自动保留末6位" maxLength={80} /><span className="muted">保存和查重统一使用数字末6位</span></div>
          <div><label className="label">客户姓名</label><input className="field" style={{ width: "100%" }} value={customerName} onChange={(event) => setCustomerName(event.target.value)} maxLength={100} /></div>
          <div><label className="label">来源渠道 *</label><select className="field" style={{ width: "100%" }} value={channelId} onChange={(event) => setChannelId(event.target.value)}><option value="">请选择</option>{context.channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></div>
          <div><label className="label">客户状态日期 *</label><input className="field" type="date" style={{ width: "100%" }} value={baselineOn} max={context.today} onChange={(event) => void changeBaselineOn(event.target.value)} /></div>
          <div><label className="label">当前状态 *</label><select className="field" style={{ width: "100%" }} value={baselineStage} onChange={(event) => setBaselineStage(event.target.value as HistoricalStage)}>{availableStages.map((stage) => <option key={stage} value={stage}>{stageLabels[stage]}</option>)}</select></div>
          {workspaceRole === "RECEPTION" ? <div><label className="label">当时接粉负责人</label><input className="field" style={{ width: "100%" }} value={context.actor.name} disabled /></div> : <MemberSelect label="当时接粉负责人" value={receptionOwnerId} options={context.members.reception} onChange={setReceptionOwnerId} />}
          {workspaceRole === "GROUP_OPERATOR" ? <div><label className="label">当时炒群负责人</label><input className="field" style={{ width: "100%" }} value={context.actor.name} disabled /></div> : workspaceRole === "EXPERT" ? <MemberSelect label="当时炒群负责人" value={groupOperatorOwnerId} options={context.members.groupOperator} onChange={setGroupOperatorOwnerId} /> : null}
          {workspaceRole === "EXPERT" ? <div><label className="label">当时专家负责人</label><input className="field" style={{ width: "100%" }} value={context.actor.name} disabled /></div> : workspaceRole === "GROUP_OPERATOR" && baselineStage === "INTRODUCED" ? <MemberSelect label="当时专家负责人" value={expertOwnerId} options={context.members.expert} onChange={setExpertOwnerId} /> : null}
        </div>
        <div><label className="label">跟进备注</label><textarea className="field" style={{ width: "100%", minHeight: 72, resize: "vertical" }} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="例如：以前已回复，今天重新联系。这里的修改不会影响每日统计。" maxLength={1000} /></div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span className="muted">保存后进入本岗位客户通讯录；组长和管理账号只能查看，客户进度不会生成每日统计数字。</span>
          <div style={{ display: "flex", gap: 8 }}>{editingClaimId ? <button type="button" className="btn" disabled={saving} onClick={cancelEdit}>取消编辑</button> : null}<button type="button" className="btn" data-variant="primary" data-confirm-action={editingClaimId ? "保存客户进度修改" : "保存客户进度"} disabled={saving || loading || availableStages.length === 0} onClick={() => void submit()}><IconCheck size={15} />{saving ? "正在保存…" : editingClaimId ? "保存修改" : "保存客户进度"}</button></div>
        </div>

        {context.claims.length ? <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <strong style={{ fontSize: 13.5 }}>我的最近添加</strong>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>{context.claims.slice(0, 6).map((claim) => <span key={claim.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span className="badge" data-tone={claim.historicalReviewStatus === "RETURNED" ? "bad" : "ok"}>{claim.phone} · {claim.historicalReviewStatus ? reviewLabels[claim.historicalReviewStatus] : "已记录"}</span>{claim.canEdit ? <button type="button" className="btn" data-size="sm" onClick={() => void editReturned(claim)}>编辑</button> : null}</span>)}</div>
        </div> : null}
      </> : null}
    </div> : null}
  </>;
}
