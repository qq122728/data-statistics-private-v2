import { NextResponse } from "next/server";
import { db } from "../../../../lib/db";
import { canAppointOrTransferLead, type GroupScope } from "../../../../lib/org-permissions";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { requireOrgManagerRequest } from "../_auth";

const candidateRoles = ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const;

/**
 * 返回某个目标小组可选择的组长候选人。候选人的现小组和目标小组都必须在调用方
 * 的管理范围内，因此公司/部门管理员不会通过这个读取接口看到范围外的人员。
 * 只返回选择器需要的姓名、岗位和现小组，不暴露账号、密码或登录信息。
 */
export async function GET(request: Request) {
  const access = await requireOrgManagerRequest();
  if ("response" in access) return access.response;
  const groupId = new URL(request.url).searchParams.get("groupId") ?? "";
  if (!groupId || groupId.length > API_LIMITS.identifierCharacters) {
    return NextResponse.json({ error: "小组参数不正确" }, { status: 400 });
  }

  const targetGroup = await db.teamGroup.findFirst({
    where: { id: groupId, active: true, department: { active: true } },
    select: { id: true, departmentId: true, department: { select: { companyId: true } } },
  });
  if (!targetGroup) return NextResponse.json({ error: "目标小组不存在或已经停用" }, { status: 400 });
  const targetScope: GroupScope = {
    id: targetGroup.id,
    departmentId: targetGroup.departmentId,
    companyId: targetGroup.department.companyId,
  };
  if (!canAppointOrTransferLead(access.actor, targetScope)) {
    return authorizationDenied(access.actor, "没有权限查看这个小组的组长候选人");
  }

  const people = await db.user.findMany({
    where: {
      active: true,
      groupId: { not: null },
      role: { in: [...candidateRoles] },
      group: { active: true, department: { active: true } },
    },
    select: {
      id: true,
      name: true,
      role: true,
      roleAssignments: { select: { role: true } },
      groupId: true,
      group: {
        select: {
          name: true,
          departmentId: true,
          department: { select: { companyId: true } },
        },
      },
    },
    orderBy: [{ group: { name: "asc" } }, { name: "asc" }],
  });
  const candidates = people.filter((person) => {
    if (!person.groupId || !person.group) return false;
    return canAppointOrTransferLead(access.actor, {
      id: person.groupId,
      departmentId: person.group.departmentId,
      companyId: person.group.department.companyId,
    });
  }).map((person) => ({
    id: person.id,
    name: person.name,
    role: person.role,
    groupId: person.groupId,
    groupName: person.group?.name ?? "",
    alreadyLead: person.role === "LEAD",
    roles: Array.from(new Set([person.role, ...person.roleAssignments.map((item) => item.role)])),
  }));
  return NextResponse.json({ candidates });
}
