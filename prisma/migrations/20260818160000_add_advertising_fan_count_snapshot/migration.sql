-- 旧投流批次不反推产粉数量：客户后续可能被删除或修正，猜出来会污染历史账。
-- 缺少该字段的旧批次会由只读巡检脚本列为“待人工核对”。
ALTER TABLE "SourceBatch" ADD COLUMN "advertisingFanCount" INTEGER;
