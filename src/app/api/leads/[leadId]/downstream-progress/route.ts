import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../../../lib/auth";
import { db } from "../../../../../lib/db";
import { API_LIMITS } from "../../../../../lib/request-limits";
import { hasAssignedRole } from "../../../../../lib/role-access";
import { authorizationDenied } from "../../../../../lib/security-events";

const expertActivityKinds = ["EXPERT_CONTACTED", "REGISTERED", "PLAN_UPDATED"] as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      return NextResponse.json({ error: error.message }, { status: 401 });
    throw error;
  }

  if (!hasAssignedRole(user, "RECEPTION"))
    return authorizationDenied(user, "只有客户原始接粉员可以查看后续进度");

  const { leadId } = await params;
  if (leadId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "客户参数过长" }, { status: 400 });
  const customer = await db.leadCustomer.findFirst({
    where: { id: leadId, ownerId: user.id },
    select: {
      id: true,
      phone: true,
      customerName: true,
      joinedOn: true,
      leftOn: true,
      groupStatus: true,
      expertIntroducedOn: true,
      expertContactedOn: true,
      expertContactNote: true,
      expertWorkflowStage: true,
      expertStageChangedAt: true,
      expertTrackingStartedAt: true,
      registeredOn: true,
      nextPlan: true,
      nextFollowUpOn: true,
      notes: true,
      groupOperatorOwner: { select: { name: true } },
      expertOwner: { select: { name: true } },
      owner: {
        select: {
          receptionistAssignments: {
            select: { groupOperator: { select: { name: true } } },
            take: 1,
          },
        },
      },
      customerOrder: { select: { openedOn: true, voidedAt: true } },
    },
  });
  if (!customer)
    return NextResponse.json({ error: "找不到该客户或无权查看" }, { status: 404 });

  const [groupProgress, expertProgress] = await Promise.all([
    db.leadActivity.findMany({
      where: { leadId, kind: "GROUP_PROGRESS_UPDATED" },
      select: { id: true, occurredOn: true, note: true, actor: { select: { name: true } } },
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 60,
    }),
    db.leadActivity.findMany({
      where: {
        leadId,
        kind: { in: [...expertActivityKinds] },
        actor: { role: { in: ["EXPERT", "LEAD"] } },
      },
      select: {
        id: true,
        occurredOn: true,
        kind: true,
        note: true,
        actor: { select: { name: true } },
      },
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 60,
    }),
  ]);

  return NextResponse.json({
    customer: {
      ...customer,
      groupOperatorName:
        customer.groupOperatorOwner?.name
        ?? customer.owner.receptionistAssignments[0]?.groupOperator.name
        ?? null,
      hasActiveOrder: Boolean(customer.customerOrder && !customer.customerOrder.voidedAt),
    },
    groupProgress,
    expertProgress,
  });
}
