"use client";

import { FormEvent, useMemo, useState } from "react";

type RecruitmentSource = "DIRECT" | "AGENT" | null;
type Member = {
  id: string;
  name: string;
  roleLabel: string;
  departmentName: string;
  groupName: string;
  hireDate: string | null;
  recruitmentSource: RecruitmentSource;
  referrerName: string | null;
};

const sourceLabel: Record<Exclude<RecruitmentSource, null>, string> = {
  DIRECT: "公司直营",
  AGENT: "代理介绍",
};

function profileLabel(member: Member) {
  if (!member.recruitmentSource) return "待补";
  return member.recruitmentSource === "AGENT"
    ? `代理介绍 · ${member.referrerName ?? "待补介绍人"}`
    : sourceLabel[member.recruitmentSource];
}

export function EmploymentSourcePanel({ members }: { members: Member[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const selected = useMemo(() => members.find((member) => member.id === selectedId) ?? null, [members, selectedId]);
  const [source, setSource] = useState<RecruitmentSource>(null);
  const [referrerName, setReferrerName] = useState("");

  function beginEdit(member: Member) {
    setSelectedId(member.id);
    setSource(member.recruitmentSource);
    setReferrerName(member.referrerName ?? "");
    setMessage(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/finance/employment-profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, recruitmentSource: source, referrerName }),
      });
      const payload = await response.json() as { error?: string; member?: Member };
      if (!response.ok) throw new Error(payload.error || "保存失败，请稍后重试");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请稍后重试");
      setSaving(false);
    }
  }

  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-4">
      <div><h2 className="text-base font-bold text-slate-950">员工入职来源</h2><p className="mt-1 text-sm text-slate-600">旧员工先显示“待补”。财务补齐后，月度考勤表会自动带上“公司直营”或“代理介绍 + 介绍人”。</p></div>
      <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">待补 {members.filter((member) => !member.recruitmentSource).length} 人</span>
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead className="border-b border-slate-200 bg-white text-slate-500"><tr><th className="px-4 py-3 font-medium">员工</th><th className="px-4 py-3 font-medium">公司 / 小组</th><th className="px-4 py-3 font-medium">岗位</th><th className="px-4 py-3 font-medium">入职日期</th><th className="px-4 py-3 font-medium">归属代理</th><th className="px-4 py-3 text-right font-medium">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{members.map((member) => <tr key={member.id} className="hover:bg-slate-50/70"><td className="px-4 py-3 font-medium text-slate-900">{member.name}</td><td className="px-4 py-3 text-slate-600">{member.departmentName} / {member.groupName}</td><td className="px-4 py-3 text-slate-600">{member.roleLabel}</td><td className="px-4 py-3 text-slate-600">{member.hireDate ?? "待补"}</td><td className="px-4 py-3"><span className={member.recruitmentSource ? "text-slate-700" : "font-medium text-amber-700"}>{profileLabel(member)}</span></td><td className="px-4 py-3 text-right"><button type="button" onClick={() => beginEdit(member)} className="rounded-lg border border-blue-200 px-3 py-1.5 font-medium text-blue-700 hover:bg-blue-50">{member.recruitmentSource ? "修改" : "补充"}</button></td></tr>)}</tbody></table></div>
    {!members.length && <p className="px-4 py-8 text-center text-sm text-slate-500">当前没有需要列入考勤的在职员工。</p>}
    {selected && <div className="border-t border-slate-200 bg-slate-50 px-4 py-4"><form onSubmit={save} className="flex flex-wrap items-end gap-3"><div className="min-w-48 flex-1"><label className="block text-sm font-medium text-slate-700">{selected.name} 的入职来源<select value={source ?? ""} onChange={(event) => setSource((event.target.value || null) as RecruitmentSource)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"><option value="">待补（暂不填写）</option><option value="DIRECT">公司直营</option><option value="AGENT">代理介绍</option></select></label></div>{source === "AGENT" && <div className="min-w-48 flex-1"><label className="block text-sm font-medium text-slate-700">介绍人<input autoFocus value={referrerName} onChange={(event) => setReferrerName(event.target.value)} maxLength={60} required placeholder="填写介绍人姓名或代号" className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5" /></label></div>}<div className="flex gap-2"><button type="button" onClick={() => { setSelectedId(null); setMessage(null); }} className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200">取消</button><button disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? "保存中…" : "保存"}</button></div></form>{message && <p role="alert" className="mt-2 text-sm text-red-700">{message}</p>}</div>}
  </section>;
}
