"use client";

import { useState } from "react";
import { CalendarMinus, Clock, SignIn, SignOut } from "@phosphor-icons/react";
import { WorkflowConfirmationDialog, type WorkflowConfirmation } from "../ui/WorkflowConfirmationDialog";

type ClockStatus = "NORMAL" | "LATE" | "EARLY" | null;
type LeaveType = "PERSONAL" | "SICK" | "OTHER" | null;
type AttendanceRecord = { clockInAt: string | Date | null; clockOutAt: string | Date | null; clockInStatus: ClockStatus; clockOutStatus: ClockStatus; leaveType: LeaveType; leaveReason: string | null; leaveAt: string | Date | null } | null;
type TeamMember = { id: string; name: string; role: "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT"; record: AttendanceRecord };

const roleLabel = { LEAD: "组长", RECEPTION: "前台接粉", GROUP_OPERATOR: "前台炒群", EXPERT: "前台专家" } as const;
const statusLabel = { NORMAL: "正常", LATE: "迟到", EARLY: "早退" } as const;
const leaveLabel = { PERSONAL: "事假", SICK: "病假", OTHER: "其他" } as const;

function time(value: string | Date | null, timezone: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function ClockResult({ status }: { status: ClockStatus }) {
  if (!status) return <span className="text-slate-400">—</span>;
  const warning = status === "LATE" || status === "EARLY";
  return <span className={warning ? "font-semibold text-amber-700" : "font-semibold text-emerald-700"}>{statusLabel[status]}</span>;
}

export function AttendancePanel({
  businessDate,
  localTime,
  timezone,
  groupName,
  scheduleLabel,
  initialRecord,
  team = [],
  isLead,
}: {
  businessDate: string;
  localTime: string;
  timezone: string;
  groupName: string;
  scheduleLabel: string;
  initialRecord: AttendanceRecord;
  team?: TeamMember[];
  isLead: boolean;
}) {
  const [record, setRecord] = useState(initialRecord);
  const [busy, setBusy] = useState<"CLOCK_IN" | "CLOCK_OUT" | "REQUEST_LEAVE" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<WorkflowConfirmation | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<Exclude<LeaveType, null>>("PERSONAL");
  const [leaveReason, setLeaveReason] = useState("");
  const clockedIn = Boolean(record?.clockInAt);
  const clockedOut = Boolean(record?.clockOutAt);
  const onLeave = Boolean(record?.leaveAt);
  const clockedInCount = team.filter((member) => member.record?.clockInAt).length;
  const lateCount = team.filter((member) => member.record?.clockInStatus === "LATE").length;

  async function punch(action: "CLOCK_IN" | "CLOCK_OUT" | "REQUEST_LEAVE", leave?: { type: Exclude<LeaveType, null>; reason: string }): Promise<boolean> {
    setBusy(action); setError(""); setMessage("");
    try {
      const response = await fetch("/api/attendance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, leaveType: leave?.type, leaveReason: leave?.reason }) });
      const result = await response.json() as { error?: string; record?: AttendanceRecord };
      if (!response.ok || !result.record) { setError(result.error ?? "打卡失败，请稍后重试"); return false; }
      setRecord(result.record);
      setMessage(action === "CLOCK_IN" ? "上班打卡成功，开始今天的工作吧。" : action === "CLOCK_OUT" ? "下班打卡成功，辛苦了。" : "请假已登记，今天不会计入未打卡。" );
      return true;
    } catch { setError("网络连接失败，暂时无法打卡"); return false; }
    finally { setBusy(null); }
  }

  function requestPunch(action: "CLOCK_IN" | "CLOCK_OUT") {
    const isClockIn = action === "CLOCK_IN";
    setError("");
    setConfirmation({
      title: `确认${isClockIn ? "上班" : "下班"}打卡？`,
      description: `系统会按${groupName}当地时间 ${localTime} 记录本次${isClockIn ? "上班" : "下班"}时间。`,
      confirmLabel: `确认${isClockIn ? "上班" : "下班"}打卡`,
      target: `${businessDate} · ${scheduleLabel}`,
      onConfirm: async () => { if (await punch(action)) setConfirmation(null); },
    });
  }

  function requestLeave() {
    setError("");
    if (leaveReason.trim().length < 2) { setError("请至少填写 2 个字的请假原因"); return; }
    const reason = leaveReason.trim();
    setLeaveOpen(false);
    setConfirmation({
      title: "确认提交请假？",
      description: "确认后今天会标记为已请假，不能再进行上、下班打卡。",
      target: `${businessDate} · ${leaveLabel[leaveType]} · ${reason}`,
      confirmLabel: "确认请假",
      tone: "danger",
      onConfirm: async () => { if (await punch("REQUEST_LEAVE", { type: leaveType, reason })) setConfirmation(null); },
    });
  }

  return <div className="space-y-3">
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div><h1 className="m-0 text-xl font-bold text-slate-900">上下班打卡</h1><p className="mt-1 text-sm text-slate-500">{groupName} · {businessDate} · 当地时间 {localTime}</p></div>
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-sm font-semibold text-blue-700"><Clock size={16} />工作时间 {scheduleLabel}</span>
      </div>
      <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
        <div className="bg-white px-4 py-4"><p className="m-0 text-sm font-semibold text-slate-700">上班打卡</p><p className="mt-1 text-2xl font-bold text-slate-950">{onLeave ? "已请假" : time(record?.clockInAt ?? null, timezone)}</p><p className="mt-1 text-sm">{onLeave ? <span className="font-semibold text-violet-700">{leaveLabel[record?.leaveType as Exclude<LeaveType, null>]} · {record?.leaveReason}</span> : <ClockResult status={record?.clockInStatus ?? null} />}</p><button type="button" disabled={clockedIn || onLeave || busy !== null} onClick={() => requestPunch("CLOCK_IN")} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"><SignIn size={18} />{busy === "CLOCK_IN" ? "打卡中…" : clockedIn ? "已上班打卡" : onLeave ? "今日已请假" : "上班打卡"}</button></div>
        <div className="bg-white px-4 py-4"><p className="m-0 text-sm font-semibold text-slate-700">下班打卡</p><p className="mt-1 text-2xl font-bold text-slate-950">{time(record?.clockOutAt ?? null, timezone)}</p><p className="mt-1 text-sm"><ClockResult status={record?.clockOutStatus ?? null} /></p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!clockedIn || clockedOut || onLeave || busy !== null} onClick={() => requestPunch("CLOCK_OUT")} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"><SignOut size={18} />{busy === "CLOCK_OUT" ? "打卡中…" : clockedOut ? "已下班打卡" : "下班打卡"}</button><button type="button" disabled={clockedIn || onLeave || busy !== null} onClick={() => { setError(""); setLeaveOpen(true); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-violet-300 bg-violet-50 px-4 text-sm font-semibold text-violet-800 hover:bg-violet-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"><CalendarMinus size={18} />{onLeave ? "已请假" : "请假"}</button></div>{!clockedIn && !onLeave && <p className="mt-2 text-xs text-slate-500">请先完成上班打卡；如当天不能上班，请选择请假。</p>}</div>
      </div>
      {message ? <p role="status" className="m-0 border-t border-emerald-100 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</p> : null}
      {error ? <p role="alert" className="m-0 border-t border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p> : null}
    </section>

    <WorkflowConfirmationDialog confirmation={confirmation} busy={busy !== null} error={confirmation ? error : ""} onClose={() => { if (!busy) { setConfirmation(null); setError(""); } }} />

    {leaveOpen ? <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><section role="dialog" aria-modal="true" aria-label="登记请假" className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="m-0 text-lg font-bold text-slate-900">登记请假</h2><p className="mb-0 mt-1 text-xs text-slate-500">{businessDate} · {groupName}</p></div><button type="button" onClick={() => setLeaveOpen(false)} className="text-sm text-slate-500 hover:text-slate-800">关闭</button></div><div className="space-y-3 p-5"><label className="field-label">请假类型<select value={leaveType} onChange={(event) => setLeaveType(event.target.value as Exclude<LeaveType, null>)} className="control"><option value="PERSONAL">事假</option><option value="SICK">病假</option><option value="OTHER">其他</option></select></label><label className="field-label">请假原因<textarea value={leaveReason} onChange={(event) => setLeaveReason(event.target.value)} maxLength={300} placeholder="例如：身体不适，今天请病假" className="control min-h-24 resize-y" /></label>{error ? <p role="alert" className="m-0 text-sm text-red-700">{error}</p> : null}</div><div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4"><button type="button" onClick={() => setLeaveOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">取消</button><button type="button" onClick={requestLeave} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700">下一步确认</button></div></section></div> : null}

    {isLead ? <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3"><div><h2 className="m-0 text-base font-bold text-slate-900">本组今日出勤</h2><p className="mt-1 text-xs text-slate-500">已上班 {clockedInCount} 人 · 未上班 {team.length - clockedInCount} 人 · 迟到 {lateCount} 人</p></div><span className="text-xs text-slate-500">只显示启用中的组员</span></div><div className="data-table-wrap"><table className="data-table min-w-[680px]"><thead><tr><th>成员</th><th>岗位</th><th>上班时间</th><th>上班状态</th><th>下班时间</th><th>下班状态</th></tr></thead><tbody>{team.map((member) => <tr key={member.id}><td className="font-semibold text-slate-900">{member.name}</td><td>{roleLabel[member.role]}</td><td>{time(member.record?.clockInAt ?? null, timezone)}</td><td><ClockResult status={member.record?.clockInStatus ?? null} /></td><td>{time(member.record?.clockOutAt ?? null, timezone)}</td><td><ClockResult status={member.record?.clockOutStatus ?? null} /></td></tr>)}{!team.length ? <tr><td colSpan={6} className="empty-state">本组还没有启用中的员工</td></tr> : null}</tbody></table></div></section> : null}
  </div>;
}
