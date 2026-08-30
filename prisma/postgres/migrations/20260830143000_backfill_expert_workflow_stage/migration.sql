-- Align persisted legacy expert stages with the shared compatibility resolver.
UPDATE "LeadCustomer"
SET "expertWorkflowStage" = CASE
  WHEN "expertStalledOn" IS NOT NULL THEN 'STALLED'
  WHEN EXISTS (
    SELECT 1 FROM "CustomerOrder"
    WHERE "CustomerOrder"."batchId" = "LeadCustomer"."batchId"
      AND "CustomerOrder"."phone" = "LeadCustomer"."phone"
      AND "CustomerOrder"."voidedAt" IS NULL
  ) THEN 'ORDERED'
  WHEN "noInitialDepositOn" IS NOT NULL THEN 'DECLINED_DEPOSIT'
  WHEN "registeredOn" IS NOT NULL THEN 'PENDING_ORDER'
  WHEN "expertContactedOn" IS NOT NULL THEN 'TRACKING'
  WHEN "expertIntroducedOn" IS NOT NULL THEN 'QUEUED'
  ELSE NULL
END
WHERE "expertWorkflowStage" IS NULL
  AND "expertIntroducedOn" IS NOT NULL;

UPDATE "LeadCustomer"
SET "expertTrackingStartedAt" = ("expertContactedOn" || 'T12:00:00.000Z')::timestamptz
WHERE "expertTrackingStartedAt" IS NULL
  AND "expertContactedOn" IS NOT NULL
  AND "expertWorkflowStage" IN ('TRACKING', 'PENDING_REGISTRATION', 'PENDING_ORDER', 'DECLINED_DEPOSIT', 'ORDERED', 'STALLED');
