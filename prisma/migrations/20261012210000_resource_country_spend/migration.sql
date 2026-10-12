ALTER TABLE "ResourceBuyerPhone" ADD COLUMN "country" TEXT NOT NULL DEFAULT '';
CREATE TABLE "ResourceBuyerSpend" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "entryKey" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "buyerId" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "spendDate" TEXT NOT NULL,
  "materialId" TEXT,
  "currency" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL CHECK ("amountCents" >= 0),
  "note" TEXT NOT NULL DEFAULT '',
  "createdById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ResourceBuyerSpend_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "TrafficBuyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ResourceBuyerSpend_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "ResourceBuyerMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ResourceBuyerSpend_entryKey_key" ON "ResourceBuyerSpend"("entryKey");
CREATE INDEX "ResourceBuyerSpend_channelId_spendDate_country_idx" ON "ResourceBuyerSpend"("channelId", "spendDate", "country");
