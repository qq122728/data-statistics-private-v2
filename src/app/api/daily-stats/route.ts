import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import {
  DailyStatError,
  dailyStatEntryInclude,
  isUnifiedDailyStatIdentity,
  publicDailyStat,
  saveDailyStat,
} from "../../../lib/daily-stats";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { db } from "../../../lib/db";
import { statisticsDateContext } from "../../../lib/statistics-date";
import { frontlineMemberRoles, isFrontlineGroupMember } from "../../../lib/role-access";
import { authorizationDenied, type SecurityEventActor } from "../../../lib/security-events";

function errorResponse(error: unknown, actor?: SecurityEventActor) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (error instanceof DailyStatError) {
    if (error.status === 403) {
      if (!actor) throw error;
      return authorizationDenied(actor, error.message);
    }
    if (error.status === 401) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error.status === 404) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error.status === 409) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || "请检查填写内容", issues: error.issues }, { status: 400 });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
  throw error;
}

export async function GET(request: Request) {
  let securityActor: SecurityEventActor | undefined;
  try {
    const actor = await requireUser();
    securityActor = actor;
    if (!isFrontlineGroupMember(actor)) return authorizationDenied(actor, "只有在职组员可以查看和填写自己的数据");
    const groupId = actor.groupId!;
    const group = await db.teamGroup.findUnique({ where: { id: groupId }, select: { groupType: true } });
    if (!group) return authorizationDenied(actor, "当前账号没有可用小组");
    const url = new URL(request.url);
    const from = url.searchParams.get("from")?.trim();
    const to = url.searchParams.get("to")?.trim();
    const attributionEntries = await db.dailyStatEntry.findMany({
      where: {
        OR: [{ ownerId: actor.id }, { sourceReceptionId: actor.id }],
        ...(from || to ? { businessDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      include: dailyStatEntryInclude,
      orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    const entries = attributionEntries.filter((entry) => entry.ownerId === actor.id);
    const [channels, members, pairingRows, timezone] = await Promise.all([
      db.channel.findMany({
        where: { groupId, active: true },
        select: { id: true, name: true, channelType: true },
        orderBy: { name: "asc" },
      }),
      db.user.findMany({
        where: {
          OR: [
            { groupId },
            { positionHistory: { some: { groupId } } },
          ],
        },
        select: {
          id: true,
          name: true,
          active: true,
          groupId: true,
          role: true,
          roleAssignments: { select: { role: true } },
          positionHistory: {
            where: { groupId },
            select: { position: true, secondaryPositions: true, effectiveFrom: true, effectiveTo: true },
          },
        },
        orderBy: [{ active: "desc" }, { name: "asc" }],
      }),
      Promise.all([
        db.groupOperatorReceptionHistory.findMany({
          where: {
            groupOperatorId: actor.id,
            receptionist: {
              OR: [
                { groupId },
                { positionHistory: { some: { groupId } } },
              ],
            },
          },
          select: { receptionistId: true, effectiveFrom: true, effectiveTo: true },
          orderBy: { effectiveFrom: "asc" },
        }),
        db.groupOperatorReception.findMany({
          where: {
            groupOperatorId: actor.id,
            receptionist: {
              OR: [
                { groupId },
                { positionHistory: { some: { groupId } } },
              ],
            },
          },
          select: { receptionistId: true, createdAt: true },
        }),
      ]),
      resolveUserBusinessTimezone(actor, "Asia/Shanghai"),
    ]);
    const [pairingHistory, currentPairings] = pairingRows;
    const pairingHistoryKeys = new Set(pairingHistory
      .filter((pairing) => pairing.effectiveTo === null)
      .map((pairing) => pairing.receptionistId));
    const sourceReceptionPairings = [
      ...pairingHistory.map((pairing) => ({
        receptionistId: pairing.receptionistId,
        effectiveFrom: localDateYYYYMMDD(pairing.effectiveFrom, timezone),
        effectiveTo: pairing.effectiveTo ? localDateYYYYMMDD(pairing.effectiveTo, timezone) : null,
      })),
      // 兼容只有当前配对、尚未补出历史行的旧数据。
      ...currentPairings
        .filter((pairing) => !pairingHistoryKeys.has(pairing.receptionistId))
        .map((pairing) => ({
          receptionistId: pairing.receptionistId,
          effectiveFrom: localDateYYYYMMDD(pairing.createdAt, timezone),
          effectiveTo: null,
        })),
    ];
    const numberFields = [
      "dispatchCount", "duplicateCount", "lowAmountCount", "noWsCount", "manualInvalidCount",
      "lawyerRealCaseCount", "lawyerAddedCount", "lawyerExpertAddedCount", "customerServicePushCount", "effectiveCount",
      "replyCount", "joinCount", "operatorReceivedCount", "normalLeaveCount", "abnormalLeaveCount", "currentInGroupCount",
      "expertIntroCount", "expertReceivedCount", "expertContactedCount", "registrationCount", "orderCount",
      "cryptoInitialDepositCents", "bankInitialDepositCents", "cryptoRechargeCents", "bankRechargeCents", "withdrawalCents",
    ] as const;
    type RevisionValues = Record<(typeof numberFields)[number], number>;
    const emptyValues = () => Object.fromEntries(numberFields.map((field) => [field, 0])) as RevisionValues;
    const unifiedByScope = new Map<string, typeof attributionEntries>();
    for (const entry of attributionEntries) {
      const attributionOwnerId = entry.sourceReceptionId ?? entry.ownerId;
      if (attributionOwnerId !== actor.id) continue;
      const key = `${entry.businessDate}\0${entry.channelId}`;
      const rows = unifiedByScope.get(key) ?? [];
      rows.push(entry);
      unifiedByScope.set(key, rows);
    }
    const unifiedEntries = [...unifiedByScope.values()].map((rows) => {
      const primary = rows.find((entry) => entry.position === "RECEPTION" && isUnifiedDailyStatIdentity(entry.identityKey))
        ?? rows.find((entry) => entry.position === "RECEPTION" && entry.ownerId === actor.id)
        ?? null;
      const primaryRevision = primary?.currentRevision ?? primary?.approvedRevision ?? null;
      const activeCompanions = rows.filter((entry) =>
        entry.position !== "RECEPTION"
        && entry.status !== "RETURNED"
        && Boolean(entry.currentRevision ?? entry.approvedRevision),
      );
      const companionTotals = {
        normalLeaveCount: 0,
        abnormalLeaveCount: 0,
        currentInGroupCount: 0,
        expertIntroCount: 0,
        expertContactedCount: 0,
        registrationCount: 0,
        orderCount: 0,
        cryptoInitialDepositCents: 0,
        bankInitialDepositCents: 0,
        cryptoRechargeCents: 0,
        bankRechargeCents: 0,
        withdrawalCents: 0,
      };
      for (const companion of activeCompanions) {
        const revision = companion.currentRevision ?? companion.approvedRevision;
        if (!revision) continue;
        if (companion.position === "GROUP_OPERATOR") {
          for (const field of ["normalLeaveCount", "abnormalLeaveCount", "currentInGroupCount", "expertIntroCount"] as const)
            companionTotals[field] += revision[field];
        } else {
          for (const field of ["expertContactedCount", "registrationCount", "orderCount", "cryptoInitialDepositCents", "bankInitialDepositCents", "cryptoRechargeCents", "bankRechargeCents", "withdrawalCents"] as const)
            companionTotals[field] += revision[field];
        }
      }
      const primaryCoversCompanions = primaryRevision
        ? activeCompanions.length === 0
          || Boolean(primaryRevision.changeReason)
          || Object.entries(companionTotals).every(([field, value]) =>
              primaryRevision[field as keyof typeof companionTotals] === value,
            )
        : false;
      const values = emptyValues();
      if (primary && isUnifiedDailyStatIdentity(primary.identityKey) && primaryRevision && primaryCoversCompanions) {
        for (const field of numberFields) values[field] = primaryRevision[field];
      } else {
        const receptionRows = rows.filter((entry) => entry.position === "RECEPTION");
        const operatorRows = activeCompanions.filter((entry) => entry.position === "GROUP_OPERATOR");
        const expertRows = activeCompanions.filter((entry) => entry.position === "EXPERT");
        for (const entry of receptionRows) {
          const revision = entry.currentRevision ?? entry.approvedRevision;
          if (!revision) continue;
          for (const field of numberFields)
            values[field] += revision[field];
        }
        // 仍有旧岗位行时，由旧岗位行提供其负责的字段，不能再叠加新版接粉行中的同名值。
        if (operatorRows.length) {
          for (const field of ["operatorReceivedCount", "normalLeaveCount", "abnormalLeaveCount", "currentInGroupCount", "expertIntroCount"] as const)
            values[field] = 0;
        }
        for (const entry of operatorRows) {
          const revision = entry.currentRevision ?? entry.approvedRevision;
          if (!revision) continue;
          values.operatorReceivedCount += revision.operatorReceivedCount;
          values.normalLeaveCount += revision.normalLeaveCount;
          values.abnormalLeaveCount += revision.abnormalLeaveCount;
          values.currentInGroupCount += revision.currentInGroupCount;
          values.expertIntroCount += revision.expertIntroCount;
        }
        // 旧接粉行如果没有进群数，才用旧炒群“接手”数补齐，防止同一批客户算两次。
        if (values.joinCount === 0) values.joinCount = values.operatorReceivedCount;
        if (expertRows.length) {
          for (const field of ["expertReceivedCount", "expertContactedCount", "registrationCount", "orderCount", "cryptoInitialDepositCents", "bankInitialDepositCents", "cryptoRechargeCents", "bankRechargeCents", "withdrawalCents"] as const)
            values[field] = 0;
        }
        for (const entry of expertRows) {
          const revision = entry.currentRevision ?? entry.approvedRevision;
          if (!revision) continue;
          for (const field of ["expertReceivedCount", "expertContactedCount", "registrationCount", "orderCount", "cryptoInitialDepositCents", "bankInitialDepositCents", "cryptoRechargeCents", "bankRechargeCents", "withdrawalCents"] as const)
            values[field] += revision[field];
        }
      }
      const first = rows[0];
      return {
        entryId: primary?.id ?? null,
        businessDate: first.businessDate,
        channel: first.channel,
        status: primary?.status ?? "LEGACY_MERGED",
        values,
      };
    }).sort((left, right) => right.businessDate.localeCompare(left.businessDate) || left.channel.name.localeCompare(right.channel.name, "zh-CN"));
    const dateContext = statisticsDateContext();
    return NextResponse.json({
      actorId: actor.id,
      groupType: group.groupType,
      today: dateContext.today,
      timezone: dateContext.timezone,
      rolloverHour: dateContext.rolloverHour,
      rolloverLabel: dateContext.rolloverLabel,
      // 旧前端仍需要这三个存储分类；对所有组员都返回，不再绑定账号岗位。
      positions: ["RECEPTION", "GROUP_OPERATOR", "EXPERT"],
      channels,
      members: members.map((member) => ({
        id: member.id,
        name: member.name,
        active: member.active,
        current: member.active && member.groupId === groupId,
        roles: frontlineMemberRoles.includes(member.role as (typeof frontlineMemberRoles)[number])
          ? ["RECEPTION", "GROUP_OPERATOR", "EXPERT"]
          : [],
      })),
      sourceReceptionPairings,
      entries: entries.map(publicDailyStat),
      // 新组员页面使用这个单行视图；entries 继续保留给旧页面和历史审计。
      unifiedEntries,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error, securityActor);
  }
}

export async function POST(request: Request) {
  let securityActor: SecurityEventActor | undefined;
  try {
    const sessionUser = await requireUser();
    securityActor = sessionUser;
    const body = await request.json();
    const entry = await db.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: sessionUser.id },
        select: { id: true, active: true, role: true, groupId: true, roleAssignments: { select: { role: true } } },
      });
      if (!actor) throw new DailyStatError("账号不存在", 401);
      return saveDailyStat(tx, actor, body);
    }, { isolationLevel: "Serializable" });
    return NextResponse.json({ entry: publicDailyStat(entry) }, { status: 201 });
  } catch (error) {
    return errorResponse(error, securityActor);
  }
}
