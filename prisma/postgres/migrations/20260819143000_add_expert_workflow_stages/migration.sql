-- 专家八阶段：旧客户保留空值，页面会从已有业务记录安全推断阶段。
CREATE TYPE "ExpertWorkflowStage" AS ENUM (
  'QUEUED',
  'MATERIALS',
  'TRACKING',
  'PENDING_REGISTRATION',
  'PENDING_ORDER',
  'DECLINED_DEPOSIT',
  'ORDERED',
  'STALLED'
);

ALTER TABLE "LeadCustomer" ADD COLUMN "expertWorkflowStage" "ExpertWorkflowStage";
ALTER TABLE "LeadCustomer" ADD COLUMN "expertStageChangedAt" TIMESTAMP(3);
ALTER TABLE "LeadCustomer" ADD COLUMN "expertTrackingStartedAt" TIMESTAMP(3);

CREATE INDEX "LeadCustomer_expertOwnerId_expertWorkflowStage_expertTrackingStartedAt_idx"
ON "LeadCustomer"("expertOwnerId", "expertWorkflowStage", "expertTrackingStartedAt");
