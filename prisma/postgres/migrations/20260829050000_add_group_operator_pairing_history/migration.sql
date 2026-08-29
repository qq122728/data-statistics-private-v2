CREATE TABLE "GroupOperatorReceptionHistory" (
    "id" TEXT NOT NULL,
    "groupOperatorId" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupOperatorReceptionHistory_pkey" PRIMARY KEY ("id")
);

INSERT INTO "GroupOperatorReceptionHistory" (
    "id", "groupOperatorId", "receptionistId", "effectiveFrom", "createdAt", "reason"
)
SELECT
    'pairing-history-' || md5("groupOperatorId" || ':' || "receptionistId"),
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

ALTER TABLE "GroupOperatorReceptionHistory"
ADD CONSTRAINT "GroupOperatorReceptionHistory_groupOperatorId_fkey"
FOREIGN KEY ("groupOperatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupOperatorReceptionHistory"
ADD CONSTRAINT "GroupOperatorReceptionHistory_receptionistId_fkey"
FOREIGN KEY ("receptionistId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupOperatorReceptionHistory"
ADD CONSTRAINT "GroupOperatorReceptionHistory_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
