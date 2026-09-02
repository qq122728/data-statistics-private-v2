import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { db } from "../../../lib/db";
import { normalizeCustomerPhone } from "../../../lib/entry-ledger";
import { getAssignedRoles } from "../../../lib/role-access";
import { authorizationDenied } from "../../../lib/security-events";
import { isCustomerCollaborator } from "../../../lib/customer-collaboration-visibility";

type RoleActor = Parameters<typeof getAssignedRoles>[0];

function mayLookUp(user: RoleActor) {
  return getAssignedRoles(user).some((role) =>
    ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"].includes(role),
  );
}

async function sessionActor() {
  try {
    return { actor: await requireUser(), error: null } as const;
  } catch (error) {
    if (error instanceof AuthenticationError)
      return {
        actor: null,
        error: NextResponse.json({ error: "请先登录" }, { status: 401 }),
      } as const;
    throw error;
  }
}

/**
 * 仅供两个统一新增入口和 AI 做号码存在性判断。无配合关系时只返回“已存在”，
 * 不返回客户姓名、归属人或跳转地址。
 */
export async function GET(request: Request) {
  const session = await sessionActor();
  if (session.error) return session.error;
  const actor = session.actor;
  if (!mayLookUp(actor))
    return authorizationDenied(actor, "当前岗位不能查询客户号码");
  if (!actor.groupId) return authorizationDenied(actor, "当前账号未绑定小组");

  let phone: string;
  try {
    phone = normalizeCustomerPhone(
      new URL(request.url).searchParams.get("phone") ?? "",
    );
  } catch {
    return NextResponse.json(
      { error: "请输入正确的客户号码" },
      { status: 400 },
    );
  }

  const existing = await db.leadCustomer.findFirst({
    where: { phone, trackingArchivedAt: null },
    select: {
      id: true,
      ownerId: true,
      attributionOwnerId: true,
      groupOperatorOwnerId: true,
      expertOwnerId: true,
      batch: { select: { groupId: true } },
    },
  });
  if (!existing) return NextResponse.json({ exists: false, phone });
  if (existing.batch.groupId !== actor.groupId)
    return NextResponse.json({
      exists: true,
      sameGroup: false,
      message: "该号码已存在",
    });
  if (
    !getAssignedRoles(actor).includes("LEAD") &&
    !isCustomerCollaborator(actor.id, existing)
  )
    return NextResponse.json({
      exists: true,
      sameGroup: true,
      canAccess: false,
      message: "该号码已存在",
    });
  return NextResponse.json({
    exists: true,
    sameGroup: true,
    canAccess: true,
    phone,
  });
}

/** 旧“老客户导入”写入口已经由新增进群客户和新增专家客户取代。 */
export async function POST() {
  const session = await sessionActor();
  if (session.error) return session.error;
  return NextResponse.json(
    {
      error:
        "老客户导入已停用，请使用新增进群客户或新增专家客户",
    },
    { status: 410 },
  );
}
