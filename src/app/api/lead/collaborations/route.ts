import { NextResponse } from "next/server";
import { db } from "../../../../lib/db";
import {
  getActiveLeadGroup,
  requireLeadRequest,
} from "../../../../lib/lead-members";
import { hasAssignedRole } from "../../../../lib/role-access";
import { API_LIMITS, RequestBodyTooLargeError, readLimitedJson, tooLargeResponse } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";

export async function GET() {
  const access = await requireLeadRequest();
  if ("response" in access) return access.response;
  const group = await getActiveLeadGroup(access.actor.id);
  if (!group)
    return authorizationDenied(access.actor, "组长必须归属启用中的小组");
  const assignments = await db.groupOperatorReception.findMany({
    where: { groupOperator: { groupId: group.id } },
    select: { groupOperatorId: true, receptionistId: true },
  });
  return NextResponse.json({ assignments });
}

export async function PUT(request: Request) {
  const access = await requireLeadRequest();
  if ("response" in access) return access.response;
  let body: { groupOperatorId?: unknown; receptionistIds?: unknown };
  try {
    body = await readLimitedJson(request, API_LIMITS.collaborationBodyBytes) as typeof body;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return tooLargeResponse(error);
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  if (
    typeof body.groupOperatorId !== "string" ||
    body.groupOperatorId.length > API_LIMITS.identifierCharacters ||
    !Array.isArray(body.receptionistIds) ||
    body.receptionistIds.length > API_LIMITS.collaborationRecipients ||
    !body.receptionistIds.every((id) => typeof id === "string" && id.length <= API_LIMITS.identifierCharacters)
  ) {
    return NextResponse.json({ error: "配合关系参数不正确" }, { status: 400 });
  }
  const group = await getActiveLeadGroup(access.actor.id);
  if (!group)
    return authorizationDenied(access.actor, "组长必须归属启用中的小组");
  const receptionistIds = [...new Set(body.receptionistIds as string[])];
  const people = await db.user.findMany({
    where: {
      id: { in: [body.groupOperatorId, ...receptionistIds] },
      groupId: group.id,
      active: true,
    },
    select: { id: true, role: true, active: true, roleAssignments: { select: { role: true } } },
  });
  const operator = people.find((person) => person.id === body.groupOperatorId);
  const validReceptionists = people.filter(
    (person) =>
      receptionistIds.includes(person.id) && hasAssignedRole(person, "RECEPTION"),
  );
  if (
    !operator ||
    !hasAssignedRole(operator, "GROUP_OPERATOR") ||
    validReceptionists.length !== receptionistIds.length
  ) {
    return NextResponse.json(
      { error: "只能给本组启用的炒群员配置前台接粉员" },
      { status: 400 },
    );
  }
  await db.$transaction(async (client) => {
    await client.groupOperatorReception.deleteMany({
      where: { groupOperatorId: body.groupOperatorId as string },
    });
    if (receptionistIds.length) {
      // 同一个接粉员只能归属一个炒群员；重新勾选时视为调岗到当前炒群员。
      await client.groupOperatorReception.deleteMany({
        where: {
          receptionistId: { in: receptionistIds },
          groupOperatorId: { not: body.groupOperatorId as string },
        },
      });
      await client.groupOperatorReception.createMany({
        data: receptionistIds.map((receptionistId) => ({
          groupOperatorId: body.groupOperatorId as string,
          receptionistId,
        })),
      });
    }
  }, { isolationLevel: "Serializable" });
  return NextResponse.json({
    groupOperatorId: body.groupOperatorId,
    receptionistIds,
  });
}
