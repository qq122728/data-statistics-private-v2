-- 已注册但没有首充，与已开单后的“杀不动”分开保存，避免统计混淆。
ALTER TABLE "LeadCustomer" ADD COLUMN "noInitialDepositOn" TEXT;
ALTER TABLE "LeadCustomer" ADD COLUMN "noInitialDepositReason" TEXT;
ALTER TABLE "LeadCustomer" ADD COLUMN "noInitialDepositNote" TEXT;

CREATE INDEX "LeadCustomer_expertOwnerId_noInitialDepositOn_updatedAt_idx"
ON "LeadCustomer"("expertOwnerId", "noInitialDepositOn", "updatedAt");
