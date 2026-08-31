ALTER TABLE "LeadCustomer" ADD COLUMN "currentGroupId" TEXT;
CREATE INDEX "LeadCustomer_currentGroupId_updatedAt_idx" ON "LeadCustomer"("currentGroupId", "updatedAt");
ALTER TABLE "LeadCustomer" ADD CONSTRAINT "LeadCustomer_currentGroupId_fkey" FOREIGN KEY ("currentGroupId") REFERENCES "TeamGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
