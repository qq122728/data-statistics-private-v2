-- Add user activity tracking and the settings/audit persistence models.
ALTER TABLE "User" ADD COLUMN "lastLoginAt" DATETIME;

-- Rebuild Channel so old rows receive a normalized name and an optional creator.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Channel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "groupId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("id", "groupId"),
    CONSTRAINT "Channel_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Channel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- SQLite has no regexp replacement. This recursive pass trims, collapses common
-- JavaScript whitespace characters, and lowercases each existing channel name.
-- Keep the normalized rows in a temporary table so channel and batch references
-- can be merged before the unique normalized-name index is added.
CREATE TEMP TABLE "_normalized_Channel" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "canonicalId" TEXT NOT NULL,
    PRIMARY KEY ("id", "groupId")
);

WITH RECURSIVE "normalized_channels"(
    "id", "groupId", "name", "active", "createdAt", "updatedAt", "position", "normalizedName", "hasText", "previousWasWhitespace"
) AS (
    SELECT "id", "groupId", "name", "active", "createdAt", "updatedAt", 1, '', 0, 0 FROM "Channel"
    UNION ALL
    SELECT
        "id",
        "groupId",
        "name",
        "active",
        "createdAt",
        "updatedAt",
        "position" + 1,
        CASE WHEN unicode(substr("name", "position", 1)) IN (9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)
            THEN "normalizedName"
            ELSE "normalizedName" || CASE WHEN "hasText" = 1 AND "previousWasWhitespace" = 1 THEN ' ' ELSE '' END || lower(substr("name", "position", 1))
        END,
        CASE WHEN unicode(substr("name", "position", 1)) IN (9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)
            THEN "hasText" ELSE 1 END,
        CASE WHEN unicode(substr("name", "position", 1)) IN (9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)
            THEN 1 ELSE 0 END
    FROM "normalized_channels"
    WHERE "position" <= length("name")
)
INSERT INTO "_normalized_Channel" ("id", "groupId", "name", "normalizedName", "active", "createdAt", "updatedAt", "canonicalId")
SELECT
    "id",
    "groupId",
    "name",
    "normalizedName",
    "active",
    "createdAt",
    "updatedAt",
    first_value("id") OVER (
        PARTITION BY "groupId", "normalizedName"
        ORDER BY "active" DESC, "id"
    )
FROM "normalized_channels"
WHERE "position" = length("name") + 1;

-- Every old batch maps to one deterministic surviving batch. Prefer an
-- existing batch that already belongs to the canonical channel, then its id.
CREATE TEMP TABLE "_SourceBatch_merge" (
    "oldBatchId" TEXT NOT NULL PRIMARY KEY,
    "canonicalBatchId" TEXT NOT NULL,
    "canonicalChannelId" TEXT NOT NULL
);
INSERT INTO "_SourceBatch_merge" ("oldBatchId", "canonicalBatchId", "canonicalChannelId")
SELECT
    "SourceBatch"."id",
    first_value("SourceBatch"."id") OVER (
        PARTITION BY "SourceBatch"."groupId", "_normalized_Channel"."canonicalId", "SourceBatch"."sourceDate"
        ORDER BY CASE WHEN "SourceBatch"."channelId" = "_normalized_Channel"."canonicalId" THEN 0 ELSE 1 END, "SourceBatch"."id"
    ),
    "_normalized_Channel"."canonicalId"
FROM "SourceBatch"
JOIN "_normalized_Channel"
  ON "_normalized_Channel"."id" = "SourceBatch"."channelId"
 AND "_normalized_Channel"."groupId" = "SourceBatch"."groupId";

-- Move events first, then remove batches that would collide after replacing
-- duplicate channel ids with their canonical id.
UPDATE "MetricEvent"
SET "batchId" = (
    SELECT "canonicalBatchId" FROM "_SourceBatch_merge"
    WHERE "oldBatchId" = "MetricEvent"."batchId"
)
WHERE "batchId" IN (SELECT "oldBatchId" FROM "_SourceBatch_merge");

DELETE FROM "SourceBatch"
WHERE "id" IN (
    SELECT "oldBatchId" FROM "_SourceBatch_merge"
    WHERE "oldBatchId" <> "canonicalBatchId"
);

UPDATE "SourceBatch"
SET "channelId" = (
    SELECT "canonicalChannelId" FROM "_SourceBatch_merge"
    WHERE "oldBatchId" = "SourceBatch"."id"
)
WHERE "id" IN (SELECT "canonicalBatchId" FROM "_SourceBatch_merge");

INSERT INTO "new_Channel" ("id", "name", "normalizedName", "active", "groupId", "createdAt", "updatedAt")
SELECT "id", "name", "normalizedName", "active", "groupId", "createdAt", "updatedAt"
FROM "_normalized_Channel"
WHERE "id" = "canonicalId";

DROP TABLE "Channel";
ALTER TABLE "new_Channel" RENAME TO "Channel";
CREATE UNIQUE INDEX "Channel_groupId_normalizedName_key" ON "Channel"("groupId", "normalizedName");
DROP TABLE "_SourceBatch_merge";
DROP TABLE "_normalized_Channel";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL
);
