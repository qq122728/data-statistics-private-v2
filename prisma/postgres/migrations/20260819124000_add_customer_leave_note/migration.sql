-- 退群备注独立保存，供炒群、专家与管理层共同核对；不混入其他跟进记录。
ALTER TABLE "LeadCustomer" ADD COLUMN "leftNote" TEXT;
