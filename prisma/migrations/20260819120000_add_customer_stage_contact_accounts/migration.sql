-- 客户交接中各阶段使用的联系账号；保留号码快照，不让后续账号变更覆盖历史。
ALTER TABLE "LeadCustomer" ADD COLUMN "groupDeviceAccountId" TEXT;
ALTER TABLE "LeadCustomer" ADD COLUMN "groupDeviceAccountNumber" TEXT;
ALTER TABLE "LeadCustomer" ADD COLUMN "expertDeviceAccountId" TEXT;
ALTER TABLE "LeadCustomer" ADD COLUMN "expertDeviceAccountNumber" TEXT;
CREATE INDEX "LeadCustomer_groupDeviceAccountId_idx" ON "LeadCustomer"("groupDeviceAccountId");
CREATE INDEX "LeadCustomer_expertDeviceAccountId_idx" ON "LeadCustomer"("expertDeviceAccountId");
