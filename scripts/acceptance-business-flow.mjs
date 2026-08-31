import { PrismaClient } from "@prisma/client";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:3002";
const parsedBaseUrl = new URL(baseUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(parsedBaseUrl.hostname)) {
  throw new Error("验收脚本只允许访问本机服务，已拒绝非本地地址。");
}

const databasePath = resolve(process.cwd(), "prisma/dev.db");
const db = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
const outputPath = process.env.ACCEPTANCE_REPORT_PATH ?? "/tmp/data-statistics-business-acceptance.json";
const todayIso = new Date().toISOString();
const temporaryPassword = "E2eFlow@56790";
const password = "E2eFlowFinal@56790";
const prefix = "e2e_flow";
const report = {
  startedAt: todayIso,
  baseUrl,
  databasePath,
  steps: [],
  objects: {},
  accounts: [],
  expected: {},
  observed: {},
};

function record(name, status, details = {}) {
  report.steps.push({ name, status, details });
  const mark = status === "PASS" ? "PASS" : status === "SKIP" ? "SKIP" : "FAIL";
  console.log(`[${mark}] ${name}`);
}

function assert(condition, message, details = {}) {
  if (!condition) {
    record(message, "FAIL", details);
    throw new Error(message);
  }
}

async function request(path, { cookie, method = "GET", body, headers = {} } = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; }
  catch { payload = text; }
  const result = { status: response.status, payload };
  if (!response.ok) {
    const error = new Error(`${method} ${path} 失败（${response.status}）: ${text}`);
    error.result = result;
    throw error;
  }
  return { ...result, headers: response.headers };
}

async function login(username, accountPassword = password) {
  const octet = [...username].reduce((sum, character) => (sum + character.charCodeAt(0)) % 240, 0) + 10;
  const response = await request("/api/auth/login", {
    method: "POST",
    body: { username, password: accountPassword },
    headers: { "x-real-ip": `10.250.1.${octet}` },
  });
  const setCookie = response.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0];
  assert(cookie.includes("data-statistics-session="), `${username} 登录未返回会话 Cookie`, response.payload);
  return { cookie, response: { status: response.status, payload: response.payload } };
}

async function loginManaged(username) {
  let auth;
  try {
    auth = await login(username, password);
  } catch (error) {
    if (error?.result?.status !== 401) throw error;
    auth = await login(username, temporaryPassword);
  }
  if (!auth.response.payload.mustChangePassword) return auth;
  await request("/api/auth/change-password", {
    cookie: auth.cookie,
    method: "POST",
    body: { currentPassword: temporaryPassword, newPassword: password },
  });
  return login(username, password);
}

async function findUser(username) {
  return db.user.findUnique({ where: { username }, select: { id: true, username: true, name: true, role: true, duty: true, companyId: true, departmentId: true, groupId: true, active: true } });
}

async function ensureCompany(hqCookie) {
  const name = "E2E 验收公司";
  let company = await db.company.findUnique({ where: { name } });
  if (company) {
    record("总公司管理员创建公司", "SKIP", { reused: true, company });
    return company;
  }
  const response = await request("/api/org/companies", { cookie: hqCookie, method: "POST", body: { name } });
  company = response.payload;
  record("总公司管理员创建公司", "PASS", { request: { name }, response: { status: response.status, body: response.payload } });
  return company;
}

async function ensureCompanyManager(hqCookie, companyId) {
  const username = `${prefix}_company`;
  let manager = await findUser(username);
  if (manager) {
    record("总公司管理员创建公司管理员", "SKIP", { reused: true, manager });
    return manager;
  }
  const body = { companyId, username, name: "E2E 公司管理员", password: temporaryPassword };
  const response = await request("/api/org/company-managers", { cookie: hqCookie, method: "POST", body });
  manager = response.payload;
  record("总公司管理员创建公司管理员", "PASS", { request: { ...body, password: "<redacted>" }, response: { status: response.status, body: response.payload } });
  return manager;
}

async function ensureDepartment(companyCookie, companyId) {
  const name = "E2E 验收部门";
  let department = await db.department.findFirst({ where: { companyId, name } });
  if (department) {
    record("公司管理员创建部门", "SKIP", { reused: true, department });
    return department;
  }
  const body = { companyId, name, countryCode: "SG", timezone: "Asia/Singapore", workStartMinutes: 600, workEndMinutes: 1320 };
  const response = await request("/api/org/departments", { cookie: companyCookie, method: "POST", body });
  department = response.payload;
  record("公司管理员创建部门", "PASS", { request: body, response: { status: response.status, body: response.payload } });
  return department;
}

async function ensureDepartmentManager(companyCookie, departmentId) {
  const username = `${prefix}_department`;
  let manager = await findUser(username);
  if (manager) {
    record("公司管理员创建部门管理员", "SKIP", { reused: true, manager });
    return manager;
  }
  const body = { departmentId, username, name: "E2E 部门管理员", password: temporaryPassword };
  const response = await request("/api/org/department-managers", { cookie: companyCookie, method: "POST", body });
  manager = response.payload;
  record("公司管理员创建部门管理员", "PASS", { request: { ...body, password: "<redacted>" }, response: { status: response.status, body: response.payload } });
  return manager;
}

async function ensureResourceManager(adminCookie, channel, type) {
  const suffix = type.toLowerCase();
  const username = `${prefix}_resource_${suffix}`;
  let manager = await findUser(username);
  if (manager) {
    record(`系统管理员创建 ${type} 资源部账号`, "SKIP", { reused: true, manager, channel });
    return manager;
  }
  const body = {
    employeeCode: `E2ERES${type}`,
    username,
    name: `E2E ${type} 资源部`,
    password: temporaryPassword,
    role: "RESOURCE_MANAGER",
    resourceChannelIds: [channel.id],
  };
  const response = await request("/api/admin/users", { cookie: adminCookie, method: "POST", body });
  manager = response.payload;
  record(`系统管理员创建 ${type} 资源部账号`, "PASS", { request: { ...body, password: "<redacted>" }, response: { status: response.status, body: response.payload } });
  return manager;
}

async function ensureGroupAndLead(departmentCookie, departmentId, index, effectiveOn) {
  const name = `E2E 验收${index}组`;
  const username = `${prefix}_lead_${index}`;
  let group = await db.teamGroup.findFirst({ where: { departmentId, name } });
  let lead = await findUser(username);
  if (group && lead) {
    record(`部门管理员创建${index}组及组长`, "SKIP", { reused: true, group, lead });
    return { group, lead };
  }
  assert(!group && !lead, `${index}组处于半创建状态，请先清理 E2E 演示对象`, { group, lead });
  const body = {
    departmentId,
    name,
    leadAccount: { name: `E2E ${index}组组长`, username, password: temporaryPassword, effectiveOn },
  };
  const response = await request("/api/org/groups", { cookie: departmentCookie, method: "POST", body });
  group = response.payload.group;
  lead = response.payload.lead;
  record(`部门管理员创建${index}组及组长`, "PASS", { request: { ...body, leadAccount: { ...body.leadAccount, password: "<redacted>" } }, response: { status: response.status, body: response.payload } });
  return { group, lead };
}

async function ensureMembers(leadCookie, groupId, groupIndex) {
  const members = [];
  for (let index = 1; index <= 7; index += 1) {
    const username = `${prefix}_g${groupIndex}_m${index}`;
    let member = await findUser(username);
    if (!member) {
      const body = {
        username,
        name: `E2E ${groupIndex}组组员${index}`,
        password: temporaryPassword,
        role: "RECEPTION",
        secondaryRoles: ["GROUP_OPERATOR", "EXPERT"],
      };
      const response = await request("/api/lead/members", { cookie: leadCookie, method: "POST", body });
      member = response.payload;
      record(`${groupIndex}组创建组员${index}`, "PASS", { request: { ...body, password: "<redacted>" }, response: { status: response.status, body: response.payload } });
    } else {
      record(`${groupIndex}组创建组员${index}`, "SKIP", { reused: true, member });
    }
    assert(member.groupId === groupId, `${username} 必须归属正确小组`, { expectedGroupId: groupId, member });
    members.push(member);
  }
  return members;
}

const emptyValues = {
  dispatchCount: 0, duplicateCount: 0, lowAmountCount: 0, noWsCount: 0, manualInvalidCount: 0,
  replyCount: 0, joinCount: 0, operatorReceivedCount: 0, normalLeaveCount: 0, abnormalLeaveCount: 0,
  currentInGroupCount: 0, expertIntroCount: 0, expertReceivedCount: 0, expertContactedCount: 0,
  registrationCount: 0, orderCount: 0, cryptoInitialDepositCents: 0, bankInitialDepositCents: 0,
  cryptoRechargeCents: 0, bankRechargeCents: 0, withdrawalCents: 0,
};

function sameReceptionValues(entry, expected) {
  const value = entry.currentRevision;
  return value && ["dispatchCount", "duplicateCount", "lowAmountCount", "noWsCount", "manualInvalidCount", "replyCount", "joinCount"]
    .every((key) => value[key] === expected[key]);
}

async function fillMemberDaily(member, groupIndex, memberIndex) {
  const auth = await loginManaged(member.username);
  report.accounts.push({ username: member.username, password, id: member.id, role: member.role, groupId: member.groupId });
  const sheet = await request("/api/daily-stats", { cookie: auth.cookie });
  const ads = sheet.payload.channels.find((channel) => channel.channelType === "ADS");
  const sms = sheet.payload.channels.find((channel) => channel.channelType === "SMS");
  assert(ads && sms, `${member.username} 必须同时看到投流和短信两种渠道`, { channels: sheet.payload.channels });
  const chosenChannels = [ads, sms];
  const entries = [];
  for (let channelIndex = 0; channelIndex < chosenChannels.length; channelIndex += 1) {
    const channel = chosenChannels[channelIndex];
    const dispatchCount = 20 + groupIndex * 3 + memberIndex + channelIndex;
    const values = {
      ...emptyValues,
      dispatchCount,
      duplicateCount: 1,
      lowAmountCount: 1,
      noWsCount: 1,
      manualInvalidCount: 1,
      replyCount: 10 + channelIndex,
      joinCount: 8 + channelIndex,
    };
    const existing = sheet.payload.entries.find((entry) => entry.businessDate === sheet.payload.today
      && entry.position === "RECEPTION" && entry.channelId === channel.id);
    if (existing && ["APPROVED", "RESOURCE_PENDING"].includes(existing.status) && sameReceptionValues(existing, values)) {
      record(`${member.username} 填写 ${channel.name}`, "SKIP", { reused: true, entryId: existing.id, values });
      entries.push(existing);
      continue;
    }
    const body = {
      ...(existing ? { entryId: existing.id } : {}),
      businessDate: sheet.payload.today,
      position: "RECEPTION",
      channelId: channel.id,
      sourceReceptionId: null,
      sourceGroupOperatorId: null,
      ...(existing?.approvedRevisionId ? { changeReason: "E2E 重复验收校正" } : {}),
      values,
    };
    const response = await request("/api/daily-stats", { cookie: auth.cookie, method: "POST", body });
    record(`${member.username} 填写 ${channel.name}`, "PASS", { request: body, response: { status: response.status, body: response.payload } });
    entries.push(response.payload.entry);
  }
  return { businessDate: sheet.payload.today, channels: chosenChannels, entries };
}

function accumulateExpected(target, values) {
  target.added += values.dispatchCount;
  target.collision += values.duplicateCount;
  target.lowAmount += values.lowAmountCount;
  target.noWs += values.noWsCount;
  target.manualInvalid += values.manualInvalidCount;
  target.effective += values.dispatchCount - values.duplicateCount - values.lowAmountCount - values.noWsCount - values.manualInvalidCount;
  target.replied += values.replyCount;
  target.joined += values.joinCount;
}

function zeroExpected() {
  return { added: 0, collision: 0, lowAmount: 0, noWs: 0, manualInvalid: 0, effective: 0, replied: 0, joined: 0 };
}

function compareTotals(actual, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    assert(actual[key] === value, `${label}的 ${key} 汇总应为 ${value}，实际为 ${actual[key]}`, { actual, expected });
  }
}

async function approveResourceEntries(username, accountPassword, groupIds) {
  const auth = accountPassword === password ? await loginManaged(username) : await login(username, accountPassword);
  report.accounts.push({ username, password: accountPassword, role: "RESOURCE_MANAGER" });
  const pending = await request("/api/resource/daily-stats", { cookie: auth.cookie });
  const ours = pending.payload.entries.filter((entry) => groupIds.includes(entry.groupId));
  for (const entry of ours) {
    const response = await request("/api/resource/daily-stats", { cookie: auth.cookie, method: "PATCH", body: { entryId: entry.id, action: "APPROVE" } });
    record(`${username} 核对 ${entry.group.name}/${entry.owner.name}/${entry.channel.name}`, "PASS", { request: { entryId: entry.id, action: "APPROVE" }, response: { status: response.status, body: response.payload } });
  }
  const reporting = await request("/api/resource/reporting?range=today", { cookie: auth.cookie });
  return { auth, pendingCount: ours.length, reporting: reporting.payload };
}

async function main() {
  const hq = await login("demo_hq", "HqDemo@56790");
  report.accounts.push({ username: "demo_hq", password: "HqDemo@56790", role: "HQ_MANAGER" });
  record("总公司管理员登录", "PASS", hq.response);

  const company = await ensureCompany(hq.cookie);
  const companyManager = await ensureCompanyManager(hq.cookie, company.id);
  const companyAuth = await loginManaged(companyManager.username);
  record("公司管理员登录", "PASS", companyAuth.response);
  report.accounts.push({ username: companyManager.username, password, id: companyManager.id, role: "COMPANY_MANAGER", companyId: company.id });

  const department = await ensureDepartment(companyAuth.cookie, company.id);
  const departmentManager = await ensureDepartmentManager(companyAuth.cookie, department.id);
  const departmentAuth = await loginManaged(departmentManager.username);
  record("部门管理员登录", "PASS", departmentAuth.response);
  report.accounts.push({ username: departmentManager.username, password, id: departmentManager.id, role: "DEPARTMENT_MANAGER", departmentId: department.id });

  const departmentStructure = await request("/api/org/structure", { cookie: departmentAuth.cookie });
  const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const groups = [];
  for (let groupIndex = 1; groupIndex <= 2; groupIndex += 1) {
    const item = await ensureGroupAndLead(departmentAuth.cookie, department.id, groupIndex, localToday);
    const leadAuth = await loginManaged(item.lead.username);
    record(`${groupIndex}组组长登录`, "PASS", leadAuth.response);
    report.accounts.push({ username: item.lead.username, password, id: item.lead.id, role: "LEAD", groupId: item.group.id });
    const members = await ensureMembers(leadAuth.cookie, item.group.id, groupIndex);
    groups.push({ ...item, leadAuth, members });
  }
  assert(groups.length === 2 && groups.every((group) => group.members.length === 7), "必须有2个小组且每组恰好7名验收组员", { groups: groups.map((group) => ({ id: group.group.id, members: group.members.length })) });
  record("组织规模校验（2组×7组员）", "PASS");

  const channelCatalog = await db.channel.findMany({
    where: { groupId: groups[0].group.id, active: true },
    select: { id: true, name: true, channelType: true },
    orderBy: { name: "asc" },
  });
  const adsChannel = channelCatalog.find((channel) => channel.channelType === "ADS");
  const smsChannel = channelCatalog.find((channel) => channel.channelType === "SMS");
  assert(adsChannel && smsChannel, "验收小组必须同时有投流和短信渠道", { channelCatalog });
  const adminAuth = await login("demo_admin", "AdminDemo@56790");
  const adsResourceAccount = await ensureResourceManager(adminAuth.cookie, adsChannel, "ADS");
  const smsResourceAccount = await ensureResourceManager(adminAuth.cookie, smsChannel, "SMS");

  const expectedByGroup = new Map(groups.map((group) => [group.group.id, zeroExpected()]));
  const expectedByChannelType = new Map([["ADS", zeroExpected()], ["SMS", zeroExpected()]]);
  let businessDate = localToday;
  for (let groupIndex = 1; groupIndex <= groups.length; groupIndex += 1) {
    const group = groups[groupIndex - 1];
    for (let memberIndex = 1; memberIndex <= group.members.length; memberIndex += 1) {
      const filled = await fillMemberDaily(group.members[memberIndex - 1], groupIndex, memberIndex);
      businessDate = filled.businessDate;
      for (let channelIndex = 0; channelIndex < filled.channels.length; channelIndex += 1) {
        const dispatchCount = 20 + groupIndex * 3 + memberIndex + channelIndex;
        const values = { dispatchCount, duplicateCount: 1, lowAmountCount: 1, noWsCount: 1, manualInvalidCount: 1, replyCount: 10 + channelIndex, joinCount: 8 + channelIndex };
        accumulateExpected(expectedByGroup.get(group.group.id), values);
        accumulateExpected(expectedByChannelType.get(filled.channels[channelIndex].channelType), values);
      }
    }
  }
  const expectedAll = zeroExpected();
  for (const totals of expectedByGroup.values()) for (const key of Object.keys(expectedAll)) expectedAll[key] += totals[key];
  report.expected = {
    businessDate,
    company: expectedAll,
    department: expectedAll,
    groups: Object.fromEntries(expectedByGroup),
    resourceByType: Object.fromEntries(expectedByChannelType),
  };

  const groupIds = groups.map((group) => group.group.id);
  const adsResource = await approveResourceEntries(adsResourceAccount.username, password, groupIds);
  const smsResource = await approveResourceEntries(smsResourceAccount.username, password, groupIds);
  const [approvedAds, approvedSms] = await Promise.all([
    db.dailyStatEntry.count({ where: { groupId: { in: groupIds }, businessDate, position: "RECEPTION", channelId: adsChannel.id, approvedRevisionId: { not: null } } }),
    db.dailyStatEntry.count({ where: { groupId: { in: groupIds }, businessDate, position: "RECEPTION", channelId: smsChannel.id, approvedRevisionId: { not: null } } }),
  ]);
  assert(approvedAds === 14, "投流资源部核对后应有14条正式数据", { approvedAds });
  assert(approvedSms === 14, "短信资源部核对后应有14条正式数据", { approvedSms });
  record("资源部分渠道核对28条当日数据", "PASS", { newlyApprovedAds: adsResource.pendingCount, newlyApprovedSms: smsResource.pendingCount, approvedAds, approvedSms });

  for (const [label, auth] of [["总公司", hq], ["公司", companyAuth], ["部门", departmentAuth]]) {
    const response = await request(`/api/org/reporting?range=custom&sourceDateFrom=${businessDate}&sourceDateTo=${businessDate}`, { cookie: auth.cookie });
    const selected = response.payload.groups.filter((row) => groupIds.includes(row.id));
    assert(selected.length === 2, `${label}汇总应同时看到两个验收小组`, { groups: selected.map((row) => row.id) });
    for (const row of selected) compareTotals(row.totals, expectedByGroup.get(row.id), `${label}/${row.name}`);
    report.observed[label] = selected.map((row) => ({ id: row.id, name: row.name, totals: row.totals, rates: row.rates }));
    record(`${label}汇总与两组组员填写一致`, "PASS");
  }

  for (const group of groups) {
    const response = await request(`/api/org/reporting?range=custom&sourceDateFrom=${businessDate}&sourceDateTo=${businessDate}`, { cookie: group.leadAuth.cookie });
    assert(response.payload.groups.length === 1 && response.payload.groups[0].id === group.group.id, `${group.group.name}组长只能看到自己小组`, { groups: response.payload.groups });
    compareTotals(response.payload.groups[0].totals, expectedByGroup.get(group.group.id), `${group.group.name}组长`);
    record(`${group.group.name}组长汇总与7名组员填写一致`, "PASS");
  }

  for (const [type, resource] of [["ADS", adsResource], ["SMS", smsResource]]) {
    const selectedRows = resource.reporting.rows.filter((row) => groupIds.includes(row.group.id));
    assert(selectedRows.length === 2, `${type} 资源部应看到两个小组的渠道汇总`, { rows: selectedRows });
    const actual = zeroExpected();
    for (const row of selectedRows) for (const key of Object.keys(actual)) actual[key] += row.totals[key];
    compareTotals(actual, expectedByChannelType.get(type), `${type} 资源部`);
    report.observed[`resource-${type}`] = selectedRows;
    record(`${type} 资源部每日小组数据与组员填写一致`, "PASS");
  }

  report.objects = {
    company: { id: company.id, name: company.name },
    department: { id: department.id, name: department.name },
    groups: groups.map((group) => ({ id: group.group.id, name: group.group.name, leadId: group.lead.id, memberIds: group.members.map((member) => member.id) })),
  };
  report.structureSnapshot = departmentStructure.payload;
  report.finishedAt = new Date().toISOString();
  report.result = "PASS";
}

try {
  await main();
} catch (error) {
  report.finishedAt = new Date().toISOString();
  report.result = "FAIL";
  report.error = { message: error instanceof Error ? error.message : String(error), result: error?.result ?? null };
  process.exitCode = 1;
} finally {
  await db.$disconnect();
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`验收报告: ${outputPath}`);
  console.log(`最终结果: ${report.result}`);
}
