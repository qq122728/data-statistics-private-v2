CREATE TABLE "InvalidFanReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "noWsCount" INTEGER NOT NULL DEFAULT 0,
    "lowAmountCount" INTEGER NOT NULL DEFAULT 0,
    "collisionCount" INTEGER NOT NULL DEFAULT 0,
    "approvedNoWsCount" INTEGER,
    "approvedLowAmountCount" INTEGER,
    "approvedCollisionCount" INTEGER,
    "reviewReason" TEXT,
    "reviewedAt" DATETIME,
    "reviewedById" TEXT,
    "isLeaderSupplement" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InvalidFanReport_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SourceBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InvalidFanReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InvalidFanReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "InvalidFanReportAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeNoWsCount" INTEGER,
    "beforeLowAmountCount" INTEGER,
    "beforeCollisionCount" INTEGER,
    "afterNoWsCount" INTEGER,
    "afterLowAmountCount" INTEGER,
    "afterCollisionCount" INTEGER,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvalidFanReportAudit_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "InvalidFanReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InvalidFanReportAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InvalidFanReport_batchId_reporterId_key" ON "InvalidFanReport"("batchId", "reporterId");
CREATE INDEX "InvalidFanReport_batchId_status_idx" ON "InvalidFanReport"("batchId", "status");
CREATE INDEX "InvalidFanReport_reporterId_status_updatedAt_idx" ON "InvalidFanReport"("reporterId", "status", "updatedAt");
CREATE INDEX "InvalidFanReportAudit_reportId_createdAt_idx" ON "InvalidFanReportAudit"("reportId", "createdAt");
CREATE INDEX "InvalidFanReportAudit_actorId_createdAt_idx" ON "InvalidFanReportAudit"("actorId", "createdAt");
