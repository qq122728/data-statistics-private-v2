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
    if (actor.role !== "ADMIN" && (!actor.duty || !orgManagerDuties.includes(actor.duty as (typeof orgManagerDuties)[number]))) {
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

/**
 * 阶段5a补充：三条账号创建路由（department-managers/company-managers/hq-managers）的
 * 登录闸门。跟 requireOrgManagerRequest 相比多放行一类调用方——Role.ADMIN（系统既有的
 * 超级管理员角色，没有 duty，会被 requireOrgManagerRequest 拒之门外）。系统自举应该始终
 * 能做任何一档组织管理者能做的事，尤其是 hq-managers 这条路由：HQ_MANAGER 之上没有
 * 业务层级能创建它，只能靠 ADMIN 兜底，不能让 ADMIN 被这道闸门挡在外面。
 *
 * 三条路由的允许调用方形状各不相同（部门管理员账号：本公司管理员/总公司/ADMIN；公司管理员
 * 账号：总公司/ADMIN；总公司管理员账号：仅 ADMIN），所以不在这里做细粒度判断——这里只确认
 * "登录了，且是 ADMIN 或某一档组织管理者"，具体这个调用方这一次能不能做，交给各路由自己
 * 调用 org-permissions.ts 对应的 can* 函数细判（跟 requireOrgManagerRequest 是同一个
 * "粗闸门 + can* 细判"结构，不是重新发明一套）。
 */
export async function requireAdminOrOrgManagerRequest(): Promise<{ actor: SessionUser } | { response: NextResponse }> {
  try {
    const actor = await requireUser();
    const isAdmin = actor.role === "ADMIN";
    const hasOrgManagerDuty = Boolean(actor.duty) && orgManagerDuties.includes(actor.duty as (typeof orgManagerDuties)[number]);
    if (!isAdmin && !hasOrgManagerDuty) {
      throw new AuthorizationError("只有系统管理员、部门管理员、公司管理员或总公司管理员可以创建管理账号", actor);
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
