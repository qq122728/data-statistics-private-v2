/**
 * 接粉环节的交接说明。它只读客户的前台信息，避免和炒群、专家各自的跟进记录混写。
 */
export function ReceptionSituationCell({
  repliedOn,
  followUpCount,
  lastFollowedUpOn,
  notes,
}: {
  repliedOn: string | null;
  followUpCount: number;
  lastFollowedUpOn: string | null;
  notes: string | null;
}) {
  return <td className="min-w-52 max-w-72 align-top">
    <div className="lead-situation-cell">
      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${repliedOn ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
        {repliedOn ? `已联系 · ${repliedOn}` : "尚未联系"}
      </span>
      <span className="lead-situation-meta">回访 {followUpCount} 次{lastFollowedUpOn ? ` · 最近 ${lastFollowedUpOn}` : ""}</span>
      <p className="lead-situation-summary mt-1.5" title={notes ?? undefined}>客户情况：{notes ?? "前台暂未填写"}</p>
    </div>
  </td>;
}
