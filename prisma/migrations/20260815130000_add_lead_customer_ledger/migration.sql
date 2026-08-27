-- Each imported phone becomes a customer record owned by the member who entered it.
CREATE TABLE "LeadCustomer" (
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
  "groupStatus" TEXT NOT NULL DEFAULT 'NOT_JOINED',
  "joinedOn" TEXT,
  "leftOn" TEXT,
  "expertIntroducedOn" TEXT,
  "registeredOn" TEXT,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "LeadCustomer_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SourceBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LeadCustomer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LeadCustomer_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LeadCustomer_batchId_phone_key" ON "LeadCustomer"("batchId", "phone");
CREATE INDEX "LeadCustomer_ownerId_updatedAt_idx" ON "LeadCustomer"("ownerId", "updatedAt");
CREATE INDEX "LeadCustomer_phone_idx" ON "LeadCustomer"("phone");
CREATE INDEX "LeadCustomer_deviceId_idx" ON "LeadCustomer"("deviceId");

CREATE TABLE "Device" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "memberId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Device_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Device_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Device_groupId_code_key" ON "Device"("groupId", "code");
CREATE INDEX "Device_memberId_active_idx" ON "Device"("memberId", "active");

CREATE TABLE "LeadActivity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leadId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "occurredOn" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "LeadCustomer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeadActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "LeadActivity_leadId_createdAt_idx" ON "LeadActivity"("leadId", "createdAt");
CREATE INDEX "LeadActivity_actorId_occurredOn_idx" ON "LeadActivity"("actorId", "occurredOn");

CREATE TABLE "LeadException" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "batchId" TEXT,
  "leadId" TEXT,
  "actorId" TEXT NOT NULL,
  "ownerId" TEXT,
  "phone" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "reason" TEXT,
  "occurredOn" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadException_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SourceBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LeadException_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "LeadCustomer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LeadException_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LeadException_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "LeadException_actorId_occurredOn_idx" ON "LeadException"("actorId", "occurredOn");
CREATE INDEX "LeadException_ownerId_occurredOn_idx" ON "LeadException"("ownerId", "occurredOn");
CREATE INDEX "LeadException_batchId_idx" ON "LeadException"("batchId");

ALTER TABLE "CustomerOrder" ADD COLUMN "leadId" TEXT;
CREATE UNIQUE INDEX "CustomerOrder_leadId_key" ON "CustomerOrder"("leadId");
