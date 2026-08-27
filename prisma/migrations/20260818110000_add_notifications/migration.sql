CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'GENERAL',
  "requiresAck" BOOLEAN NOT NULL DEFAULT false,
  "targetType" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "targetDepartmentId" TEXT,
  "targetGroupId" TEXT,
  "targetRole" TEXT,
  "expiresAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Notification_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "NotificationRecipient" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "readAt" DATETIME,
  "acknowledgedAt" DATETIME,
  CONSTRAINT "NotificationRecipient_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationRecipient_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NotificationRecipient_notificationId_userId_key" ON "NotificationRecipient"("notificationId", "userId");
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
CREATE INDEX "Notification_senderId_idx" ON "Notification"("senderId");
CREATE INDEX "Notification_targetDepartmentId_idx" ON "Notification"("targetDepartmentId");
CREATE INDEX "Notification_targetGroupId_idx" ON "Notification"("targetGroupId");
CREATE INDEX "NotificationRecipient_userId_readAt_idx" ON "NotificationRecipient"("userId", "readAt");
