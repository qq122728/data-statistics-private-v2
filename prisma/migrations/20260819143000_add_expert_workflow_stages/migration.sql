-- 专家八段流程：旧客户不强制回填，页面会按已有记录安全推断阶段。
-- 新进入专家流程的客户从排队中开始；追踪阶段使用精确时间计算 48 小时。
ALTER TABLE "LeadCustomer" ADD COLUMN "expertWorkflowStage" TEXT;
ALTER TABLE "LeadCustomer" ADD COLUMN "expertStageChangedAt" DATETIME;
ALTER TABLE "LeadCustomer" ADD COLUMN "expertTrackingStartedAt" DATETIME;

CREATE INDEX "LeadCustomer_expertOwnerId_expertWorkflowStage_expertTrackingStartedAt_idx"
ON "LeadCustomer"("expertOwnerId", "expertWorkflowStage", "expertTrackingStartedAt");
