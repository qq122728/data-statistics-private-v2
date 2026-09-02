import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { resolveGroupBusinessTime } from "../../../../lib/business-time";
import { statisticsDate } from "../../../../lib/statistics-date";
import { sumLatestCurrentInGroup } from "../../../../lib/daily-stat-snapshots";
import { db } from "../../../../lib/db";
import { resolveDateRangeWithDefault } from "../../../../lib/lead-date-range";
import { calculateConversionRates, emptyBatchTotals } from "../../../../lib/metrics";
import { hasAssignedRole } from "../../../../lib/role-access";
import { hasOversizedQueryValue } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { dailyStatAttributionOwner, dailyStatAttributionOwnerId } from "../../../../lib/daily-stat-attribution";
import { hasValidDailyJobSecret } from "../../../../lib/internal-job-auth";
import { revisionForNumberTracking, usesCustomerNumberTracking } from "../../../../lib/customer-number-tracking";

const allowedRanges = new Set(["all", "today", "yesterday", "7d", "week", "30d", "month", "lastMonth", "custom"]);

/** 组长新版工作台的真实渠道汇总及逐日明细。员工保存的最新版立即进入正式汇总。 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params))
    return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  const internalGroupId = hasValidDailyJobSecret(request) ? params.get("groupId") : null;
  let actor = null;
  if (!internalGroupId) {
    try {
      actor = await requireUser();
    } catch (error) {
      if (error instanceof AuthenticationError)
        return NextResponse.json({ error: "请先登录" }, { status: 401 });
      throw error;
    }
    if (!actor.active || !actor.groupId || !hasAssignedRole(actor, "LEAD"))
      return authorizationDenied(actor!, "只有在职组长可以查看本组渠道数据");
  }
  const targetGroupId = internalGroupId ?? actor!.groupId!;

  const group = await db.teamGroup.findFirst({
    where: { id: targetGroupId, active: true },
    select: {
      id: true, name: true, groupType: true, countryCode: true, timezone: true,
      workStartMinutes: true, workEndMinutes: true,
      department: { select: { countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true } },
    },
  });
  if (!group) return actor
    ? authorizationDenied(actor, "当前账号没有可查看的小组")
    : NextResponse.json({ error: "自动日报小组不存在或已停用" }, { status: 404 });
  const groupType = group.groupType;

  const today = statisticsDate();
  const rawRange = params.get("range") ?? undefined;
  const range = resolveDateRangeWithDefault({
    range: rawRange && allowedRanges.has(rawRange) ? rawRange : undefined,
    sourceDateFrom: params.get("sourceDateFrom") ?? undefined,
    sourceDateTo: params.get("sourceDateTo") ?? undefined,
  }, today, "month");
  const [entries, snapshotEntries] = await Promise.all([
    db.dailyStatEntry.findMany({
      where: { groupId: group.id, businessDate: { gte: range.from, lte: range.to }, currentRevisionId: { not: null } },
      select: {
        groupId: true, channelId: true, ownerId: true, sourceReceptionId: true,
        businessDate: true, position: true,
        owner: { select: { id: true, name: true } },
        sourceReception: { select: { id: true, name: true } },
        channel: { select: { id: true, name: true, normalizedName: true } },
        status: true,
        currentRevision: true,
        approvedRevision: true,
      },
    }),
    db.dailyStatEntry.findMany({
      where: {
        groupId: group.id, position: { in: ["RECEPTION", "GROUP_OPERATOR"] },
        businessDate: { lte: range.to }, currentRevisionId: { not: null },
      },
      select: {
        groupId: true, channelId: true, ownerId: true, sourceReceptionId: true,
        businessDate: true, position: true,
        owner: { select: { id: true, name: true } },
        sourceReception: { select: { id: true, name: true } },
        channel: { select: { id: true, name: true, normalizedName: true } },
        status: true,
        currentRevision: true,
        approvedRevision: true,
      },
    }),
  ]);
  type Row = { channel: (typeof entries)[number]["channel"]; owner?: { id: string; name: string }; businessDate?: string; totals: ReturnType<typeof emptyBatchTotals>; lowAmount: number; noWs: number; manualInvalid: number; initialDepositCents: number; rechargeCents: number; inGroup: number; snapshotDate: string; lawyerRealCase?: number; lawyerAdded?: number; lawyerExpertAdded?: number; customerServicePush?: number; cryptoDepositCents?: number; bankDepositCents?: number };
  const byChannel = new Map<string, Row>();
  const byChannelMember = new Map<string, Row>();
  const byMember = new Map<string, Row>();
  const byDayChannel = new Map<string, Row>();
  const byDayChannelMember = new Map<string, Row>();
  for (const entry of snapshotEntries) {
    if (!byChannel.has(entry.channel.id)) byChannel.set(entry.channel.id, {
      channel: entry.channel, totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, manualInvalid: 0, initialDepositCents: 0, rechargeCents: 0, inGroup: 0, snapshotDate: "",
    });
    const attributionOwner = dailyStatAttributionOwner(entry);
    const memberKey = `${entry.channel.id}:${attributionOwner.id}`;
    if (!byChannelMember.has(memberKey)) byChannelMember.set(memberKey, {
      channel: entry.channel, owner: attributionOwner,
      totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, manualInvalid: 0, initialDepositCents: 0, rechargeCents: 0, inGroup: 0, snapshotDate: "",
    });
    // “当前在群”是截至查询结束日的存量快照。即使成员在本次区间内没有新增填写，
    // 个人汇总也必须保留这位成员，否则按人员查看会比按渠道查看少人、少存量。
    if (!byMember.has(attributionOwner.id)) byMember.set(attributionOwner.id, {
      channel: { id: "all", name: "全部渠道", normalizedName: "all" }, owner: attributionOwner,
      totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, manualInvalid: 0, initialDepositCents: 0, rechargeCents: 0, inGroup: 0, snapshotDate: "",
    });
  }
  function accumulate(row: Row, entry: (typeof entries)[number]) {
    const rawValue = entry.currentRevision ?? entry.approvedRevision;
    const value = rawValue ? revisionForNumberTracking(rawValue, {
      businessDate: entry.businessDate,
      position: entry.position,
      groupType,
    }) : null;
    if (!value) return;
    row.totals.newFans += value.dispatchCount;
    row.totals.duplicateFans += value.duplicateCount;
    row.totals.effectiveFans += value.effectiveCount;
    row.totals.noNumber += value.noWsCount;
    row.totals.replies += value.replyCount;
    row.totals.groupJoin += value.joinCount;
    // 2026-09-02 起，黑客组进群数由号码进群事件写入炒群账。
    // 汇总时必须读取 operatorReceivedCount，再通过 sourceReceptionId 归回接粉人。
    if (groupType === "HACKER" && entry.position === "GROUP_OPERATOR" && usesCustomerNumberTracking(entry.businessDate)) {
      row.totals.groupJoin += value.operatorReceivedCount;
    }
    row.totals.groupLeave += value.normalLeaveCount + value.abnormalLeaveCount;
    row.totals.abnormalGroupLeave = (row.totals.abnormalGroupLeave ?? 0) + value.abnormalLeaveCount;
    row.totals.expertIntro += value.expertIntroCount;
    row.totals.registration += value.registrationCount;
    row.totals.orders += value.orderCount;
    row.totals.rechargeCents += value.cryptoInitialDepositCents + value.bankInitialDepositCents + value.cryptoRechargeCents + value.bankRechargeCents;
    row.totals.withdrawalCents += value.withdrawalCents;
    row.lowAmount += value.lowAmountCount;
    row.noWs += value.noWsCount;
    row.manualInvalid += value.manualInvalidCount;
    row.lawyerRealCase = (row.lawyerRealCase ?? 0) + value.lawyerRealCaseCount;
    row.lawyerAdded = (row.lawyerAdded ?? 0) + value.lawyerAddedCount;
    row.lawyerExpertAdded = (row.lawyerExpertAdded ?? 0) + value.lawyerExpertAddedCount;
    row.customerServicePush = (row.customerServicePush ?? 0) + value.customerServicePushCount;
    row.cryptoDepositCents = (row.cryptoDepositCents ?? 0) + value.cryptoInitialDepositCents + value.cryptoRechargeCents;
    row.bankDepositCents = (row.bankDepositCents ?? 0) + value.bankInitialDepositCents + value.bankRechargeCents;
    row.initialDepositCents += value.cryptoInitialDepositCents + value.bankInitialDepositCents;
    row.rechargeCents += value.cryptoRechargeCents + value.bankRechargeCents;
    if (entry.position === "RECEPTION" || entry.position === "GROUP_OPERATOR") {
      if (entry.businessDate > row.snapshotDate) { row.snapshotDate = entry.businessDate; row.inGroup = value.currentInGroupCount; }
      else if (entry.businessDate === row.snapshotDate) row.inGroup += value.currentInGroupCount;
    }
  }
  for (const entry of entries) {
    const value = entry.currentRevision ?? entry.approvedRevision;
    if (!value) continue;
    const row = byChannel.get(entry.channel.id) ?? { channel: entry.channel, totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, manualInvalid: 0, initialDepositCents: 0, rechargeCents: 0, inGroup: 0, snapshotDate: "" };
    accumulate(row, entry);
    byChannel.set(entry.channel.id, row);
    const attributionOwner = dailyStatAttributionOwner(entry);
    const memberKey = `${entry.channel.id}:${attributionOwner.id}`;
    const memberRow = byChannelMember.get(memberKey) ?? { channel: entry.channel, owner: attributionOwner, totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, manualInvalid: 0, initialDepositCents: 0, rechargeCents: 0, inGroup: 0, snapshotDate: "" };
    accumulate(memberRow, entry);
    byChannelMember.set(memberKey, memberRow);
    const allChannelMemberRow = byMember.get(attributionOwner.id) ?? { channel: { id: "all", name: "全部渠道", normalizedName: "all" }, owner: attributionOwner, totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, manualInvalid: 0, initialDepositCents: 0, rechargeCents: 0, inGroup: 0, snapshotDate: "" };
    accumulate(allChannelMemberRow, entry);
    byMember.set(attributionOwner.id, allChannelMemberRow);
    const dayChannelKey = `${entry.businessDate}:${entry.channel.id}`;
    const dayChannelRow = byDayChannel.get(dayChannelKey) ?? { channel: entry.channel, businessDate: entry.businessDate, totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, manualInvalid: 0, initialDepositCents: 0, rechargeCents: 0, inGroup: 0, snapshotDate: "" };
    accumulate(dayChannelRow, entry);
    byDayChannel.set(dayChannelKey, dayChannelRow);
    const dayMemberKey = `${dayChannelKey}:${attributionOwner.id}`;
    const dayMemberRow = byDayChannelMember.get(dayMemberKey) ?? { channel: entry.channel, owner: attributionOwner, businessDate: entry.businessDate, totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, manualInvalid: 0, initialDepositCents: 0, rechargeCents: 0, inGroup: 0, snapshotDate: "" };
    accumulate(dayMemberRow, entry);
    byDayChannelMember.set(dayMemberKey, dayMemberRow);
  }
  function serialize(row: Row) { return {
    normalizedName: row.channel.normalizedName,
    name: row.channel.name,
    totals: {
      added: row.totals.newFans,
      collision: row.totals.duplicateFans,
      lowAmount: row.lowAmount,
      noWs: row.noWs,
      manualInvalid: row.manualInvalid,
      lawyerRealCase: row.lawyerRealCase ?? 0,
      lawyerAdded: row.lawyerAdded ?? 0,
      lawyerExpertAdded: row.lawyerExpertAdded ?? 0,
      customerServicePush: row.customerServicePush ?? 0,
      effective: row.totals.effectiveFans,
      replied: row.totals.replies,
      joined: row.totals.groupJoin,
      left: row.totals.groupLeave,
      leftAbnormal: row.totals.abnormalGroupLeave ?? 0,
      inGroup: row.inGroup,
      pushed: row.totals.expertIntro,
      registered: row.totals.registration,
      ordered: row.totals.orders,
      depositCents: row.totals.rechargeCents,
      initialDepositCents: row.initialDepositCents,
      rechargeCents: row.rechargeCents,
      withdrawalCents: row.totals.withdrawalCents,
      netCents: row.totals.rechargeCents - row.totals.withdrawalCents,
      cryptoDepositCents: row.cryptoDepositCents ?? 0,
      bankDepositCents: row.bankDepositCents ?? 0,
    },
    rates: calculateConversionRates(row.totals),
    derivedRates: {
      effectiveRate: row.totals.newFans > 0 && row.totals.effectiveFans > 0 ? row.totals.effectiveFans / row.totals.newFans : null,
      replyRate: row.totals.effectiveFans > 0 ? row.totals.replies / row.totals.effectiveFans : null,
      joinRate: row.totals.effectiveFans > 0 ? row.totals.groupJoin / row.totals.effectiveFans : null,
      registrationRate: row.totals.expertIntro ? row.totals.registration / row.totals.expertIntro : null,
      orderRate: row.totals.registration ? row.totals.orders / row.totals.registration : null,
      abnormalLeaveRate: row.totals.groupJoin - Math.max(0, row.totals.groupLeave - (row.totals.abnormalGroupLeave ?? 0)) > 0
        ? (row.totals.abnormalGroupLeave ?? 0) / (row.totals.groupJoin - Math.max(0, row.totals.groupLeave - (row.totals.abnormalGroupLeave ?? 0)))
        : null,
      lawyerReplyRate: row.totals.newFans ? row.totals.replies / row.totals.newFans : null,
      lawyerAddedRate: row.totals.newFans ? (row.lawyerAdded ?? 0) / row.totals.newFans : null,
      lawyerExpertAddedRate: row.totals.newFans ? (row.lawyerExpertAdded ?? 0) / row.totals.newFans : null,
    },
  }; }
  const rows = [...byChannel.values()].map((row) => {
    row.inGroup = sumLatestCurrentInGroup(snapshotEntries.filter((entry) => entry.channelId === row.channel.id));
    return {
      ...serialize(row),
      members: [...byChannelMember.values()].filter((member) => member.channel.id === row.channel.id).map((member) => {
        member.inGroup = sumLatestCurrentInGroup(snapshotEntries.filter((entry) =>
          entry.channelId === row.channel.id && dailyStatAttributionOwnerId(entry) === member.owner!.id));
        return { ...serialize(member), id: member.owner!.id, name: member.owner!.name };
      }).sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    };
  }).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  const days = [...new Set(entries.map((entry) => entry.businessDate))].sort().reverse().map((date) => {
    const daySummarySource = { channel: { id: `day-${date}`, name: date, normalizedName: date }, businessDate: date, totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, manualInvalid: 0, initialDepositCents: 0, rechargeCents: 0, inGroup: 0, snapshotDate: "" } satisfies Row;
    for (const entry of entries) if (entry.businessDate === date) accumulate(daySummarySource, entry);
    return {
    date,
    summary: serialize(daySummarySource),
    rows: [...byDayChannel.values()].filter((row) => row.businessDate === date).map((row) => ({
      ...serialize(row),
      members: [...byDayChannelMember.values()]
        .filter((member) => member.businessDate === date && member.channel.id === row.channel.id)
        .map((member) => ({ ...serialize(member), id: member.owner!.id, name: member.owner!.name }))
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    })).sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
  }; });

  const members = [...byMember.values()].map((member) => {
    member.inGroup = sumLatestCurrentInGroup(snapshotEntries.filter((entry) => dailyStatAttributionOwnerId(entry) === member.owner!.id));
    return {
      ...serialize(member), id: member.owner!.id, name: member.owner!.name,
      channels: [...byChannelMember.values()].filter((row) => row.owner!.id === member.owner!.id).map((row) => ({ ...serialize(row), id: row.channel.id })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  const summarySource = { channel: { id: "all", name: "全组", normalizedName: "all" }, totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, manualInvalid: 0, initialDepositCents: 0, rechargeCents: 0, inGroup: 0, snapshotDate: "" } satisfies Row;
  for (const entry of entries) accumulate(summarySource, entry);
  summarySource.inGroup = rows.reduce((sum, row) => sum + row.totals.inGroup, 0);
  const summary = serialize(summarySource);

  const analysis: Array<{ tone: "good" | "warn" | "info"; title: string; detail: string }> = [];
  const comparableChannels = rows.filter((row) => row.totals.effective >= 5);
  const channelByOrderRate = [...comparableChannels].sort((a, b) => (b.derivedRates.orderRate ?? 0) - (a.derivedRates.orderRate ?? 0));
  const bestOrderChannel = channelByOrderRate[0];
  if (bestOrderChannel?.totals.ordered) analysis.push({ tone: "good", title: `${bestOrderChannel.name} 开单效率最高`, detail: `有效数据 ${bestOrderChannel.totals.effective}，开单 ${bestOrderChannel.totals.ordered}，开单率 ${((bestOrderChannel.derivedRates.orderRate ?? 0) * 100).toFixed(1)}%。` });
  if (bestOrderChannel && channelByOrderRate.length > 1) {
    const last = channelByOrderRate.at(-1)!;
    const rateGap = (bestOrderChannel.derivedRates.orderRate ?? 0) - (last.derivedRates.orderRate ?? 0);
    // 所有渠道都是 0 或几乎持平时，不制造一个并不存在的“最差渠道”。
    if (rateGap >= 0.01) analysis.push({ tone: "warn", title: `${last.name} 开单效率需要关注`, detail: `有效数据 ${last.totals.effective}，开单 ${last.totals.ordered}，开单率 ${((last.derivedRates.orderRate ?? 0) * 100).toFixed(1)}%。建议检查客户质量与跟进节奏。` });
  }
  const bestNet = [...rows].sort((a, b) => b.totals.netCents - a.totals.netCents)[0];
  if (bestNet && bestNet.totals.netCents > 0) analysis.push({
    tone: "info",
    title: `${bestNet.name} 贡献净业绩最多`,
    detail: summary.totals.netCents > 0
      ? `净业绩 $${(bestNet.totals.netCents / 100).toLocaleString("zh-CN")}，占全组 ${((bestNet.totals.netCents / summary.totals.netCents) * 100).toFixed(1)}%。`
      : `净业绩 $${(bestNet.totals.netCents / 100).toLocaleString("zh-CN")}；全组净业绩仍未转正，请同时核对其它渠道出金。`,
  });
  // 进群和开单按当天实际发生登记，可能来自以前接粉或注册的存量客户。
  // 因此不能用当天有效数或注册数判断数据异常，否则会把正常回访进度误报为错误。
  const groupOrderRate = summary.derivedRates.orderRate ?? 0;
  if (groupOrderRate > 0) for (const member of members.filter((row) => row.totals.effective >= 10 && (row.derivedRates.orderRate ?? 0) + 0.02 < groupOrderRate).slice(0, 3)) analysis.push({ tone: "warn", title: `${member.name} 低于小组平均开单率`, detail: `个人开单率 ${((member.derivedRates.orderRate ?? 0) * 100).toFixed(1)}%，小组平均 ${((groupOrderRate) * 100).toFixed(1)}%；可展开个人渠道明细定位差距。` });

  return NextResponse.json({
    group: { id: group.id, name: group.name, groupType: group.groupType, timezone: resolveGroupBusinessTime(group).timezone },
    range: { preset: range.preset, label: range.label, today, from: range.from, to: range.to },
    summary,
    rows,
    members,
    analysis,
    days,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
