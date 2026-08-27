-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'RESOURCE_MANAGER', 'COMPANY_MANAGER', 'FINANCE', 'LEAD', 'RECEPTION', 'GROUP_OPERATOR', 'EXPERT');

-- CreateEnum
CREATE TYPE "MetricKind" AS ENUM ('NEW_FANS', 'EFFECTIVE_FANS', 'NO_NUMBER', 'DUPLICATE_FANS', 'REPLIES', 'GROUP_JOIN', 'GROUP_LEAVE', 'EXPERT_INTRO', 'REGISTRATION', 'ORDER', 'RECHARGE', 'WITHDRAWAL', 'CHANNEL_PERFORMANCE');

-- CreateEnum
CREATE TYPE "LeadReplyStatus" AS ENUM ('NOT_REPLIED', 'REPLIED', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "LeadGroupStatus" AS ENUM ('NOT_JOINED', 'JOINED', 'LEFT');

-- CreateEnum
CREATE TYPE "ReceptionCategory" AS ENUM ('PENDING', 'VALID', 'INVALID', 'LOW_AMOUNT', 'NO_WS');

-- CreateEnum
CREATE TYPE "FanCostMode" AS ENUM ('FREE', 'PAID');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('SMS', 'ADS', 'REBATE');

-- CreateEnum
CREATE TYPE "DeviceAccountType" AS ENUM ('NORMAL_WS', 'BUSINESS_WS', 'RCS');

-- CreateEnum
CREATE TYPE "LeadActivityKind" AS ENUM ('DEVICE_ASSIGNED', 'REPLIED', 'FOLLOWED_UP', 'JOINED_GROUP', 'LEFT_GROUP', 'EXPERT_INTRODUCED', 'EXPERT_CONTACTED', 'REGISTERED', 'MARKED_INVALID', 'RESTORED_VALID', 'GROUP_JOIN_REVOKED', 'GROUP_LEAVE_REVOKED', 'EXPERT_INTRO_REVOKED', 'EXPERT_CONTACT_REVOKED', 'REGISTRATION_REVOKED', 'ORDER_VOIDED', 'FINANCE_VOIDED', 'PLAN_UPDATED', 'GROUP_PROGRESS_UPDATED');

-- CreateEnum
CREATE TYPE "LeadExceptionKind" AS ENUM ('INVALID_FORMAT', 'DUPLICATE_IN_PASTE', 'COLLISION', 'MANUAL_INVALID');

-- CreateEnum
CREATE TYPE "EmployeeStageOverride" AS ENUM ('TRAINING', 'OBSERVATION', 'FORMAL', 'PAUSED');

-- CreateEnum
CREATE TYPE "RiskDecisionLevel" AS ENUM ('LIMIT_WATCH', 'ELIMINATION_WATCH');

-- CreateEnum
CREATE TYPE "AttendanceClockStatus" AS ENUM ('NORMAL', 'LATE', 'EARLY');

-- CreateEnum
CREATE TYPE "AttendanceLeaveType" AS ENUM ('PERSONAL', 'SICK', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('GENERAL', 'IMPORTANT', 'REWARD', 'REMINDER');

-- CreateEnum
CREATE TYPE "NotificationTargetType" AS ENUM ('ALL', 'GROUP', 'ROLE', 'USERS');

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "countryCode" TEXT NOT NULL DEFAULT 'CN',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "workStartMinutes" INTEGER NOT NULL DEFAULT 600,
    "workEndMinutes" INTEGER NOT NULL DEFAULT 1320,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL DEFAULT '',
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "groupId" TEXT,
    "departmentId" TEXT,
    "hireDate" TEXT,
    "stageOverride" "EmployeeStageOverride",
    "stageOverrideReason" TEXT,
    "stageOverrideAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "departmentId" TEXT NOT NULL DEFAULT 'default-department',
    "countryCode" TEXT,
    "timezone" TEXT,
    "workStartMinutes" INTEGER,
    "workEndMinutes" INTEGER,
    "receptionJoinPassRate" INTEGER NOT NULL DEFAULT 10,
    "receptionJoinGoodRate" INTEGER NOT NULL DEFAULT 15,
    "receptionJoinExcellentRate" INTEGER NOT NULL DEFAULT 20,
    "operatorExpertPassRate" INTEGER NOT NULL DEFAULT 60,
    "operatorExpertGoodRate" INTEGER NOT NULL DEFAULT 70,
    "operatorExpertExcellentRate" INTEGER NOT NULL DEFAULT 80,
    "expertOrderPassRate" INTEGER NOT NULL DEFAULT 10,
    "expertOrderGoodRate" INTEGER NOT NULL DEFAULT 15,
    "expertOrderExcellentRate" INTEGER NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "groupId" TEXT NOT NULL,
    "createdById" TEXT,
    "fanCostMode" "FanCostMode" NOT NULL DEFAULT 'FREE',
    "effectiveFanPriceCents" INTEGER,
    "channelType" "ChannelType" NOT NULL DEFAULT 'SMS',
    "rebateRateBps" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id","groupId")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskDecision" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "level" "RiskDecisionLevel" NOT NULL,
    "evidenceThrough" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SourceBatch" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "sourceDate" TEXT NOT NULL,
    "fanCostModeSnapshot" "FanCostMode" NOT NULL DEFAULT 'FREE',
    "effectiveFanPriceCentsSnapshot" INTEGER,
    "channelTypeSnapshot" "ChannelType" NOT NULL DEFAULT 'SMS',
    "rebateRateBpsSnapshot" INTEGER,
    "advertisingSpendCents" INTEGER,
    "advertisingServiceFeeRateBps" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricEvent" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "enteredById" TEXT NOT NULL,
    "occurredOn" TEXT NOT NULL,
    "kind" "MetricKind" NOT NULL,
    "quantity" INTEGER,
    "amountCents" INTEGER,
    "derivedFromLedger" BOOLEAN NOT NULL DEFAULT false,
    "parentEventId" TEXT,
    "customerOrderId" TEXT,
    "continuationNumber" INTEGER,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerOrder" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "enteredById" TEXT NOT NULL,
    "openedOn" TEXT NOT NULL,
    "initialDepositCents" INTEGER NOT NULL,
    "leadId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadCustomer" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "deviceId" TEXT,
    "invalid" BOOLEAN NOT NULL DEFAULT false,
    "invalidReason" TEXT,
    "receptionCategory" "ReceptionCategory" NOT NULL DEFAULT 'VALID',
    "replyStatus" "LeadReplyStatus" NOT NULL DEFAULT 'NOT_REPLIED',
    "repliedOn" TEXT,
    "followUpCount" INTEGER NOT NULL DEFAULT 0,
    "lastFollowedUpOn" TEXT,
    "customerName" TEXT,
    "lossAmountCents" INTEGER,
    "groupStatus" "LeadGroupStatus" NOT NULL DEFAULT 'NOT_JOINED',
    "joinedOn" TEXT,
    "leftOn" TEXT,
    "leftWithOrder" BOOLEAN,
    "expertIntroducedOn" TEXT,
    "expertContactedOn" TEXT,
    "expertContactNote" TEXT,
    "expertStalledOn" TEXT,
    "expertStalledReason" TEXT,
    "expertStalledNote" TEXT,
    "noInitialDepositOn" TEXT,
    "noInitialDepositReason" TEXT,
    "noInitialDepositNote" TEXT,
    "registeredOn" TEXT,
    "nextPlan" TEXT,
    "nextFollowUpOn" TEXT,
    "notes" TEXT,
    "expertOwnerId" TEXT,
    "groupOperatorOwnerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupOperatorReception" (
    "groupOperatorId" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupOperatorReception_pkey" PRIMARY KEY ("groupOperatorId","receptionistId")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "memberId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceAccount" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "accountType" "DeviceAccountType" NOT NULL,
    "provider" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "renewalDate" TEXT,
    "purpose" TEXT,
    "situation" TEXT,
    "phoneCode" TEXT,
    "followUp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" "LeadActivityKind" NOT NULL,
    "occurredOn" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadException" (
    "id" TEXT NOT NULL,
    "batchId" TEXT,
    "leadId" TEXT,
    "actorId" TEXT NOT NULL,
    "ownerId" TEXT,
    "phone" TEXT NOT NULL,
    "kind" "LeadExceptionKind" NOT NULL,
    "reason" TEXT,
    "occurredOn" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyEntryConfirmation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyEntryConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "scheduledStartMinutes" INTEGER NOT NULL,
    "scheduledEndMinutes" INTEGER NOT NULL,
    "clockInAt" TIMESTAMP(3),
    "clockOutAt" TIMESTAMP(3),
    "clockInStatus" "AttendanceClockStatus",
    "clockOutStatus" "AttendanceClockStatus",
    "leaveType" "AttendanceLeaveType",
    "leaveReason" TEXT,
    "leaveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'GENERAL',
    "requiresAck" BOOLEAN NOT NULL DEFAULT false,
    "targetType" "NotificationTargetType" NOT NULL,
    "senderId" TEXT NOT NULL,
    "targetDepartmentId" TEXT,
    "targetGroupId" TEXT,
    "targetRole" "Role",
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRecipient" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamGroup_departmentId_name_key" ON "TeamGroup"("departmentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_groupId_normalizedName_key" ON "Channel"("groupId", "normalizedName");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "RiskDecision_memberId_createdAt_idx" ON "RiskDecision"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "SourceBatch_groupId_sourceDate_idx" ON "SourceBatch"("groupId", "sourceDate");

-- CreateIndex
CREATE UNIQUE INDEX "SourceBatch_groupId_channelId_sourceDate_key" ON "SourceBatch"("groupId", "channelId", "sourceDate");

-- CreateIndex
CREATE INDEX "MetricEvent_parentEventId_idx" ON "MetricEvent"("parentEventId");

-- CreateIndex
CREATE INDEX "MetricEvent_customerOrderId_idx" ON "MetricEvent"("customerOrderId");

-- CreateIndex
CREATE INDEX "MetricEvent_batchId_occurredOn_idx" ON "MetricEvent"("batchId", "occurredOn");

-- CreateIndex
CREATE INDEX "MetricEvent_enteredById_occurredOn_idx" ON "MetricEvent"("enteredById", "occurredOn");

-- CreateIndex
CREATE INDEX "MetricEvent_kind_occurredOn_idx" ON "MetricEvent"("kind", "occurredOn");

-- CreateIndex
CREATE UNIQUE INDEX "MetricEvent_customerOrderId_continuationNumber_key" ON "MetricEvent"("customerOrderId", "continuationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_phone_key" ON "CustomerOrder"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_leadId_key" ON "CustomerOrder"("leadId");

-- CreateIndex
CREATE INDEX "CustomerOrder_enteredById_openedOn_idx" ON "CustomerOrder"("enteredById", "openedOn");

-- CreateIndex
CREATE INDEX "CustomerOrder_batchId_idx" ON "CustomerOrder"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadCustomer_phone_key" ON "LeadCustomer"("phone");

-- CreateIndex
CREATE INDEX "LeadCustomer_ownerId_updatedAt_idx" ON "LeadCustomer"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "LeadCustomer_ownerId_receptionCategory_updatedAt_idx" ON "LeadCustomer"("ownerId", "receptionCategory", "updatedAt");

-- CreateIndex
CREATE INDEX "LeadCustomer_batchId_groupStatus_updatedAt_idx" ON "LeadCustomer"("batchId", "groupStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "LeadCustomer_batchId_invalid_groupStatus_expertIntroducedOn_idx" ON "LeadCustomer"("batchId", "invalid", "groupStatus", "expertIntroducedOn");

-- CreateIndex
CREATE INDEX "LeadCustomer_batchId_invalid_expertOwnerId_registeredOn_idx" ON "LeadCustomer"("batchId", "invalid", "expertOwnerId", "registeredOn");

-- CreateIndex
CREATE INDEX "LeadCustomer_deviceId_idx" ON "LeadCustomer"("deviceId");

-- CreateIndex
CREATE INDEX "LeadCustomer_expertOwnerId_updatedAt_idx" ON "LeadCustomer"("expertOwnerId", "updatedAt");

-- CreateIndex
CREATE INDEX "LeadCustomer_expertOwnerId_expertStalledOn_updatedAt_idx" ON "LeadCustomer"("expertOwnerId", "expertStalledOn", "updatedAt");

-- CreateIndex
CREATE INDEX "LeadCustomer_expertOwnerId_noInitialDepositOn_updatedAt_idx" ON "LeadCustomer"("expertOwnerId", "noInitialDepositOn", "updatedAt");

-- CreateIndex
CREATE INDEX "LeadCustomer_groupOperatorOwnerId_updatedAt_idx" ON "LeadCustomer"("groupOperatorOwnerId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GroupOperatorReception_receptionistId_key" ON "GroupOperatorReception"("receptionistId");

-- CreateIndex
CREATE INDEX "Device_memberId_active_idx" ON "Device"("memberId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Device_groupId_code_key" ON "Device"("groupId", "code");

-- CreateIndex
CREATE INDEX "DeviceAccount_ownerId_updatedAt_idx" ON "DeviceAccount"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "DeviceAccount_groupId_renewalDate_idx" ON "DeviceAccount"("groupId", "renewalDate");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAccount_groupId_accountNumber_key" ON "DeviceAccount"("groupId", "accountNumber");

-- CreateIndex
CREATE INDEX "LeadActivity_leadId_createdAt_idx" ON "LeadActivity"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadActivity_actorId_occurredOn_idx" ON "LeadActivity"("actorId", "occurredOn");

-- CreateIndex
CREATE INDEX "LeadException_actorId_occurredOn_idx" ON "LeadException"("actorId", "occurredOn");

-- CreateIndex
CREATE INDEX "LeadException_ownerId_occurredOn_idx" ON "LeadException"("ownerId", "occurredOn");

-- CreateIndex
CREATE INDEX "LeadException_batchId_idx" ON "LeadException"("batchId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "DailyEntryConfirmation_businessDate_idx" ON "DailyEntryConfirmation"("businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyEntryConfirmation_userId_businessDate_key" ON "DailyEntryConfirmation"("userId", "businessDate");

-- CreateIndex
CREATE INDEX "AttendanceRecord_groupId_businessDate_idx" ON "AttendanceRecord"("groupId", "businessDate");

-- CreateIndex
CREATE INDEX "AttendanceRecord_businessDate_idx" ON "AttendanceRecord"("businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_userId_businessDate_key" ON "AttendanceRecord"("userId", "businessDate");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_senderId_idx" ON "Notification"("senderId");

-- CreateIndex
CREATE INDEX "Notification_targetDepartmentId_idx" ON "Notification"("targetDepartmentId");

-- CreateIndex
CREATE INDEX "Notification_targetGroupId_idx" ON "Notification"("targetGroupId");

-- CreateIndex
CREATE INDEX "NotificationRecipient_userId_readAt_idx" ON "NotificationRecipient"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRecipient_notificationId_userId_key" ON "NotificationRecipient"("notificationId", "userId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamGroup" ADD CONSTRAINT "TeamGroup_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskDecision" ADD CONSTRAINT "RiskDecision_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskDecision" ADD CONSTRAINT "RiskDecision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceBatch" ADD CONSTRAINT "SourceBatch_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceBatch" ADD CONSTRAINT "SourceBatch_channelId_groupId_fkey" FOREIGN KEY ("channelId", "groupId") REFERENCES "Channel"("id", "groupId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricEvent" ADD CONSTRAINT "MetricEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SourceBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricEvent" ADD CONSTRAINT "MetricEvent_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricEvent" ADD CONSTRAINT "MetricEvent_parentEventId_fkey" FOREIGN KEY ("parentEventId") REFERENCES "MetricEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricEvent" ADD CONSTRAINT "MetricEvent_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "CustomerOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricEvent" ADD CONSTRAINT "MetricEvent_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SourceBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "LeadCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCustomer" ADD CONSTRAINT "LeadCustomer_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SourceBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCustomer" ADD CONSTRAINT "LeadCustomer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCustomer" ADD CONSTRAINT "LeadCustomer_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCustomer" ADD CONSTRAINT "LeadCustomer_expertOwnerId_fkey" FOREIGN KEY ("expertOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCustomer" ADD CONSTRAINT "LeadCustomer_groupOperatorOwnerId_fkey" FOREIGN KEY ("groupOperatorOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupOperatorReception" ADD CONSTRAINT "GroupOperatorReception_groupOperatorId_fkey" FOREIGN KEY ("groupOperatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupOperatorReception" ADD CONSTRAINT "GroupOperatorReception_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAccount" ADD CONSTRAINT "DeviceAccount_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAccount" ADD CONSTRAINT "DeviceAccount_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "LeadCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadException" ADD CONSTRAINT "LeadException_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SourceBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadException" ADD CONSTRAINT "LeadException_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "LeadCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadException" ADD CONSTRAINT "LeadException_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadException" ADD CONSTRAINT "LeadException_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyEntryConfirmation" ADD CONSTRAINT "DailyEntryConfirmation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
