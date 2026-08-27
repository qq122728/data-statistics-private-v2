-- Do not infer historical fan counts from current leads; later corrections make that unsafe.
ALTER TABLE "SourceBatch" ADD COLUMN "advertisingFanCount" INTEGER;
