CREATE TABLE "ResourceBuyerMaterial" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "buyerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "url" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ResourceBuyerMaterial_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResourceBuyerMaterial_buyerId_name_key" ON "ResourceBuyerMaterial"("buyerId", "name");
CREATE INDEX "ResourceBuyerMaterial_channelId_active_idx" ON "ResourceBuyerMaterial"("channelId", "active");
ALTER TABLE "ResourceBuyerMaterial" ADD CONSTRAINT "ResourceBuyerMaterial_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "TrafficBuyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceBuyerPhone" ADD COLUMN "materialId" TEXT;
CREATE INDEX "ResourceBuyerPhone_materialId_sourceDate_idx" ON "ResourceBuyerPhone"("materialId", "sourceDate");
ALTER TABLE "ResourceBuyerPhone" ADD CONSTRAINT "ResourceBuyerPhone_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "ResourceBuyerMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;
