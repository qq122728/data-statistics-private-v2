ALTER TABLE "LeadCustomer" ADD COLUMN "currentGroupId" TEXT REFERENCES "TeamGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "LeadCustomer_currentGroupId_updatedAt_idx" ON "LeadCustomer"("currentGroupId", "updatedAt");
