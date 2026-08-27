CREATE TABLE "ResourceChannelAccess" (
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResourceChannelAccess_pkey" PRIMARY KEY ("userId", "channelId"),
    CONSTRAINT "ResourceChannelAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ResourceChannelAccess_channelId_idx" ON "ResourceChannelAccess"("channelId");

-- 保持升级前行为：现有资源部账号先获得当前全部渠道，管理员随后可按账号收窄。
INSERT INTO "ResourceChannelAccess" ("userId", "channelId")
SELECT users."id", channels."id"
FROM "User" users
CROSS JOIN (SELECT DISTINCT "id" FROM "Channel") channels
WHERE users."role" = 'RESOURCE_MANAGER';
