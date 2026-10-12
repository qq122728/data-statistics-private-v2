CREATE TABLE "ResourceBuyerPhone" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "buyerId" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "sourceDate" TEXT NOT NULL,
  "groupId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ResourceBuyerPhone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResourceBuyerPhone_channelId_phone_key" ON "ResourceBuyerPhone"("channelId", "phone");
CREATE INDEX "ResourceBuyerPhone_buyerId_sourceDate_idx" ON "ResourceBuyerPhone"("buyerId", "sourceDate");
CREATE INDEX "ResourceBuyerPhone_channelId_sourceDate_idx" ON "ResourceBuyerPhone"("channelId", "sourceDate");
ALTER TABLE "ResourceBuyerPhone" ADD CONSTRAINT "ResourceBuyerPhone_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "TrafficBuyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
