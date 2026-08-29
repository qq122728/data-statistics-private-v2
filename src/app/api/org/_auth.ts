import { NextResponse } from "next/server";
import { AuthenticationError, AuthorizationError, requireUser, type SessionUser } from "../../../lib/auth";
import { authorizationErrorResponse } from "../../../lib/security-events";

const orgManagerDuties = ["DEPARTMENT_MANAGER", "COMPANY_MANAGER", "HQ_MANAGER"] as const;

/**
 * 阶段5a新路由的通用登录闸门，仿照 admin/_auth.ts 的 requireAdminRequest 写法：
 * 只确认"这是某一档组织管理者"（duty 落在部门/公司/总公司管理员三档之一），具体这一档
 * 能不能做某个动作，由各路由再调用 org-permissions.ts 的 can* 函数细判——这里不做
 * 细粒度判断，避免把两层权限判断糅到一个函数里。
 *
 * 不用 requireRole()：Role 对这几档新账号只是历史占位值（阶段5计划文档"命名坑"决策），
 * 新网关只认 Duty，不认 Role 字符串。
 */
export async function requireOrgManagerRequest(): Promise<{ actor: SessionUser } | { response: NextResponse }> {
  try {
    const actor = await requireUser();
    if (!actor.duty || !orgManagerDuties.includes(actor.duty as (typeof orgManagerDuties)[number])) {
      throw new AuthorizationError("只有部门管理员、公司管理员或总公司管理员可以管理组织结构", actor);
    }
    return { actor };
  } catch (error) {
    if (!(error instanceof AuthenticationError) && !(error instanceof AuthorizationError)) throw error;
    return {
      response: error instanceof AuthorizationError
        ? authorizationErrorResponse(error, error.message)
        : NextResponse.json({ error: "请先登录" }, { status: 401 }),
    };
  }
}
