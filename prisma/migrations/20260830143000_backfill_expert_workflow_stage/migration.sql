-- Keep persisted expert stages aligned with the compatibility resolver used by
-- customer lists. Existing rows predate expertWorkflowStage and otherwise look
-- actionable in the UI while being rejected by workflow mutations.
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

-- Old records did not have a separate tracking start timestamp. Their expert
-- contact date is the earliest truthful fallback and preserves date ordering.
UPDATE "LeadCustomer"
SET "expertTrackingStartedAt" = "expertContactedOn" || 'T12:00:00.000Z'
WHERE "expertTrackingStartedAt" IS NULL
  AND "expertContactedOn" IS NOT NULL
  AND "expertWorkflowStage" IN ('TRACKING', 'PENDING_REGISTRATION', 'PENDING_ORDER', 'DECLINED_DEPOSIT', 'ORDERED', 'STALLED');
