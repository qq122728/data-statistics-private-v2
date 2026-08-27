-- 专家独立跟进说明；不再与炒群/客户公共备注共用同一个字段。
ALTER TABLE "LeadCustomer" ADD COLUMN "expertNotes" TEXT;
