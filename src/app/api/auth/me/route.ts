import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { getAssignedRoles } from "../../../../lib/role-access";

export async function GET() {
  try {
    const user = await requireUser({ allowPasswordChangeRequired: true });
    const [group, department, company] = await Promise.all([
      user.groupId ? db.teamGroup.findUnique({ where: { id: user.groupId }, select: { name: true } }) : null,
      user.departmentId ? db.department.findUnique({ where: { id: user.departmentId }, select: { name: true } }) : null,
      user.companyId ? db.company.findUnique({ where: { id: user.companyId }, select: { name: true } }) : null,
    ]);
    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        roles: getAssignedRoles(user),
        duty: user.duty,
        groupId: user.groupId,
        groupName: group?.name ?? null,
        departmentId: user.departmentId,
        departmentName: department?.name ?? null,
        companyId: user.companyId,
        companyName: company?.name ?? null,
        mustChangePassword: user.mustChangePassword,
      },
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
    throw error;
  }
}
