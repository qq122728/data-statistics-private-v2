-- 独立每日统计账：客户进度只写客户档案，不再直接写正式报表数据。
CREATE TABLE "DailyStatEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identityKey" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "sourceReceptionId" TEXT,
    "sourceGroupOperatorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currentRevisionId" TEXT,
    "approvedRevisionId" TEXT,
    "submittedAt" DATETIME,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "reviewReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyStatEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DailyStatEntry_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DailyStatEntry_channelId_groupId_fkey" FOREIGN KEY ("channelId", "groupId") REFERENCES "Channel" ("id", "groupId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DailyStatEntry_sourceReceptionId_fkey" FOREIGN KEY ("sourceReceptionId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DailyStatEntry_sourceGroupOperatorId_fkey" FOREIGN KEY ("sourceGroupOperatorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DailyStatEntry_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DailyStatEntry_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "DailyStatRevision" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DailyStatEntry_approvedRevisionId_fkey" FOREIGN KEY ("approvedRevisionId") REFERENCES "DailyStatRevision" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "DailyStatRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "changeReason" TEXT,
    "dispatchCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "lowAmountCount" INTEGER NOT NULL DEFAULT 0,
    "noWsCount" INTEGER NOT NULL DEFAULT 0,
    "effectiveCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "joinCount" INTEGER NOT NULL DEFAULT 0,
    "operatorReceivedCount" INTEGER NOT NULL DEFAULT 0,
    "normalLeaveCount" INTEGER NOT NULL DEFAULT 0,
    "abnormalLeaveCount" INTEGER NOT NULL DEFAULT 0,
    "currentInGroupCount" INTEGER NOT NULL DEFAULT 0,
    "expertIntroCount" INTEGER NOT NULL DEFAULT 0,
    "expertReceivedCount" INTEGER NOT NULL DEFAULT 0,
    "expertContactedCount" INTEGER NOT NULL DEFAULT 0,
    "registrationCount" INTEGER NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "cryptoInitialDepositCents" INTEGER NOT NULL DEFAULT 0,
    "bankInitialDepositCents" INTEGER NOT NULL DEFAULT 0,
    "cryptoRechargeCents" INTEGER NOT NULL DEFAULT 0,
    "bankRechargeCents" INTEGER NOT NULL DEFAULT 0,
    "withdrawalCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyStatRevision_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "DailyStatEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DailyStatRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DailyStatEntry_identityKey_key" ON "DailyStatEntry"("identityKey");
CREATE UNIQUE INDEX "DailyStatEntry_currentRevisionId_key" ON "DailyStatEntry"("currentRevisionId");
CREATE UNIQUE INDEX "DailyStatEntry_approvedRevisionId_key" ON "DailyStatEntry"("approvedRevisionId");
CREATE INDEX "DailyStatEntry_ownerId_businessDate_idx" ON "DailyStatEntry"("ownerId", "businessDate");
CREATE INDEX "DailyStatEntry_groupId_businessDate_position_idx" ON "DailyStatEntry"("groupId", "businessDate", "position");
CREATE INDEX "DailyStatEntry_channelId_businessDate_idx" ON "DailyStatEntry"("channelId", "businessDate");
CREATE INDEX "DailyStatEntry_status_groupId_businessDate_idx" ON "DailyStatEntry"("status", "groupId", "businessDate");
CREATE INDEX "DailyStatEntry_sourceReceptionId_businessDate_idx" ON "DailyStatEntry"("sourceReceptionId", "businessDate");
CREATE INDEX "DailyStatEntry_sourceGroupOperatorId_businessDate_idx" ON "DailyStatEntry"("sourceGroupOperatorId", "businessDate");
CREATE INDEX "DailyStatRevision_createdById_createdAt_idx" ON "DailyStatRevision"("createdById", "createdAt");
CREATE UNIQUE INDEX "DailyStatRevision_entryId_version_key" ON "DailyStatRevision"("entryId", "version");
