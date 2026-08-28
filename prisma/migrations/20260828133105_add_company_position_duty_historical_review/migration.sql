-- AlterTable
ALTER TABLE "User" ADD COLUMN "duty" TEXT;

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "effectiveTo" TEXT,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserPosition_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserPosition_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Department" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT,
    "countryCode" TEXT NOT NULL DEFAULT 'CN',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "workStartMinutes" INTEGER NOT NULL DEFAULT 600,
    "workEndMinutes" INTEGER NOT NULL DEFAULT 1320,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Department_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Department" ("active", "countryCode", "createdAt", "id", "name", "timezone", "updatedAt", "workEndMinutes", "workStartMinutes") SELECT "active", "countryCode", "createdAt", "id", "name", "timezone", "updatedAt", "workEndMinutes", "workStartMinutes" FROM "Department";
DROP TABLE "Department";
ALTER TABLE "new_Department" RENAME TO "Department";
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");
CREATE INDEX "Department_companyId_idx" ON "Department"("companyId");
CREATE TABLE "new_LeadCustomer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "attributionOwnerId" TEXT,
    "deviceId" TEXT,
    "groupDeviceAccountId" TEXT,
    "groupDeviceAccountNumber" TEXT,
    "expertDeviceAccountId" TEXT,
    "expertDeviceAccountNumber" TEXT,
    "invalid" BOOLEAN NOT NULL DEFAULT false,
    "invalidReason" TEXT,
    "receptionCategory" TEXT NOT NULL DEFAULT 'VALID',
    "replyStatus" TEXT NOT NULL DEFAULT 'NOT_REPLIED',
    "repliedOn" TEXT,
    "followUpCount" INTEGER NOT NULL DEFAULT 0,
    "lastFollowedUpOn" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "lossAmountCents" INTEGER,
    "customerPlatform" TEXT,
    "groupStatus" TEXT NOT NULL DEFAULT 'NOT_JOINED',
    "joinedOn" TEXT,
    "leftOn" TEXT,
    "leftWithOrder" BOOLEAN,
    "leftNote" TEXT,
    "leftAutomatically" BOOLEAN NOT NULL DEFAULT false,
    "expertIntroducedOn" TEXT,
    "expertContactedOn" TEXT,
    "expertContactNote" TEXT,
    "expertNotes" TEXT,
    "expertWorkflowStage" TEXT,
    "expertStageChangedAt" DATETIME,
    "expertTrackingStartedAt" DATETIME,
    "expertStalledOn" TEXT,
    "expertStalledReason" TEXT,
    "expertStalledNote" TEXT,
    "noInitialDepositOn" TEXT,
    "noInitialDepositReason" TEXT,
    "noInitialDepositNote" TEXT,
    "registeredOn" TEXT,
    "nextPlan" TEXT,
    "nextFollowUpOn" TEXT,
    "notes" TEXT,
    "receptionChatStatus" TEXT NOT NULL DEFAULT 'NORMAL_CHAT',
    "receptionStatusChangedAt" DATETIME,
    "receptionArchivedAt" DATETIME,
    "receptionArchiveReason" TEXT,
    "receptionArchiveVisitCount" INTEGER,
    "isHistoricalRecord" BOOLEAN NOT NULL DEFAULT false,
    "historicalSourceName" TEXT,
    "historicalBaselineStage" TEXT,
    "historicalReplyCounted" BOOLEAN NOT NULL DEFAULT false,
    "historicalJoinCounted" BOOLEAN NOT NULL DEFAULT false,
    "historicalLeaveCounted" BOOLEAN NOT NULL DEFAULT false,
    "historicalExpertIntroCounted" BOOLEAN NOT NULL DEFAULT false,
    "historicalRegistrationCounted" BOOLEAN NOT NULL DEFAULT false,
    "historicalReviewStatus" TEXT,
    "historicalReviewedById" TEXT,
    "historicalReviewedAt" DATETIME,
    "expertOwnerId" TEXT,
    "groupOperatorOwnerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeadCustomer_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SourceBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeadCustomer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeadCustomer_attributionOwnerId_fkey" FOREIGN KEY ("attributionOwnerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LeadCustomer_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LeadCustomer_expertOwnerId_fkey" FOREIGN KEY ("expertOwnerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LeadCustomer_groupOperatorOwnerId_fkey" FOREIGN KEY ("groupOperatorOwnerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LeadCustomer_historicalReviewedById_fkey" FOREIGN KEY ("historicalReviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LeadCustomer" ("attributionOwnerId", "batchId", "createdAt", "customerEmail", "customerName", "customerPlatform", "deviceId", "expertContactNote", "expertContactedOn", "expertDeviceAccountId", "expertDeviceAccountNumber", "expertIntroducedOn", "expertNotes", "expertOwnerId", "expertStageChangedAt", "expertStalledNote", "expertStalledOn", "expertStalledReason", "expertTrackingStartedAt", "expertWorkflowStage", "followUpCount", "groupDeviceAccountId", "groupDeviceAccountNumber", "groupOperatorOwnerId", "groupStatus", "historicalBaselineStage", "historicalExpertIntroCounted", "historicalJoinCounted", "historicalLeaveCounted", "historicalRegistrationCounted", "historicalReplyCounted", "historicalSourceName", "id", "invalid", "invalidReason", "isHistoricalRecord", "joinedOn", "lastFollowedUpOn", "leftAutomatically", "leftNote", "leftOn", "leftWithOrder", "lossAmountCents", "nextFollowUpOn", "nextPlan", "noInitialDepositNote", "noInitialDepositOn", "noInitialDepositReason", "notes", "ownerId", "phone", "receptionArchiveReason", "receptionArchiveVisitCount", "receptionArchivedAt", "receptionCategory", "receptionChatStatus", "receptionStatusChangedAt", "registeredOn", "repliedOn", "replyStatus", "updatedAt") SELECT "attributionOwnerId", "batchId", "createdAt", "customerEmail", "customerName", "customerPlatform", "deviceId", "expertContactNote", "expertContactedOn", "expertDeviceAccountId", "expertDeviceAccountNumber", "expertIntroducedOn", "expertNotes", "expertOwnerId", "expertStageChangedAt", "expertStalledNote", "expertStalledOn", "expertStalledReason", "expertTrackingStartedAt", "expertWorkflowStage", "followUpCount", "groupDeviceAccountId", "groupDeviceAccountNumber", "groupOperatorOwnerId", "groupStatus", "historicalBaselineStage", "historicalExpertIntroCounted", "historicalJoinCounted", "historicalLeaveCounted", "historicalRegistrationCounted", "historicalReplyCounted", "historicalSourceName", "id", "invalid", "invalidReason", "isHistoricalRecord", "joinedOn", "lastFollowedUpOn", "leftAutomatically", "leftNote", "leftOn", "leftWithOrder", "lossAmountCents", "nextFollowUpOn", "nextPlan", "noInitialDepositNote", "noInitialDepositOn", "noInitialDepositReason", "notes", "ownerId", "phone", "receptionArchiveReason", "receptionArchiveVisitCount", "receptionArchivedAt", "receptionCategory", "receptionChatStatus", "receptionStatusChangedAt", "registeredOn", "repliedOn", "replyStatus", "updatedAt" FROM "LeadCustomer";
DROP TABLE "LeadCustomer";
ALTER TABLE "new_LeadCustomer" RENAME TO "LeadCustomer";
CREATE UNIQUE INDEX "LeadCustomer_phone_key" ON "LeadCustomer"("phone");
CREATE INDEX "LeadCustomer_ownerId_updatedAt_idx" ON "LeadCustomer"("ownerId", "updatedAt");
CREATE INDEX "LeadCustomer_ownerId_receptionChatStatus_updatedAt_idx" ON "LeadCustomer"("ownerId", "receptionChatStatus", "updatedAt");
CREATE INDEX "LeadCustomer_ownerId_receptionArchivedAt_idx" ON "LeadCustomer"("ownerId", "receptionArchivedAt");
CREATE INDEX "LeadCustomer_attributionOwnerId_updatedAt_idx" ON "LeadCustomer"("attributionOwnerId", "updatedAt");
CREATE INDEX "LeadCustomer_ownerId_receptionCategory_updatedAt_idx" ON "LeadCustomer"("ownerId", "receptionCategory", "updatedAt");
CREATE INDEX "LeadCustomer_batchId_groupStatus_updatedAt_idx" ON "LeadCustomer"("batchId", "groupStatus", "updatedAt");
CREATE INDEX "LeadCustomer_batchId_invalid_groupStatus_expertIntroducedOn_idx" ON "LeadCustomer"("batchId", "invalid", "groupStatus", "expertIntroducedOn");
CREATE INDEX "LeadCustomer_batchId_invalid_expertOwnerId_registeredOn_idx" ON "LeadCustomer"("batchId", "invalid", "expertOwnerId", "registeredOn");
CREATE INDEX "LeadCustomer_deviceId_idx" ON "LeadCustomer"("deviceId");
CREATE INDEX "LeadCustomer_groupDeviceAccountId_idx" ON "LeadCustomer"("groupDeviceAccountId");
CREATE INDEX "LeadCustomer_expertDeviceAccountId_idx" ON "LeadCustomer"("expertDeviceAccountId");
CREATE INDEX "LeadCustomer_expertOwnerId_updatedAt_idx" ON "LeadCustomer"("expertOwnerId", "updatedAt");
CREATE INDEX "LeadCustomer_expertOwnerId_expertWorkflowStage_expertTrackingStartedAt_idx" ON "LeadCustomer"("expertOwnerId", "expertWorkflowStage", "expertTrackingStartedAt");
CREATE INDEX "LeadCustomer_expertOwnerId_expertStalledOn_updatedAt_idx" ON "LeadCustomer"("expertOwnerId", "expertStalledOn", "updatedAt");
CREATE INDEX "LeadCustomer_expertOwnerId_noInitialDepositOn_updatedAt_idx" ON "LeadCustomer"("expertOwnerId", "noInitialDepositOn", "updatedAt");
CREATE INDEX "LeadCustomer_groupOperatorOwnerId_updatedAt_idx" ON "LeadCustomer"("groupOperatorOwnerId", "updatedAt");
CREATE INDEX "LeadCustomer_isHistoricalRecord_historicalReviewStatus_idx" ON "LeadCustomer"("isHistoricalRecord", "historicalReviewStatus");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");

-- CreateIndex
CREATE INDEX "UserPosition_groupId_effectiveFrom_effectiveTo_idx" ON "UserPosition"("groupId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "UserPosition_userId_effectiveTo_idx" ON "UserPosition"("userId", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "UserPosition_userId_effectiveFrom_key" ON "UserPosition"("userId", "effectiveFrom");
