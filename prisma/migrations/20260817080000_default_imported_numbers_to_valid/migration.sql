-- Imported numbers are valid by default. Rebuild is required by SQLite to
-- change the column default while preserving all customer history.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LeadCustomer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "deviceId" TEXT,
    "invalid" BOOLEAN NOT NULL DEFAULT false,
    "invalidReason" TEXT,
    "receptionCategory" TEXT NOT NULL DEFAULT 'VALID',
    "replyStatus" TEXT NOT NULL DEFAULT 'NOT_REPLIED',
    "repliedOn" TEXT,
    "followUpCount" INTEGER NOT NULL DEFAULT 0,
    "lastFollowedUpOn" TEXT,
    "customerName" TEXT,
    "lossAmountCents" INTEGER,
    "groupStatus" TEXT NOT NULL DEFAULT 'NOT_JOINED',
    "joinedOn" TEXT,
    "leftOn" TEXT,
    "leftWithOrder" BOOLEAN,
    "expertIntroducedOn" TEXT,
    "expertContactedOn" TEXT,
    "expertContactNote" TEXT,
    "registeredOn" TEXT,
    "nextPlan" TEXT,
    "nextFollowUpOn" TEXT,
    "notes" TEXT,
    "expertOwnerId" TEXT,
    "groupOperatorOwnerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeadCustomer_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SourceBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeadCustomer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeadCustomer_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LeadCustomer_expertOwnerId_fkey" FOREIGN KEY ("expertOwnerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LeadCustomer_groupOperatorOwnerId_fkey" FOREIGN KEY ("groupOperatorOwnerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LeadCustomer" ("batchId", "createdAt", "customerName", "deviceId", "expertContactNote", "expertContactedOn", "expertIntroducedOn", "expertOwnerId", "followUpCount", "groupOperatorOwnerId", "groupStatus", "id", "invalid", "invalidReason", "joinedOn", "lastFollowedUpOn", "leftOn", "leftWithOrder", "lossAmountCents", "nextFollowUpOn", "nextPlan", "notes", "ownerId", "phone", "receptionCategory", "registeredOn", "repliedOn", "replyStatus", "updatedAt") SELECT "batchId", "createdAt", "customerName", "deviceId", "expertContactNote", "expertContactedOn", "expertIntroducedOn", "expertOwnerId", "followUpCount", "groupOperatorOwnerId", "groupStatus", "id", "invalid", "invalidReason", "joinedOn", "lastFollowedUpOn", "leftOn", "leftWithOrder", "lossAmountCents", "nextFollowUpOn", "nextPlan", "notes", "ownerId", "phone", CASE WHEN "receptionCategory" = 'PENDING' THEN 'VALID' ELSE "receptionCategory" END, "registeredOn", "repliedOn", "replyStatus", "updatedAt" FROM "LeadCustomer";
DROP TABLE "LeadCustomer";
ALTER TABLE "new_LeadCustomer" RENAME TO "LeadCustomer";
CREATE UNIQUE INDEX "LeadCustomer_phone_key" ON "LeadCustomer"("phone");
CREATE INDEX "LeadCustomer_ownerId_updatedAt_idx" ON "LeadCustomer"("ownerId", "updatedAt");
CREATE INDEX "LeadCustomer_ownerId_receptionCategory_updatedAt_idx" ON "LeadCustomer"("ownerId", "receptionCategory", "updatedAt");
CREATE INDEX "LeadCustomer_batchId_groupStatus_updatedAt_idx" ON "LeadCustomer"("batchId", "groupStatus", "updatedAt");
CREATE INDEX "LeadCustomer_batchId_invalid_groupStatus_expertIntroducedOn_idx" ON "LeadCustomer"("batchId", "invalid", "groupStatus", "expertIntroducedOn");
CREATE INDEX "LeadCustomer_batchId_invalid_expertOwnerId_registeredOn_idx" ON "LeadCustomer"("batchId", "invalid", "expertOwnerId", "registeredOn");
CREATE INDEX "LeadCustomer_deviceId_idx" ON "LeadCustomer"("deviceId");
CREATE INDEX "LeadCustomer_expertOwnerId_updatedAt_idx" ON "LeadCustomer"("expertOwnerId", "updatedAt");
CREATE INDEX "LeadCustomer_groupOperatorOwnerId_updatedAt_idx" ON "LeadCustomer"("groupOperatorOwnerId", "updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
