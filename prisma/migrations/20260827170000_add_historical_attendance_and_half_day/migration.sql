ALTER TABLE "AttendanceRecord" ADD COLUMN "leaveDuration" TEXT;
ALTER TABLE "AttendanceRecord" ADD COLUMN "isHistoricalRecord" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AttendanceRecord" ADD COLUMN "historicalMark" TEXT;
ALTER TABLE "AttendanceRecord" ADD COLUMN "historicalSourceName" TEXT;
