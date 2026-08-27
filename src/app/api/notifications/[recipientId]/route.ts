import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { API_LIMITS } from "../../../../lib/request-limits";

export async function PATCH(request: Request, { params }: { params: Promise<{ recipientId: string }> }) {
  try {
    const user = await requireUser();
    const { recipientId } = await params;
    if (recipientId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "通知参数过长" }, { status: 400 });
    const body = await request.json() as { action?: unknown };
    if (body.action !== "READ" && body.action !== "ACKNOWLEDGE") return NextResponse.json({ error: "无效的通知操作" }, { status: 400 });
    const recipient = await db.notificationRecipient.findFirst({ where: { id: recipientId, userId: user.id }, select: { id: true, notification: { select: { requiresAck: true } } } });
    if (!recipient) return NextResponse.json({ error: "找不到这条通知" }, { status: 404 });
    const now = new Date();
    await db.notificationRecipient.update({ where: { id: recipient.id }, data: body.action === "ACKNOWLEDGE" && recipient.notification.requiresAck ? { readAt: now, acknowledgedAt: now } : { readAt: now } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
}
