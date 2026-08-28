-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Channel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "groupId" TEXT NOT NULL,
    "createdById" TEXT,
    "channelType" TEXT NOT NULL DEFAULT 'SMS',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("id", "groupId"),
    CONSTRAINT "Channel_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Channel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Channel" ("active", "channelType", "createdAt", "createdById", "groupId", "id", "name", "normalizedName", "updatedAt") SELECT "active", "channelType", "createdAt", "createdById", "groupId", "id", "name", "normalizedName", "updatedAt" FROM "Channel";
DROP TABLE "Channel";
ALTER TABLE "new_Channel" RENAME TO "Channel";
CREATE UNIQUE INDEX "Channel_groupId_normalizedName_key" ON "Channel"("groupId", "normalizedName");
CREATE TABLE "new_SourceBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "sourceDate" TEXT NOT NULL,
    "channelTypeSnapshot" TEXT NOT NULL DEFAULT 'SMS',
    "isHistoricalRecord" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SourceBatch_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SourceBatch_channelId_groupId_fkey" FOREIGN KEY ("channelId", "groupId") REFERENCES "Channel" ("id", "groupId") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SourceBatch" ("channelId", "channelTypeSnapshot", "createdAt", "groupId", "id", "isHistoricalRecord", "sourceDate", "updatedAt") SELECT "channelId", "channelTypeSnapshot", "createdAt", "groupId", "id", "isHistoricalRecord", "sourceDate", "updatedAt" FROM "SourceBatch";
DROP TABLE "SourceBatch";
ALTER TABLE "new_SourceBatch" RENAME TO "SourceBatch";
CREATE INDEX "SourceBatch_groupId_sourceDate_idx" ON "SourceBatch"("groupId", "sourceDate");
CREATE UNIQUE INDEX "SourceBatch_groupId_channelId_sourceDate_key" ON "SourceBatch"("groupId", "channelId", "sourceDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

