-- Existing employees deliberately remain NULL so finance can review them as “待补”.
ALTER TABLE "User" ADD COLUMN "recruitmentSource" TEXT;
ALTER TABLE "User" ADD COLUMN "referrerName" TEXT;
