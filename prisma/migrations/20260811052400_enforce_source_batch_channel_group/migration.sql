-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SourceBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "sourceDate" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SourceBatch_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SourceBatch_channelId_groupId_fkey" FOREIGN KEY ("channelId", "groupId") REFERENCES "Channel" ("id", "groupId") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SourceBatch" ("channelId", "createdAt", "groupId", "id", "sourceDate", "updatedAt") SELECT "channelId", "createdAt", "groupId", "id", "sourceDate", "updatedAt" FROM "SourceBatch";
DROP TABLE "SourceBatch";
ALTER TABLE "new_SourceBatch" RENAME TO "SourceBatch";
CREATE UNIQUE INDEX "SourceBatch_groupId_channelId_sourceDate_key" ON "SourceBatch"("groupId", "channelId", "sourceDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Channel_id_groupId_key" ON "Channel"("id", "groupId");
