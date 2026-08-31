import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const BUSINESS_DATE = "2026-08-27";
const CONFIRMED = process.env.CONFIRM_2026_08_27_HISTORY_REPAIR === "YES";
const REASON = "按 Google 历史数据核对表修复（2026-08-27）";

const rows = [
  // WD-名将小组
  ["WD-名将小组", "QX001", "FB-M", 97, 6, 56, 0, 35, 25, 18, 0, 2, 20, 13, 5, 2, 1256, 0, 0],
  ["WD-名将小组", "QX001", "FB-Q", 88, 7, 34, 0, 47, 30, 18, 0, 2, 20, 13, 8, 6, 56740, 0, 0],
  ["WD-名将小组", "GJ001", "FB-M", 264, 46, 144, 0, 74, 66, 21, 14, 6, 41, 31, 12, 1, 1147, 0, 0],
  ["WD-名将小组", "GJ001", "FB-Q", 203, 22, 103, 0, 78, 59, 21, 10, 3, 34, 22, 6, 1, 1129, 0, 0],
  ["WD-名将小组", "BY001", "FB-M", 92, 1, 31, 0, 60, 39, 14, 15, 4, 33, 32, 14, 3, 77704, 0, 0],
  ["WD-名将小组", "BY001", "FB-Q", 47, 5, 4, 0, 38, 30, 8, 14, 2, 24, 23, 7, 1, 1400, 0, 0],
  ["WD-名将小组", "YK001", "FB-M", 49, 1, 26, 0, 22, 18, 9, 0, 3, 12, 9, 4, 3, 8985, 0, 0],
  ["WD-名将小组", "YK001", "FB-Q", 8, 0, 0, 0, 8, 7, 6, 0, 0, 6, 6, 6, 6, 5261, 0, 0],
  // WD-黑八小组
  ["WD-黑八小组", "LKS001", "FB-M", 79, 19, 0, 0, 60, 43, 8, 11, 4, 23, 20, 7, 2, 1812, 0, 0],
  ["WD-黑八小组", "LKS001", "FB-Q", 105, 16, 0, 3, 86, 73, 15, 18, 4, 37, 34, 20, 4, 3206, 0, 0],
  ["WD-黑八小组", "XJ003", "FB-M", 76, 9, 0, 1, 66, 45, 5, 7, 3, 15, 11, 8, 5, 10346, 0, 0],
  ["WD-黑八小组", "XJ003", "FB-Q", 125, 20, 0, 0, 105, 56, 11, 8, 10, 29, 20, 12, 4, 12390, 0, 0],
  ["WD-黑八小组", "XJ002", "FB-M", 98, 22, 0, 0, 76, 66, 21, 15, 2, 38, 33, 11, 4, 3849, 0, 0],
  ["WD-黑八小组", "XJ002", "FB-Q", 28, 2, 0, 0, 26, 19, 0, 11, 0, 11, 11, 6, 3, 7954, 0, 0],
  ["WD-黑八小组", "NN004", "FB-M", 105, 12, 0, 2, 91, 65, 11, 7, 5, 23, 21, 9, 3, 2396, 0, 0],
  ["WD-黑八小组", "NN004", "FB-Q", 27, 3, 0, 0, 24, 15, 0, 13, 1, 14, 14, 5, 3, 4297, 0, 0],
].map(([groupName, employeeCode, channelName, dispatch, noWs, lowAmount, duplicate, effective, reply, currentInGroup, normalLeave, abnormalLeave, join, expertIntro, registration, order, cryptoDeposit, bankDeposit, withdrawal]) => ({
  groupName, employeeCode, channelName, dispatch, noWs, lowAmount, duplicate, effective, reply,
  currentInGroup, normalLeave, abnormalLeave, join, expertIntro, registration, order,
  cryptoDepositCents: cryptoDeposit * 100, bankDepositCents: bankDeposit * 100,
  withdrawalCents: withdrawal * 100,
}));

function emptyValues() {
  return {
    dispatchCount: 0, duplicateCount: 0, lowAmountCount: 0, noWsCount: 0, effectiveCount: 0,
    replyCount: 0, joinCount: 0, operatorReceivedCount: 0, normalLeaveCount: 0,
    abnormalLeaveCount: 0, currentInGroupCount: 0, expertIntroCount: 0,
    expertReceivedCount: 0, expertContactedCount: 0, registrationCount: 0, orderCount: 0,
    cryptoInitialDepositCents: 0, bankInitialDepositCents: 0, cryptoRechargeCents: 0,
    bankRechargeCents: 0, withdrawalCents: 0,
  };
}

function valuesFor(row, position) {
  const values = emptyValues();
  if (position === "RECEPTION") Object.assign(values, {
    dispatchCount: row.dispatch, duplicateCount: row.duplicate, lowAmountCount: row.lowAmount,
    noWsCount: row.noWs, effectiveCount: row.effective, replyCount: row.reply, joinCount: row.join,
  });
  if (position === "GROUP_OPERATOR") Object.assign(values, {
    operatorReceivedCount: row.join, normalLeaveCount: row.normalLeave,
    abnormalLeaveCount: row.abnormalLeave, currentInGroupCount: row.currentInGroup,
    expertIntroCount: row.expertIntro,
  });
  if (position === "EXPERT") Object.assign(values, {
    expertReceivedCount: row.expertIntro, registrationCount: row.registration, orderCount: row.order,
    cryptoRechargeCents: row.cryptoDepositCents, bankRechargeCents: row.bankDepositCents,
    withdrawalCents: row.withdrawalCents,
  });
  return values;
}

function summarize(sourceRows) {
  const result = new Map();
  for (const row of sourceRows) {
    const total = result.get(row.groupName) ?? {
      dispatch: 0, duplicate: 0, lowAmount: 0, noWs: 0, effective: 0, reply: 0, join: 0,
      currentInGroup: 0, normalLeave: 0, abnormalLeave: 0, expertIntro: 0,
      registration: 0, order: 0, depositCents: 0, withdrawalCents: 0,
    };
    for (const key of ["dispatch", "duplicate", "lowAmount", "noWs", "effective", "reply", "join", "currentInGroup", "normalLeave", "abnormalLeave", "expertIntro", "registration", "order"]) total[key] += row[key];
    total.depositCents += row.cryptoDepositCents + row.bankDepositCents;
    total.withdrawalCents += row.withdrawalCents;
    result.set(row.groupName, total);
  }
  return Object.fromEntries(result);
}

async function resolveTargets(client) {
  const resolved = [];
  for (const row of rows) {
    if (row.dispatch - row.duplicate - row.lowAmount - row.noWs !== row.effective)
      throw new Error(`表格公式不平：${row.groupName}/${row.employeeCode}/${row.channelName}`);
    const group = await client.teamGroup.findFirst({ where: { name: row.groupName }, select: { id: true } });
    if (!group) throw new Error(`找不到小组：${row.groupName}`);
    const owner = await client.user.findFirst({ where: { employeeCode: row.employeeCode, groupId: group.id }, select: { id: true, name: true } });
    if (!owner) throw new Error(`找不到员工：${row.groupName}/${row.employeeCode}`);
    const channel = await client.channel.findFirst({ where: { groupId: group.id, name: row.channelName }, select: { id: true } });
    if (!channel) throw new Error(`找不到渠道：${row.groupName}/${row.channelName}`);
    const entries = await client.dailyStatEntry.findMany({
      where: { ownerId: owner.id, groupId: group.id, channelId: channel.id, businessDate: BUSINESS_DATE, id: { startsWith: "legacy-metric-v1" } },
      include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
    });
    for (const position of ["RECEPTION", "GROUP_OPERATOR", "EXPERT"]) {
      const matches = entries.filter((entry) => entry.position === position);
      if (matches.length !== 1) throw new Error(`历史记录数量异常：${row.groupName}/${owner.name}/${row.channelName}/${position}=${matches.length}`);
    }
    resolved.push({ ...row, groupId: group.id, ownerId: owner.id, ownerName: owner.name, channelId: channel.id, entries });
  }
  return resolved;
}

async function main() {
  const resolved = await resolveTargets(db);
  const groupIds = [...new Set(resolved.map((row) => row.groupId))];
  const transitionRows = await db.dailyStatEntry.findMany({
    where: { groupId: { in: groupIds }, businessDate: BUSINESS_DATE, id: { startsWith: "transition-customer-v1" } },
    include: { currentRevision: true },
  });
  const preview = { mode: CONFIRMED ? "WRITE" : "PREVIEW", businessDate: BUSINESS_DATE, sourceRows: rows.length, revisionsToCreate: rows.length * 3, transitionDuplicatesToRemove: transitionRows.length, expected: summarize(rows) };
  console.log(JSON.stringify(preview, null, 2));
  if (!CONFIRMED) return;

  await db.$transaction(async (tx) => {
    for (const row of resolved) {
      for (const position of ["RECEPTION", "GROUP_OPERATOR", "EXPERT"]) {
        const entry = row.entries.find((item) => item.position === position);
        const nextVersion = (entry.revisions[0]?.version ?? 0) + 1;
        const revision = await tx.dailyStatRevision.create({ data: {
          entryId: entry.id, version: nextVersion, createdById: row.ownerId, changeReason: REASON,
          ...valuesFor(row, position),
        } });
        await tx.dailyStatEntry.update({ where: { id: entry.id }, data: {
          currentRevisionId: revision.id, approvedRevisionId: revision.id, status: "APPROVED",
          submittedAt: new Date(), reviewedAt: new Date(), reviewReason: null,
          ...(position === "GROUP_OPERATOR" ? { sourceReceptionId: row.ownerId } : {}),
          ...(position === "EXPERT" ? { sourceReceptionId: row.ownerId, sourceGroupOperatorId: row.ownerId } : {}),
        } });
      }
    }
    for (const entry of transitionRows) {
      await tx.auditLog.create({ data: {
        actorId: entry.ownerId, action: "REMOVE_DUPLICATE_TRANSITION_DAILY_STAT", entityType: "DailyStatEntry", entityId: entry.id,
        summary: JSON.stringify({ reason: REASON, businessDate: entry.businessDate, groupId: entry.groupId, channelId: entry.channelId, position: entry.position, previousRevision: entry.currentRevision }),
      } });
      await tx.dailyStatEntry.delete({ where: { id: entry.id } });
    }
  }, { timeout: 120_000 });

  console.log(JSON.stringify({ ok: true, repairedRows: rows.length, newRevisions: rows.length * 3, removedTransitionDuplicates: transitionRows.length }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => db.$disconnect());
