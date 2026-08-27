ALTER TABLE "LeadCustomer"
  ADD COLUMN "receptionCategory" TEXT NOT NULL DEFAULT 'PENDING';

UPDATE "LeadCustomer"
SET "receptionCategory" = CASE
  WHEN "invalid" = 1 AND LOWER(COALESCE("invalidReason", '')) LIKE '%低金额%' THEN 'LOW_AMOUNT'
  WHEN "invalid" = 1 THEN 'NO_WS'
  ELSE 'VALID'
END;

CREATE INDEX "LeadCustomer_ownerId_receptionCategory_updatedAt_idx"
  ON "LeadCustomer"("ownerId", "receptionCategory", "updatedAt");
