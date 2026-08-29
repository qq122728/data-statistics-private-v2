CREATE TABLE "GroupOperatorReceptionHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupOperatorId" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupOperatorReceptionHistory_groupOperatorId_fkey" FOREIGN KEY ("groupOperatorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupOperatorReceptionHistory_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupOperatorReceptionHistory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "GroupOperatorReceptionHistory" (
    "id", "groupOperatorId", "receptionistId", "effectiveFrom", "createdAt", "reason"
)
SELECT
    'pairing-history-' || lower(hex(randomblob(16))),
    "groupOperatorId",
    "receptionistId",
    "createdAt",
    "createdAt",
    '迁移现有配对关系'
FROM "GroupOperatorReception";

CREATE INDEX "GroupOperatorReceptionHistory_receptionistId_effectiveFrom_effectiveTo_idx"
ON "GroupOperatorReceptionHistory"("receptionistId", "effectiveFrom", "effectiveTo");
CREATE INDEX "GroupOperatorReceptionHistory_groupOperatorId_effectiveFrom_effectiveTo_idx"
ON "GroupOperatorReceptionHistory"("groupOperatorId", "effectiveFrom", "effectiveTo");
CREATE INDEX "GroupOperatorReceptionHistory_createdById_idx"
ON "GroupOperatorReceptionHistory"("createdById");
