CREATE TABLE "ResourceBuyerPhone" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "channelId" TEXT NOT NULL,
  "buyerId" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "sourceDate" TEXT NOT NULL,
  "groupId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ResourceBuyerPhone_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "TrafficBuyer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ResourceBuyerPhone_channelId_phone_key" ON "ResourceBuyerPhone"("channelId", "phone");
CREATE INDEX "ResourceBuyerPhone_buyerId_sourceDate_idx" ON "ResourceBuyerPhone"("buyerId", "sourceDate");
CREATE INDEX "ResourceBuyerPhone_channelId_sourceDate_idx" ON "ResourceBuyerPhone"("channelId", "sourceDate");
