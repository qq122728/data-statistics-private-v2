import { NextResponse } from "next/server";
import { db } from "../../../../../lib/db";
import { recordAudit } from "../../../../../lib/audit";
import { getActiveLeadGroup, requireLeadRequest } from "../../../../../lib/lead-members";
import { hasAssignedRole } from "../../../../../lib/role-access";
import {
  activeGroupOperatorHandoffWhere,
  handoffActiveGroupOperatorCustomers,
} from "../../../../../lib/group-operator-collaboration";
import { API_LIMITS, RequestBodyTooLargeError, readLimitedJson, tooLargeResponse } from "../../../../../lib/request-limits";
import { authorizationDenied } from "../../../../../lib/security-events";

type Body = {
  mode?: unknown;
  receptionistId?: unknown;
  fromGroupOperatorId?: unknown;
  toGroupOperatorId?: unknown;
  expectedCount?: unknown;
  reason?: unknown;
};

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= API_LIMITS.identifierCharacters;
}

export async function POST(request: Request) {
  const access = await requireLeadRequest();
  if ("response" in access) return access.response;
  let body: Body;
  try {
    body = await readLimitedJson(request, API_LIMITS.collaborationBodyBytes) as Body;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return tooLargeResponse(error);
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  if (
    (body.mode !== "preview" && body.mode !== "confirm")
    || !validId(body.receptionistId)
    || !validId(body.fromGroupOperatorId)
    || !validId(body.toGroupOperatorId)
    || body.fromGroupOperatorId === body.toGroupOperatorId
    || (body.mode === "confirm" && (!Number.isInteger(body.expectedCount) || (body.expectedCount as number) < 0))
    || (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.trim().length < 2 || body.reason.length > 200))
  ) {
    return NextResponse.json({ error: "交接参数不正确" }, { status: 400 });
  }
  const group = await getActiveLeadGroup(access.actor.id);
  if (!group) return authorizationDenied(access.actor, "组长必须归属启用中的小组");
  const people = await db.user.findMany({
    where: {
      id: { in: [body.receptionistId, body.fromGroupOperatorId, body.toGroupOperatorId] },
      groupId: group.id,
      active: true,
    },
    select: { id: true, role: true, active: true, roleAssignments: { select: { role: true } } },
  });
  const receptionist = people.find((person) => person.id === body.receptionistId);
  const fromOperator = people.find((person) => person.id === body.fromGroupOperatorId);
  const toOperator = people.find((person) => person.id === body.toGroupOperatorId);
  if (
    !receptionist || !hasAssignedRole(receptionist, "RECEPTION")
    || !fromOperator || !hasAssignedRole(fromOperator, "GROUP_OPERATOR")
    || !toOperator || !hasAssignedRole(toOperator, "GROUP_OPERATOR")
  ) {
    return NextResponse.json({ error: "交接双方必须是本组启用中的接粉员和炒群员" }, { status: 400 });
  }

  const where = activeGroupOperatorHandoffWhere({
    groupId: group.id,
    receptionistId: body.receptionistId,
    fromGroupOperatorId: body.fromGroupOperatorId,
  });
  if (body.mode === "preview") {
    const count = await db.leadCustomer.count({ where });
    return NextResponse.json({ count });
  }

  const result = await db.$transaction(async (tx) => {
    const handoff = await handoffActiveGroupOperatorCustomers({
      tx,
      groupId: group.id,
      receptionistId: body.receptionistId as string,
      fromGroupOperatorId: body.fromGroupOperatorId as string,
      toGroupOperatorId: body.toGroupOperatorId as string,
      expectedCount: body.expectedCount as number,
    });
    if (handoff.conflict) return handoff;
    await recordAudit(tx, {
      actorId: access.actor.id,
      action: "GROUP_OPERATOR_CUSTOMERS_HANDED_OFF",
      entityType: "TeamGroup",
      entityId: group.id,
      summary: {
        receptionistId: body.receptionistId,
        fromGroupOperatorId: body.fromGroupOperatorId,
        toGroupOperatorId: body.toGroupOperatorId,
        transferredCount: handoff.transferredCount,
        reason: typeof body.reason === "string" ? body.reason.trim() : null,
      },
    });
    return handoff;
  }, { isolationLevel: "Serializable" });
  if (result.conflict) {
    return NextResponse.json({ error: "在办客户数量刚刚发生变化，请重新预览后再确认", count: result.actualCount }, { status: 409 });
  }
  return NextResponse.json({ transferredCount: result.transferredCount });
}
