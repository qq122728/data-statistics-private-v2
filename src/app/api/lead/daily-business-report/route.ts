import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { businessTimezoneOption, resolveGroupBusinessTime } from "../../../../lib/business-time-config";
import { db } from "../../../../lib/db";
import {
  buildGroupDailyBusinessReport,
  buildGroupDailyReportPng,
  formatGroupDailyBusinessReport,
  type GroupDailyReportPersonnel,
} from "../../../../lib/group-daily-report";
import { buildLeadChannelReportWorkbook, type LeadChannelReportPayload } from "../../../../lib/lead-channel-report-xlsx";
import { getAssignedRoles, hasAssignedRole } from "../../../../lib/role-access";
import {
  sendBossTelegramDocument,
  sendBossTelegramMessage,
  TelegramMessageRejectedError,
} from "../../../../lib/boss-report/telegram";
import { authorizationDenied } from "../../../../lib/security-events";
import { hasValidDailyJobSecret } from "../../../../lib/internal-job-auth";
import { GET as loadChannelReporting } from "../channel-reporting/route";

export const runtime = "nodejs";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function previousDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

async function loadReport(request: Request, from: string, to: string, groupId?: string) {
  const url = new URL("/api/lead/channel-reporting", request.url);
  url.searchParams.set("range", "custom");
  url.searchParams.set("sourceDateFrom", from);
  url.searchParams.set("sourceDateTo", to);
  if (groupId) url.searchParams.set("groupId", groupId);
  const response = await loadChannelReporting(new Request(url, { headers: request.headers }));
  if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error ?? "日报数据读取失败");
  return response.json() as Promise<LeadChannelReportPayload>;
}

async function prepareReport(request: Request, date: string, automatedGroupId?: string) {
  const actor = automatedGroupId ? null : await requireUser();
  if (!automatedGroupId && (!actor?.active || !actor.groupId || !hasAssignedRole(actor, "LEAD"))) throw new AuthenticationError("只有在职组长可以生成本组日报");
  const groupId = automatedGroupId ?? actor!.groupId!;
  const group = await db.teamGroup.findFirst({
    where: { id: groupId, active: true },
    select: {
      id: true, name: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true,
      department: { select: { name: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true } },
      members: {
        where: { active: true },
        select: { name: true, role: true, active: true, roleAssignments: { select: { role: true } } },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!group) throw new Error("当前账号没有可生成日报的小组");
  const [dailyPayload, monthPayload, yesterdayPayload] = await Promise.all([
    loadReport(request, date, date, automatedGroupId),
    loadReport(request, `${date.slice(0, 7)}-01`, date, automatedGroupId),
    loadReport(request, previousDate(date), previousDate(date), automatedGroupId),
  ]);
  const roles = group.members.map((member) => ({ member, roles: getAssignedRoles(member) }));
  const uniqueNames = (names: string[]) => [...new Set(names)];
  const namesWith = (role: "LEAD" | "EXPERT" | "GROUP_OPERATOR") => uniqueNames(roles.filter((row) => row.roles.includes(role)).map((row) => row.member.name));
  const leadNames = namesWith("LEAD");
  const personnel: GroupDailyReportPersonnel = {
    frontDesk: uniqueNames(group.members.map((member) => member.name)),
    experts: namesWith("EXPERT"),
    leads: leadNames,
    customerService: leadNames,
    operators: namesWith("GROUP_OPERATOR"),
  };
  const businessTime = resolveGroupBusinessTime(group);
  const report = buildGroupDailyBusinessReport({
    dailyPayload,
    monthPayload,
    yesterdayPayload,
    departmentName: group.department.name,
    countryName: businessTimezoneOption(businessTime.timezone).countryLabel,
    personnel,
  });
  return { actor, group, report, dailyPayload, monthPayload, text: formatGroupDailyBusinessReport(report) };
}

function dateFrom(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!datePattern.test(date)) throw new Error("请选择正确的日报日期");
  return date;
}

export async function GET(request: Request) {
  try {
    const date = dateFrom(request);
    const prepared = await prepareReport(request, date);
    const format = new URL(request.url).searchParams.get("format") ?? "json";
    if (format === "png") {
      const bytes = await buildGroupDailyReportPng(prepared.report);
      return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "image/png", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${prepared.group.name}-业务日报-${date}.png`)}`, "Cache-Control": "private, no-store" } });
    }
    if (format === "xlsx") {
      const workbook = await buildLeadChannelReportWorkbook(prepared.monthPayload, { dailyReport: prepared.report });
      const bytes = await workbook.xlsx.writeBuffer();
      return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${prepared.group.name}-业务报表-${date.slice(0, 7)}.xlsx`)}`, "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ report: prepared.report, text: prepared.text }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message || "请先登录" }, { status: 401 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "日报生成失败" }, { status: 400 });
  }
}

type Claim = { key: string; value: string };
async function claimPart(key: string, fingerprint: string): Promise<Claim | null> {
  const value = JSON.stringify({ status: "sending", fingerprint, claimedAt: new Date().toISOString() });
  try {
    await db.systemSetting.create({ data: { key, value, updatedById: null } });
    return { key, value };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const existing = await db.systemSetting.findUnique({ where: { key } });
    const state = existing ? JSON.parse(existing.value) as { status?: string } : null;
    if (state?.status === "sent") return null;
    throw new Error("这份日报可能正在发送，请先到 Telegram 检查，避免重复推送");
  }
}

async function sendPart(key: string, content: Buffer | string, sender: () => Promise<void>) {
  const fingerprint = createHash("sha256").update(content).digest("hex");
  const claim = await claimPart(key, fingerprint);
  if (!claim) return false;
  try {
    await sender();
    await db.systemSetting.updateMany({ where: { key: claim.key, value: claim.value }, data: { value: JSON.stringify({ status: "sent", fingerprint, sentAt: new Date().toISOString() }), updatedById: null } });
    return true;
  } catch (error) {
    if (error instanceof TelegramMessageRejectedError) await db.systemSetting.deleteMany({ where: { key: claim.key, value: claim.value } });
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { date?: string; groupId?: string };
    const internal = hasValidDailyJobSecret(request);
    if (body.groupId && !internal) return NextResponse.json({ error: "自动推送任务密钥不正确" }, { status: 401 });
    if (!internal) {
      const actor = await requireUser();
      if (!actor.active || !actor.groupId || !hasAssignedRole(actor, "LEAD")) return authorizationDenied(actor, "只有在职组长可以推送本组日报");
    }
    const date = body.date ?? "";
    if (!datePattern.test(date)) return NextResponse.json({ error: "请选择正确的日报日期" }, { status: 400 });
    const url = new URL(request.url);
    url.searchParams.set("date", date);
    const prepared = await prepareReport(new Request(url, { headers: request.headers }), date, internal ? body.groupId : undefined);
    const workbook = await buildLeadChannelReportWorkbook(prepared.monthPayload, { dailyReport: prepared.report });
    const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
    const prefix = `groupDaily:${prepared.group.id}:${date}`;
    const sent = [] as string[];
    if (await sendPart(`${prefix}:text`, prepared.text, () => sendBossTelegramMessage(prepared.text))) sent.push("文字");
    if (await sendPart(`${prefix}:excel`, xlsx, () => sendBossTelegramDocument(xlsx, `${prepared.group.name}-业务报表-${date.slice(0, 7)}.xlsx`, `${prepared.group.name} ${date.slice(0, 7)} 月详细报表`))) sent.push("Excel");
    return NextResponse.json({ ok: true, sent, message: sent.length ? `已推送${sent.join("、")}` : "该日报已经推送过，没有重复发送" });
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "日报推送失败" }, { status: 500 });
  }
}
