-- CreateEnum
CREATE TYPE "ChannelReviewStatus" AS ENUM ('SENT', 'CONFIRMED', 'DISPUTED');

-- CreateTable
CREATE TABLE "ChannelReviewEntry" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "reviewDate" TEXT NOT NULL,
    "status" "ChannelReviewStatus" NOT NULL DEFAULT 'SENT',
    "note" TEXT,
    "sentById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelReviewEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelReviewEntry_channelId_status_idx" ON "ChannelReviewEntry"("channelId", "status");

-- CreateIndex
CREATE INDEX "ChannelReviewEntry_groupId_reviewDate_idx" ON "ChannelReviewEntry"("groupId", "reviewDate");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelReviewEntry_groupId_channelId_reviewDate_key" ON "ChannelReviewEntry"("groupId", "channelId", "reviewDate");

-- AddForeignKey
ALTER TABLE "ChannelReviewEntry" ADD CONSTRAINT "ChannelReviewEntry_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelReviewEntry" ADD CONSTRAINT "ChannelReviewEntry_channelId_groupId_fkey" FOREIGN KEY ("channelId", "groupId") REFERENCES "Channel"("id", "groupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelReviewEntry" ADD CONSTRAINT "ChannelReviewEntry_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelReviewEntry" ADD CONSTRAINT "ChannelReviewEntry_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
