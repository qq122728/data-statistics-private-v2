CREATE TYPE "InvalidFanReportStatus" AS ENUM ('PENDING', 'APPROVED', 'RETURNED');
CREATE TYPE "InvalidFanReportAction" AS ENUM ('REPORTED', 'UPDATED', 'APPROVED', 'RETURNED', 'CORRECTED', 'SUPPLEMENTED');

CREATE TABLE "InvalidFanReport" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "status" "InvalidFanReportStatus" NOT NULL DEFAULT 'PENDING',
    "noWsCount" INTEGER NOT NULL DEFAULT 0,
    "lowAmountCount" INTEGER NOT NULL DEFAULT 0,
    "collisionCount" INTEGER NOT NULL DEFAULT 0,
    "approvedNoWsCount" INTEGER,
    "approvedLowAmountCount" INTEGER,
    "approvedCollisionCount" INTEGER,
    "reviewReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "isLeaderSupplement" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InvalidFanReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvalidFanReportAudit" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "InvalidFanReportAction" NOT NULL,
    "beforeNoWsCount" INTEGER,
    "beforeLowAmountCount" INTEGER,
    "beforeCollisionCount" INTEGER,
    "afterNoWsCount" INTEGER,
    "afterLowAmountCount" INTEGER,
    "afterCollisionCount" INTEGER,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvalidFanReportAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvalidFanReport_batchId_reporterId_key" ON "InvalidFanReport"("batchId", "reporterId");
CREATE INDEX "InvalidFanReport_batchId_status_idx" ON "InvalidFanReport"("batchId", "status");
CREATE INDEX "InvalidFanReport_reporterId_status_updatedAt_idx" ON "InvalidFanReport"("reporterId", "status", "updatedAt");
CREATE INDEX "InvalidFanReportAudit_reportId_createdAt_idx" ON "InvalidFanReportAudit"("reportId", "createdAt");
CREATE INDEX "InvalidFanReportAudit_actorId_createdAt_idx" ON "InvalidFanReportAudit"("actorId", "createdAt");

ALTER TABLE "InvalidFanReport" ADD CONSTRAINT "InvalidFanReport_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SourceBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvalidFanReport" ADD CONSTRAINT "InvalidFanReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvalidFanReport" ADD CONSTRAINT "InvalidFanReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvalidFanReportAudit" ADD CONSTRAINT "InvalidFanReportAudit_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "InvalidFanReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvalidFanReportAudit" ADD CONSTRAINT "InvalidFanReportAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
