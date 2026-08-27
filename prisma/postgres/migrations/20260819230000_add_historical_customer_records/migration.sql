ALTER TABLE "SourceBatch" ADD COLUMN "isHistoricalRecord" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeadCustomer" ADD COLUMN "isHistoricalRecord" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeadCustomer" ADD COLUMN "historicalSourceName" TEXT;

CREATE INDEX "LeadCustomer_isHistoricalRecord_idx" ON "LeadCustomer"("isHistoricalRecord");
