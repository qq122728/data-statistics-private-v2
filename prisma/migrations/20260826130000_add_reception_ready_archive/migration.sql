ALTER TABLE "LeadCustomer" ADD COLUMN "receptionChatStatus" TEXT NOT NULL DEFAULT 'NORMAL_CHAT';
ALTER TABLE "LeadCustomer" ADD COLUMN "receptionStatusChangedAt" DATETIME;
ALTER TABLE "LeadCustomer" ADD COLUMN "receptionArchivedAt" DATETIME;
ALTER TABLE "LeadCustomer" ADD COLUMN "receptionArchiveReason" TEXT;
ALTER TABLE "LeadCustomer" ADD COLUMN "receptionArchiveVisitCount" INTEGER CHECK ("receptionArchiveVisitCount" IS NULL OR "receptionArchiveVisitCount" BETWEEN 0 AND 999);

CREATE INDEX "LeadCustomer_ownerId_receptionChatStatus_updatedAt_idx"
  ON "LeadCustomer"("ownerId", "receptionChatStatus", "updatedAt");

CREATE INDEX "LeadCustomer_ownerId_receptionArchivedAt_idx"
  ON "LeadCustomer"("ownerId", "receptionArchivedAt");
