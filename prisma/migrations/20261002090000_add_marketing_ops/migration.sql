CREATE TABLE "TrafficBuyer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "channelId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "employeeCode" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "AdAccount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "channelId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "externalCode" TEXT,
  "buyerId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AdAccount_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "TrafficBuyer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AdCampaign" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "channelId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "externalCode" TEXT,
  "adAccountId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AdCampaign_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CreativeAsset" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "channelId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "externalCode" TEXT,
  "campaignId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CreativeAsset_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AdCampaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SmsVendor" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "channelId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "contactName" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "SmsBatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "channelId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "externalCode" TEXT,
  "vendorId" TEXT NOT NULL,
  "sentOn" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SmsBatch_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "SmsVendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MarketingAttribution" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "channelId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "trafficBuyerId" TEXT,
  "adAccountId" TEXT,
  "adCampaignId" TEXT,
  "creativeAssetId" TEXT,
  "smsVendorId" TEXT,
  "smsBatchId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MarketingAttribution_trafficBuyerId_fkey" FOREIGN KEY ("trafficBuyerId") REFERENCES "TrafficBuyer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MarketingAttribution_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MarketingAttribution_adCampaignId_fkey" FOREIGN KEY ("adCampaignId") REFERENCES "AdCampaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MarketingAttribution_creativeAssetId_fkey" FOREIGN KEY ("creativeAssetId") REFERENCES "CreativeAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MarketingAttribution_smsVendorId_fkey" FOREIGN KEY ("smsVendorId") REFERENCES "SmsVendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MarketingAttribution_smsBatchId_fkey" FOREIGN KEY ("smsBatchId") REFERENCES "SmsBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "MarketingDailyEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessDate" TEXT NOT NULL,
  "attributionId" TEXT NOT NULL,
  "spendCents" INTEGER NOT NULL DEFAULT 0,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "deliveredCount" INTEGER NOT NULL DEFAULT 0,
  "fansCount" INTEGER NOT NULL DEFAULT 0,
  "validFansCount" INTEGER NOT NULL DEFAULT 0,
  "conversionCount" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MarketingDailyEntry_attributionId_fkey" FOREIGN KEY ("attributionId") REFERENCES "MarketingAttribution" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MarketingDailyEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "TrafficBuyer_channelId_active_idx" ON "TrafficBuyer"("channelId", "active");
CREATE UNIQUE INDEX "TrafficBuyer_channelId_name_key" ON "TrafficBuyer"("channelId", "name");
CREATE INDEX "AdAccount_channelId_active_idx" ON "AdAccount"("channelId", "active");
CREATE INDEX "AdAccount_buyerId_idx" ON "AdAccount"("buyerId");
CREATE UNIQUE INDEX "AdAccount_channelId_name_key" ON "AdAccount"("channelId", "name");
CREATE INDEX "AdCampaign_channelId_active_idx" ON "AdCampaign"("channelId", "active");
CREATE UNIQUE INDEX "AdCampaign_adAccountId_name_key" ON "AdCampaign"("adAccountId", "name");
CREATE INDEX "CreativeAsset_channelId_active_idx" ON "CreativeAsset"("channelId", "active");
CREATE UNIQUE INDEX "CreativeAsset_campaignId_name_key" ON "CreativeAsset"("campaignId", "name");
CREATE INDEX "SmsVendor_channelId_active_idx" ON "SmsVendor"("channelId", "active");
CREATE UNIQUE INDEX "SmsVendor_channelId_name_key" ON "SmsVendor"("channelId", "name");
CREATE INDEX "SmsBatch_channelId_active_idx" ON "SmsBatch"("channelId", "active");
CREATE UNIQUE INDEX "SmsBatch_vendorId_name_key" ON "SmsBatch"("vendorId", "name");
CREATE INDEX "MarketingAttribution_channelId_sourceType_active_idx" ON "MarketingAttribution"("channelId", "sourceType", "active");
CREATE INDEX "MarketingAttribution_creativeAssetId_idx" ON "MarketingAttribution"("creativeAssetId");
CREATE INDEX "MarketingAttribution_smsBatchId_idx" ON "MarketingAttribution"("smsBatchId");
CREATE UNIQUE INDEX "MarketingAttribution_channelId_sourceType_name_key" ON "MarketingAttribution"("channelId", "sourceType", "name");
CREATE INDEX "MarketingDailyEntry_businessDate_idx" ON "MarketingDailyEntry"("businessDate");
CREATE INDEX "MarketingDailyEntry_attributionId_businessDate_idx" ON "MarketingDailyEntry"("attributionId", "businessDate");
CREATE UNIQUE INDEX "MarketingDailyEntry_businessDate_attributionId_key" ON "MarketingDailyEntry"("businessDate", "attributionId");
