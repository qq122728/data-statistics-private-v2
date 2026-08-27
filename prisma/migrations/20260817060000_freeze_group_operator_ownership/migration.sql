ALTER TABLE "LeadCustomer" ADD COLUMN "groupOperatorOwnerId" TEXT;

CREATE INDEX "LeadCustomer_groupOperatorOwnerId_updatedAt_idx"
  ON "LeadCustomer"("groupOperatorOwnerId", "updatedAt");
