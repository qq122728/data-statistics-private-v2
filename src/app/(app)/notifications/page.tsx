import { redirect } from "next/navigation";
import { NotificationCenter } from "../../../components/notifications/NotificationCenter";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { db } from "../../../lib/db";
import { canSendNotifications, notificationScope } from "../../../lib/notifications";

export default async function NotificationsPage() {
  let user;
  try { user = await requireUser(); }
  catch (error) { if (error instanceof AuthenticationError) redirect("/login?next=/notifications"); throw error; }
  if (user.role === "HR") redirect("/personnel");
  const [items, scope] = await Promise.all([
    db.notificationRecipient.findMany({ where: { userId: user.id, notification: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }, select: { id: true, readAt: true, acknowledgedAt: true, notification: { select: { id: true, title: true, content: true, type: true, requiresAck: true, createdAt: true, expiresAt: true, sender: { select: { name: true, role: true } } } } }, orderBy: { notification: { createdAt: "desc" } }, take: 60 }),
    canSendNotifications(user) ? notificationScope(user) : Promise.resolve({ groups: [], users: [], departments: [] }),
  ]);
  return <NotificationCenter canSend={canSendNotifications(user)} actorRole={user.role} items={items} groups={scope.groups} users={scope.users} departments={scope.departments} />;
}
