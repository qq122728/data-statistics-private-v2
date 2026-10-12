CREATE TABLE "ResourceBuyerMaterial" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "channelId" TEXT NOT NULL,
  "buyerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "url" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ResourceBuyerMaterial_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "TrafficBuyer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ResourceBuyerMaterial_buyerId_name_key" ON "ResourceBuyerMaterial"("buyerId", "name");
CREATE INDEX "ResourceBuyerMaterial_channelId_active_idx" ON "ResourceBuyerMaterial"("channelId", "active");
ALTER TABLE "ResourceBuyerPhone" ADD COLUMN "materialId" TEXT REFERENCES "ResourceBuyerMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ResourceBuyerPhone_materialId_sourceDate_idx" ON "ResourceBuyerPhone"("materialId", "sourceDate");
