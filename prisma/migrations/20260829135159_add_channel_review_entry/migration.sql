-- CreateTable
CREATE TABLE "ChannelReviewEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "reviewDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "note" TEXT,
    "sentById" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChannelReviewEntry_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ChannelReviewEntry_channelId_groupId_fkey" FOREIGN KEY ("channelId", "groupId") REFERENCES "Channel" ("id", "groupId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ChannelReviewEntry_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ChannelReviewEntry_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ChannelReviewEntry_channelId_status_idx" ON "ChannelReviewEntry"("channelId", "status");

-- CreateIndex
CREATE INDEX "ChannelReviewEntry_groupId_reviewDate_idx" ON "ChannelReviewEntry"("groupId", "reviewDate");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelReviewEntry_groupId_channelId_reviewDate_key" ON "ChannelReviewEntry"("groupId", "channelId", "reviewDate");
