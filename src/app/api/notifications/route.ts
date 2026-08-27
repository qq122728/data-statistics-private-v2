import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { recordAudit } from "../../../lib/audit";
import { canSendNotifications, notificationScope, notificationTargetRoles, type NotificationTargetType } from "../../../lib/notifications";
import { db } from "../../../lib/db";
import { canWriteNotifications, findLivePermissionUser, type PermissionUser } from "../../../lib/permissions";
import { API_LIMITS, RequestBodyTooLargeError, readLimitedJson, tooLargeResponse } from "../../../lib/request-limits";
import { authorizationDenied } from "../../../lib/security-events";

const createSchema = z.object({
  title: z.string().trim().min(2, "请填写至少 2 个字的标题").max(80, "标题不能超过 80 个字"),
  content: z.string().trim().min(2, "请填写通知内容").max(2000, "通知内容不能超过 2000 个字"),
  type: z.enum(["GENERAL", "IMPORTANT", "REWARD", "REMINDER"]).default("GENERAL"),
  requiresAck: z.boolean().default(false),
  targetType: z.enum(["ALL", "GROUP", "ROLE", "USERS"]),
  departmentId: z.string().trim().max(API_LIMITS.identifierCharacters).optional(),
  groupId: z.string().trim().max(API_LIMITS.identifierCharacters).optional(),
  role: z.enum(notificationTargetRoles).optional(),
  userIds: z.array(z.string().trim().min(1).max(API_LIMITS.identifierCharacters)).max(API_LIMITS.notificationRecipients).optional(),
  expiresAt: z.string().max(40).datetime().optional(),
});

function responseError(error: unknown) {
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "通知内容不正确" }, { status: 400 });
  throw error;
}

type NotificationInput = z.infer<typeof createSchema>;
type NotificationScope = Awaited<ReturnType<typeof notificationScope>>;

function resolveRecipients(user: PermissionUser, input: NotificationInput, scope: NotificationScope) {
  let recipients = scope.users;
  let targetDepartmentId: string | null = null;
  let targetGroupId: string | null = null;
  let targetRole: typeof input.role | null = null;
  if (input.targetType === "GROUP") {
    const group = scope.groups.find((item) => item.id === input.groupId);
    if (!group) return { error: "只能选择自己有权限的小组" };
    targetGroupId = group.id;
    targetDepartmentId = group.departmentId;
    recipients = recipients.filter((item) => item.groupId === group.id);
  } else if (input.targetType === "ROLE") {
    if (!input.role) return { error: "请选择接收岗位", status: 400 as const };
    targetRole = input.role;
    recipients = recipients.filter((item) => item.role === input.role);
  } else if (input.targetType === "USERS") {
    const selected = new Set(input.userIds ?? []);
    if (!selected.size) return { error: "请至少选择一位接收人", status: 400 as const };
    recipients = recipients.filter((item) => selected.has(item.id));
    if (!recipients.length) return { error: "选择的人员不在你的通知范围内" };
  } else if (user.role === "ADMIN" && input.departmentId) {
    const department = scope.departments.find((item) => item.id === input.departmentId);
    if (!department) return { error: "请选择有效的下属公司", status: 400 as const };
    targetDepartmentId = department.id;
    const departmentGroupIds = new Set(scope.groups.filter((group) => group.departmentId === department.id).map((group) => group.id));
    recipients = recipients.filter((item) => item.departmentId === department.id || (item.groupId ? departmentGroupIds.has(item.groupId) : false));
  } else if (user.role === "COMPANY_MANAGER") {
    targetDepartmentId = user.departmentId ?? null;
  } else if (user.role === "LEAD") {
    targetGroupId = user.groupId;
  }
  const recipientIds = [...new Set(recipients.map((item) => item.id))];
  if (!recipientIds.length) return { error: "当前范围内没有启用中的接收人", status: 400 as const };
  return { recipientIds, targetDepartmentId, targetGroupId, targetRole };
}

export async function GET() {
  try {
    const user = await requireUser();
    const [items, unread] = await Promise.all([
      db.notificationRecipient.findMany({
        where: { userId: user.id, notification: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } },
        select: {
          id: true, readAt: true, acknowledgedAt: true,
          notification: { select: { id: true, title: true, content: true, type: true, requiresAck: true, createdAt: true, expiresAt: true, sender: { select: { name: true, role: true } } } },
        },
        orderBy: { notification: { createdAt: "desc" } },
        take: 60,
      }),
      db.notificationRecipient.count({ where: { userId: user.id, readAt: null, notification: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } } }),
    ]);
    return NextResponse.json({ unread, items });
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!canSendNotifications(user.role) || !canWriteNotifications(user)) return authorizationDenied(user, "只有总公司管理员、公司管理员和组长可以发布通知");
    const input = createSchema.parse(await readLimitedJson(request, API_LIMITS.notificationBodyBytes));
    const preview = resolveRecipients(user, input, await notificationScope(user));
    if ("error" in preview) {
      const status = preview.status ?? 403;
      return status === 403
        ? authorizationDenied(user, preview.error ?? "没有权限发布到所选范围")
        : NextResponse.json({ error: preview.error }, { status });
    }
    const result = await db.$transaction(async (client) => {
      // 重新读取账号与范围：调岗/停用后的旧页面不能向原范围继续发通知。
      const actor = await findLivePermissionUser(client, user.id);
      if (!actor || !canWriteNotifications(actor)) return { error: "当前账号已停用或岗位已变更，不能继续发布通知", status: 403 as const };
      const targets = resolveRecipients(actor, input, await notificationScope(actor, client));
      if ("error" in targets) return { error: targets.error, status: targets.status ?? 403 };
      const created = await client.notification.create({
        data: {
          title: input.title, content: input.content, type: input.type,
          requiresAck: input.type === "IMPORTANT" ? input.requiresAck : false,
          targetType: input.targetType as NotificationTargetType,
          senderId: actor.id,
          targetDepartmentId: targets.targetDepartmentId,
          targetGroupId: targets.targetGroupId,
          targetRole: targets.targetRole,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          recipients: { createMany: { data: targets.recipientIds.map((userId) => ({ userId })) } },
        },
        select: { id: true },
      });
      await recordAudit(client, { actorId: actor.id, action: "NOTIFICATION_SENT", entityType: "Notification", entityId: created.id, summary: { type: input.type, targetType: input.targetType, targetDepartmentId: targets.targetDepartmentId, targetGroupId: targets.targetGroupId, targetRole: targets.targetRole, recipientCount: targets.recipientIds.length } });
      return { notification: created, recipientCount: targets.recipientIds.length };
    });
    if ("error" in result)
      return result.status === 403
        ? authorizationDenied(user, result.error ?? "没有权限发布到所选范围")
        : NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (error instanceof RequestBodyTooLargeError) return tooLargeResponse(error);
    return responseError(error);
  }
}
