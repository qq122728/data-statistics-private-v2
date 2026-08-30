import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import {
  DailyStatError,
  dailyStatEntryInclude,
  publicDailyStat,
  saveDailyStat,
  transitionDailyStat,
} from "../../../lib/daily-stats";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { db } from "../../../lib/db";
import { getAssignedRoles } from "../../../lib/role-access";
import { authorizationDenied, type SecurityEventActor } from "../../../lib/security-events";

const transitionSchema = z.object({
  entryId: z.string().trim().min(1),
  action: z.enum(["SUBMIT", "WITHDRAW"]),
});

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
    if (!actor.groupId) return authorizationDenied(actor, "当前账号未分配小组");
    const url = new URL(request.url);
    const from = url.searchParams.get("from")?.trim();
    const to = url.searchParams.get("to")?.trim();
    const entries = await db.dailyStatEntry.findMany({
      where: {
        ownerId: actor.id,
        ...(from || to ? { businessDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      include: dailyStatEntryInclude,
      orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    const [channels, members, pairingRows, timezone] = await Promise.all([
      db.channel.findMany({
        where: { groupId: actor.groupId, active: true },
        select: { id: true, name: true, channelType: true },
        orderBy: { name: "asc" },
      }),
      db.user.findMany({
        where: {
          OR: [
            { groupId: actor.groupId },
            { positionHistory: { some: { groupId: actor.groupId } } },
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
            where: { groupId: actor.groupId },
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
                { groupId: actor.groupId },
                { positionHistory: { some: { groupId: actor.groupId } } },
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
                { groupId: actor.groupId },
                { positionHistory: { some: { groupId: actor.groupId } } },
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
    return NextResponse.json({
      actorId: actor.id,
      today: localDateYYYYMMDD(new Date(), timezone),
      timezone,
      positions: getAssignedRoles(actor).filter((role) => ["RECEPTION", "GROUP_OPERATOR", "EXPERT"].includes(role)),
      channels,
      members: members.map((member) => ({
        id: member.id,
        name: member.name,
        active: member.active,
        current: member.active && member.groupId === actor.groupId,
        roles: [...new Set([
          member.role,
          ...member.roleAssignments.map((item) => item.role),
          ...member.positionHistory.flatMap((item) => [item.position, ...(item.secondaryPositions?.split(",").filter(Boolean) ?? [])]),
        ])].filter((role) => ["RECEPTION", "GROUP_OPERATOR", "EXPERT"].includes(role)),
      })),
      sourceReceptionPairings,
      entries: entries.map(publicDailyStat),
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

export async function PATCH(request: Request) {
  let securityActor: SecurityEventActor | undefined;
  try {
    const sessionUser = await requireUser();
    securityActor = sessionUser;
    const input = transitionSchema.parse(await request.json());
    const entry = await db.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: sessionUser.id },
        select: { id: true, active: true, role: true, groupId: true, roleAssignments: { select: { role: true } } },
      });
      if (!actor) throw new DailyStatError("账号不存在", 401);
      return transitionDailyStat(tx, actor, input);
    }, { isolationLevel: "Serializable" });
    return NextResponse.json({ entry: publicDailyStat(entry) });
  } catch (error) {
    return errorResponse(error, securityActor);
  }
}
