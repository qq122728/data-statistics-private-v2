CREATE TYPE "AttendanceLeaveDuration" AS ENUM ('FULL_DAY', 'HALF_DAY');
CREATE TYPE "AttendanceHistoricalMark" AS ENUM ('PRESENT', 'LEAVE', 'HALF_DAY_LEAVE');

ALTER TABLE "AttendanceRecord"
  ADD COLUMN "leaveDuration" "AttendanceLeaveDuration",
  ADD COLUMN "isHistoricalRecord" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "historicalMark" "AttendanceHistoricalMark",
  ADD COLUMN "historicalSourceName" TEXT;
