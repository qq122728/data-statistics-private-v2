CREATE TABLE "ResourceChannelAccess" (
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceChannelAccess_pkey" PRIMARY KEY ("userId", "channelId")
);

CREATE INDEX "ResourceChannelAccess_channelId_idx" ON "ResourceChannelAccess"("channelId");

INSERT INTO "ResourceChannelAccess" ("userId", "channelId")
SELECT users."id", channels."id"
FROM "User" users
CROSS JOIN (SELECT DISTINCT "id" FROM "Channel") channels
WHERE users."role" = 'RESOURCE_MANAGER';

ALTER TABLE "ResourceChannelAccess" ADD CONSTRAINT "ResourceChannelAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
