import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { db } from "../../../../../../lib/db";
import { canAppointOrTransferLead, type GroupScope } from "../../../../../../lib/org-permissions";
import { API_LIMITS } from "../../../../../../lib/request-limits";
import { authorizationDenied } from "../../../../../../lib/security-events";
import { transferUserPosition } from "../../../../../../lib/user-position/transfer";
import { requireOrgManagerRequest } from "../../../_auth";

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/**
 * 阶段5a：任免一个小组的组长，或者把一位组长调到另一个小组当组长（需求文档5.6）。
 * LEAD 是职务不是岗位（代码地图"LEAD 是职务不写 Position 行"），所以这里固定
 * `role: "LEAD"`、`secondaryRoles: []`，落地逻辑完全交给 transferUserPosition
 * （阶段2已有的转组转岗唯一入口），这条路由只负责按新的组织架构权限网关做校验。
 *
 * 权限判断刻意对调出的原小组和调入的目标小组都跑一遍 canAppointOrTransferLead——
 * 计划文档给的规则字面上只讲了"目标小组"，但公司管理员/部门管理员的管辖范围本来就是
 * "本公司内"/"本部门内"，只查目标一端会漏掉"从别的公司/部门把人调过来"这个越权口子，
 * 两端都过这条统一的检查更安全，而且是同一个函数复用两次，没有新增判断逻辑。
 *
 * 调用 transferUserPosition 时刻意不透传 actor 的真实 role/departmentId，改传一个
 * "视同 ADMIN、无部门限定"的占位对象：因为 transferUserPosition 内部专门为老
 * Role.COMPANY_MANAGER 写的部门级二次校验，理解不了"整个公司横跨多个部门"这种新范围
 * 概念（新公司管理员的范围字段是 companyId，不是 departmentId），而权限已经在上面这一步
 * 用新网关判断过了，这里只是让内部校验不要用旧概念重复判一遍导致误判。这个占位 role
 * 只在这一次函数调用里使用，不会被持久化，审计记录里存的是 actorId 不是这个 role。
 */
export async function POST(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const access = await requireOrgManagerRequest();
  if ("response" in access) return access.response;

  const { groupId: targetGroupId } = await params;
  const body = await request.json() as Record<string, unknown>;
  const userId = typeof body.userId === "string" ? body.userId : "";
  const effectiveOn = body.effectiveOn;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const receptionHandoffId = typeof body.receptionHandoffId === "string" && body.receptionHandoffId ? body.receptionHandoffId : null;
  const operatorHandoffId = typeof body.operatorHandoffId === "string" && body.operatorHandoffId ? body.operatorHandoffId : null;
  const expertHandoffId = typeof body.expertHandoffId === "string" && body.expertHandoffId ? body.expertHandoffId : null;

  if (!targetGroupId || targetGroupId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "小组参数不正确" }, { status: 400 });
  if (!userId || userId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "人员参数不正确" }, { status: 400 });
  if (!isDate(effectiveOn)) return NextResponse.json({ error: "请选择正确的生效日期" }, { status: 400 });
  if (effectiveOn > new Date().toISOString().slice(0, 10)) return NextResponse.json({ error: "调动生效日期不能晚于今天" }, { status: 400 });
  if (reason.length < 4 || reason.length > API_LIMITS.accountReasonCharacters) return NextResponse.json({ error: "调动原因需要填写 4 到 500 个字" }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const [targetGroup, member] = await Promise.all([
      tx.teamGroup.findFirst({
        where: { id: targetGroupId, active: true, department: { active: true } },
        select: { id: true, departmentId: true, department: { select: { companyId: true } } },
      }),
      tx.user.findUnique({
        where: { id: userId },
        select: { id: true, groupId: true, group: { select: { departmentId: true, department: { select: { companyId: true } } } } },
      }),
    ]);
    if (!targetGroup) return { error: "目标小组不存在或已经停用", status: 400 as const };

    const targetScope: GroupScope = { id: targetGroup.id, departmentId: targetGroup.departmentId, companyId: targetGroup.department.companyId };
    if (!canAppointOrTransferLead(access.actor, targetScope)) return { denied: true as const };

    if (member?.groupId && member.group) {
      const sourceScope: GroupScope = { id: member.groupId, departmentId: member.group.departmentId, companyId: member.group.department.companyId };
      if (!canAppointOrTransferLead(access.actor, sourceScope)) return { denied: true as const };
    }

    return transferUserPosition({
      tx,
      actor: { id: access.actor.id, role: "ADMIN" as Role, departmentId: null, managementCountryCode: null },
      userId,
      targetGroupId,
      role: "LEAD",
      secondaryRoles: [],
      effectiveOn,
      reason,
      receptionHandoffId,
      operatorHandoffId,
      expertHandoffId,
    });
  }, { isolationLevel: "Serializable" });

  if ("denied" in result) return authorizationDenied(access.actor, "没有权限任免这个小组的组长");
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
