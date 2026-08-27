-- 粉的归属与实际录入人分开保存：历史客户默认归到原录入人，避免旧报表数字变化。
ALTER TABLE "LeadCustomer" ADD COLUMN "attributionOwnerId" TEXT;

UPDATE "LeadCustomer"
SET "attributionOwnerId" = "ownerId"
WHERE "attributionOwnerId" IS NULL;

CREATE INDEX "LeadCustomer_attributionOwnerId_updatedAt_idx"
ON "LeadCustomer"("attributionOwnerId", "updatedAt");
