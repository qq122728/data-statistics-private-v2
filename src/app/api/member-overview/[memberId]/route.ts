import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { localDateYYYYMMDD } from "../../../../lib/dates";
import {
  loadMemberEvidence,
  MemberEvidenceAccessError,
} from "../../../../lib/analytics/member-evidence";
import { getSystemSettings } from "../../../../lib/settings";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";

type RouteContext = { params: Promise<{ memberId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
  if (actor.role !== "ADMIN" && actor.role !== "LEAD") return authorizationDenied(actor, "无权查看该成员");

  const { memberId } = await context.params;
  if (memberId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "成员参数过长" }, { status: 400 });
  const settings = await getSystemSettings();
  try {
    const evidence = await loadMemberEvidence(actor, memberId, localDateYYYYMMDD(new Date(), settings.timezone));
    return NextResponse.json(evidence);
  } catch (error) {
    if (error instanceof MemberEvidenceAccessError) return authorizationDenied(actor, "无权查看该成员");
    throw error;
  }
}
