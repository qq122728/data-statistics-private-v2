import { AuthorizationError, requireRole } from "../../../lib/auth";
import { LeadMemberManager } from "../../../components/lead-members/LeadMemberManager";
import { getActiveLeadGroup } from "../../../lib/lead-members";
import { recordSecurityEvent } from "../../../lib/security-events";

export default async function TeamMembersPage() {
  let user;
  try {
    user = await requireRole("LEAD");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      recordSecurityEvent({ event: "AUTHORIZATION_DENIED", userId: error.actor?.id ?? null, teamId: error.actor?.groupId ?? null, result: "denied" });
      return <main className="min-h-screen bg-slate-50 p-8"><div className="mx-auto max-w-3xl bg-white p-8"><h1 className="text-2xl font-bold">无权访问</h1><p className="mt-2 text-slate-600">只有组长可以进入组员管理。</p></div></main>;
    }
    throw error;
  }

  const group = await getActiveLeadGroup(user.id);
  if (!group) {
    recordSecurityEvent({ event: "AUTHORIZATION_DENIED", userId: user.id, teamId: user.groupId, result: "denied" });
    return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-6 lg:p-8"><div className="mx-auto max-w-4xl rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900"><h1 className="text-2xl font-bold">当前小组不可用</h1><p className="mt-2 text-sm leading-6">你的组长账号没有归属启用中的小组，暂时不能查看或管理组员。请联系管理员恢复小组后再试。</p></div></main>;
  }

  return <main className="page-shell lead-compact-page text-slate-900"><LeadMemberManager groupName={group.name} /></main>;
}
