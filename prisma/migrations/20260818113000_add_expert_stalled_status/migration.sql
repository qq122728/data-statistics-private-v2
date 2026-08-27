-- “杀不动”不是删除客户，而是保留一个可恢复的专家跟进状态。
ALTER TABLE "LeadCustomer" ADD COLUMN "expertStalledOn" TEXT;
ALTER TABLE "LeadCustomer" ADD COLUMN "expertStalledReason" TEXT;
ALTER TABLE "LeadCustomer" ADD COLUMN "expertStalledNote" TEXT;

CREATE INDEX "LeadCustomer_expertOwnerId_expertStalledOn_updatedAt_idx"
ON "LeadCustomer"("expertOwnerId", "expertStalledOn", "updatedAt");
