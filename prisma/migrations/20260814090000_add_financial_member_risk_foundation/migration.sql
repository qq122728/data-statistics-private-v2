-- Rebuild MetricEvent so SQLite validates every current MetricKind value while
-- preserving all historical event rows and their foreign-key relationships.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MetricEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "enteredById" TEXT NOT NULL,
    "occurredOn" TEXT NOT NULL,
    "kind" TEXT NOT NULL CHECK ("kind" IN ('NEW_FANS', 'EFFECTIVE_FANS', 'NO_NUMBER', 'DUPLICATE_FANS', 'REPLIES', 'GROUP_JOIN', 'GROUP_LEAVE', 'EXPERT_INTRO', 'REGISTRATION', 'ORDER', 'RECHARGE', 'WITHDRAWAL', 'CHANNEL_PERFORMANCE')),
    "quantity" INTEGER,
    "amountCents" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetricEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SourceBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MetricEvent_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MetricEvent" ("amountCents", "batchId", "createdAt", "enteredById", "id", "kind", "occurredOn", "quantity")
SELECT "amountCents", "batchId", "createdAt", "enteredById", "id", "kind", "occurredOn", "quantity" FROM "MetricEvent";
DROP TABLE "MetricEvent";
ALTER TABLE "new_MetricEvent" RENAME TO "MetricEvent";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

ALTER TABLE "Channel" ADD COLUMN "effectiveFanPriceCents" INTEGER;

ALTER TABLE "User" ADD COLUMN "hireDate" TEXT;
ALTER TABLE "User" ADD COLUMN "stageOverride" TEXT;
ALTER TABLE "User" ADD COLUMN "stageOverrideReason" TEXT;
ALTER TABLE "User" ADD COLUMN "stageOverrideAt" DATETIME;

CREATE TABLE "RiskDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "level" TEXT NOT NULL CHECK ("level" IN ('LIMIT_WATCH', 'ELIMINATION_WATCH')),
    "evidenceThrough" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RiskDecision_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RiskDecision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "RiskDecision_memberId_createdAt_idx" ON "RiskDecision"("memberId", "createdAt");
