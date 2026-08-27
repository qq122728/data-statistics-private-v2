CREATE TYPE "ReceptionChatStatus" AS ENUM ('NORMAL_CHAT', 'READY_TO_JOIN');

ALTER TYPE "LeadActivityKind" ADD VALUE 'RECEPTION_STATUS_UPDATED';
ALTER TYPE "LeadActivityKind" ADD VALUE 'RECEPTION_ARCHIVED';

ALTER TABLE "LeadCustomer"
  ADD COLUMN "receptionChatStatus" "ReceptionChatStatus" NOT NULL DEFAULT 'NORMAL_CHAT',
  ADD COLUMN "receptionStatusChangedAt" TIMESTAMP(3),
  ADD COLUMN "receptionArchivedAt" TIMESTAMP(3),
  ADD COLUMN "receptionArchiveReason" TEXT,
  ADD COLUMN "receptionArchiveVisitCount" INTEGER;

ALTER TABLE "LeadCustomer"
  ADD CONSTRAINT "LeadCustomer_receptionArchiveVisitCount_check"
  CHECK ("receptionArchiveVisitCount" IS NULL OR "receptionArchiveVisitCount" BETWEEN 0 AND 999);

CREATE INDEX "LeadCustomer_ownerId_receptionChatStatus_updatedAt_idx"
  ON "LeadCustomer"("ownerId", "receptionChatStatus", "updatedAt");

CREATE INDEX "LeadCustomer_ownerId_receptionArchivedAt_idx"
  ON "LeadCustomer"("ownerId", "receptionArchivedAt");
