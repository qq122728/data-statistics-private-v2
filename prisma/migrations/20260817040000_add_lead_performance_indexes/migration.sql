CREATE INDEX "LeadCustomer_batchId_invalid_groupStatus_expertIntroducedOn_idx"
ON "LeadCustomer"("batchId", "invalid", "groupStatus", "expertIntroducedOn");

CREATE INDEX "LeadCustomer_batchId_invalid_expertOwnerId_registeredOn_idx"
ON "LeadCustomer"("batchId", "invalid", "expertOwnerId", "registeredOn");
