ALTER TABLE "MetricEvent" ADD COLUMN "derivedFromLedger" BOOLEAN NOT NULL DEFAULT false;

-- Customer-ledger writes also create MetricEvent compatibility rows. Mark
-- those rows so reporting can combine genuine legacy aggregates with the
-- phone-level ledger without counting the same customer twice.
UPDATE "MetricEvent"
SET "derivedFromLedger" = true
WHERE EXISTS (
     SELECT 1
     FROM "CustomerOrder"
     WHERE "CustomerOrder"."id" = "MetricEvent"."customerOrderId"
       AND "CustomerOrder"."leadId" IS NOT NULL
   )
   OR (
     "kind" IN ('NEW_FANS', 'EFFECTIVE_FANS', 'NO_NUMBER', 'DUPLICATE_FANS')
     AND EXISTS (
       SELECT 1
       FROM "LeadCustomer"
       WHERE "LeadCustomer"."batchId" = "MetricEvent"."batchId"
     )
   );
