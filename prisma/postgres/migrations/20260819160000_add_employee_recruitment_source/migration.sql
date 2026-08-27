-- Existing employees deliberately remain NULL so finance can review them as “待补”.
CREATE TYPE "RecruitmentSource" AS ENUM ('DIRECT', 'AGENT');

ALTER TABLE "User" ADD COLUMN "recruitmentSource" "RecruitmentSource";
ALTER TABLE "User" ADD COLUMN "referrerName" TEXT;
