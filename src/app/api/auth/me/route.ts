import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { getResourceChannelTypes } from "../../../../lib/resource-channel-access";
import { getAssignedRoles } from "../../../../lib/role-access";

export async function GET() {
  try {
    const user = await requireUser({ allowPasswordChangeRequired: true });
    const [group, department, company] = await Promise.all([
      user.groupId ? db.teamGroup.findUnique({ where: { id: user.groupId }, select: { name: true, groupType: true } }) : null,
      user.departmentId ? db.department.findUnique({ where: { id: user.departmentId }, select: { name: true } }) : null,
      user.companyId ? db.company.findUnique({ where: { id: user.companyId }, select: { name: true } }) : null,
    ]);
    // 资源部账号按需求文档4.4拆成投流/短信两个独立账号，各绑一个渠道——v2 前端要靠
    // 这个字段判断落在哪个身份（RESOURCE_TRAFFIC/RESOURCE_SMS），不能只看笼统的
    // role === "RESOURCE_MANAGER"。resourceChannelAccess 始终是明确授权的渠道目录 ID，
    // 不会按渠道类型扩展成其他渠道；这里只反查这些 ID 对应的类型用于显示账号身份。
    const resourceChannelIds = user.resourceChannelAccess?.map((access) => access.channelId) ?? [];
    const resourceChannelTypes = resourceChannelIds.length
      ? getResourceChannelTypes(
          await db.channel.findMany({ where: { id: { in: resourceChannelIds } }, select: { id: true, channelType: true } }),
          resourceChannelIds,
        )
      : [];
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
        groupType: group?.groupType ?? null,
        departmentId: user.departmentId,
        departmentName: department?.name ?? null,
        companyId: user.companyId,
        companyName: company?.name ?? null,
        mustChangePassword: user.mustChangePassword,
        resourceChannelTypes,
      },
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
    throw error;
  }
}
