PRAGMA foreign_keys=OFF;

-- Rebuild the phone ledger so expert assignments are protected by a real FK.
CREATE TABLE "new_LeadCustomer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "phone" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "deviceId" TEXT,
  "invalid" BOOLEAN NOT NULL DEFAULT false,
  "invalidReason" TEXT,
  "replyStatus" TEXT NOT NULL DEFAULT 'NOT_REPLIED',
  "repliedOn" TEXT,
  "followUpCount" INTEGER NOT NULL DEFAULT 0,
  "lastFollowedUpOn" TEXT,
  "customerName" TEXT,
  "lossAmountCents" INTEGER,
  "groupStatus" TEXT NOT NULL DEFAULT 'NOT_JOINED',
  "joinedOn" TEXT,
  "leftOn" TEXT,
  "expertIntroducedOn" TEXT,
  "registeredOn" TEXT,
  "notes" TEXT,
  "expertOwnerId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "LeadCustomer_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SourceBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LeadCustomer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LeadCustomer_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LeadCustomer_expertOwnerId_fkey" FOREIGN KEY ("expertOwnerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LeadCustomer" SELECT "id", "phone", "batchId", "ownerId", "deviceId", "invalid", "invalidReason", "replyStatus", "repliedOn", "followUpCount", "lastFollowedUpOn", "customerName", "lossAmountCents", "groupStatus", "joinedOn", "leftOn", "expertIntroducedOn", "registeredOn", "notes", "expertOwnerId", "createdAt", "updatedAt" FROM "LeadCustomer";
DROP TABLE "LeadCustomer";
ALTER TABLE "new_LeadCustomer" RENAME TO "LeadCustomer";
CREATE UNIQUE INDEX "LeadCustomer_batchId_phone_key" ON "LeadCustomer"("batchId", "phone");
CREATE INDEX "LeadCustomer_ownerId_updatedAt_idx" ON "LeadCustomer"("ownerId", "updatedAt");
CREATE INDEX "LeadCustomer_phone_idx" ON "LeadCustomer"("phone");
CREATE INDEX "LeadCustomer_deviceId_idx" ON "LeadCustomer"("deviceId");
CREATE INDEX "LeadCustomer_expertOwnerId_idx" ON "LeadCustomer"("expertOwnerId");

-- Rebuild orders so lead ownership and correction actors cannot become orphaned.
CREATE TABLE "new_CustomerOrder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "phone" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "enteredById" TEXT NOT NULL,
  "openedOn" TEXT NOT NULL,
  "initialDepositCents" INTEGER NOT NULL,
  "leadId" TEXT,
  "voidedAt" DATETIME,
  "voidReason" TEXT,
  "voidedById" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CustomerOrder_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SourceBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CustomerOrder_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CustomerOrder_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "LeadCustomer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CustomerOrder_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CustomerOrder" SELECT "id", "phone", "batchId", "enteredById", "openedOn", "initialDepositCents", "leadId", "voidedAt", "voidReason", "voidedById", "createdAt", "updatedAt" FROM "CustomerOrder";
DROP TABLE "CustomerOrder";
ALTER TABLE "new_CustomerOrder" RENAME TO "CustomerOrder";
CREATE UNIQUE INDEX "CustomerOrder_phone_key" ON "CustomerOrder"("phone");
CREATE UNIQUE INDEX "CustomerOrder_leadId_key" ON "CustomerOrder"("leadId");
CREATE INDEX "CustomerOrder_enteredById_openedOn_idx" ON "CustomerOrder"("enteredById", "openedOn");
CREATE INDEX "CustomerOrder_batchId_idx" ON "CustomerOrder"("batchId");

-- Rebuild finance facts so correction actors also have database-level integrity.
CREATE TABLE "new_MetricEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "batchId" TEXT NOT NULL,
  "enteredById" TEXT NOT NULL,
  "occurredOn" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "quantity" INTEGER,
  "amountCents" INTEGER,
  "parentEventId" TEXT,
  "customerOrderId" TEXT,
  "continuationNumber" INTEGER,
  "voidedAt" DATETIME,
  "voidReason" TEXT,
  "voidedById" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetricEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SourceBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MetricEvent_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MetricEvent_parentEventId_fkey" FOREIGN KEY ("parentEventId") REFERENCES "MetricEvent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MetricEvent_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "CustomerOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MetricEvent_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MetricEvent" SELECT "id", "batchId", "enteredById", "occurredOn", "kind", "quantity", "amountCents", "parentEventId", "customerOrderId", "continuationNumber", "voidedAt", "voidReason", "voidedById", "createdAt" FROM "MetricEvent";
DROP TABLE "MetricEvent";
ALTER TABLE "new_MetricEvent" RENAME TO "MetricEvent";
CREATE INDEX "MetricEvent_parentEventId_idx" ON "MetricEvent"("parentEventId");
CREATE INDEX "MetricEvent_customerOrderId_idx" ON "MetricEvent"("customerOrderId");
CREATE UNIQUE INDEX "MetricEvent_customerOrderId_continuationNumber_key" ON "MetricEvent"("customerOrderId", "continuationNumber");

-- `role` is now the only position field. Keeping a second copy caused permission drift.
ALTER TABLE "User" DROP COLUMN "memberJob";

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
