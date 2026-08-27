import { AuthorizationError, requireRole } from "../../../lib/auth";
import { db } from "../../../lib/db";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { resolveEmployeeStage } from "../../../lib/employee-stage";
import { getRiskSettings, getSystemSettings } from "../../../lib/settings";
import { AdminSectionNav, type AdminSection } from "../../../components/admin/AdminSectionNav";
import { MemberManager } from "../../../components/admin/MemberManager";
import { GroupManager } from "../../../components/admin/GroupManager";
import { ChannelManager } from "../../../components/admin/ChannelManager";
import { AuditLogTable } from "../../../components/admin/AuditLogTable";
import { SystemSettingsForm } from "../../../components/admin/SystemSettingsForm";
import { RiskSettingsForm } from "../../../components/admin/RiskSettingsForm";
import { DepartmentManager } from "../../../components/admin/DepartmentManager";
import { businessWorkStatus, resolveGroupBusinessTime } from "../../../lib/business-time";
import { collapseGlobalChannelCopies } from "../../../lib/global-channels";
import { recordSecurityEvent } from "../../../lib/security-events";

const sections = new Set<AdminSection>(["members", "departments", "groups", "channels", "risk", "audit", "settings"]);

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  try { await requireRole("ADMIN"); } catch (error) {
    if (error instanceof AuthorizationError) {
      recordSecurityEvent({ event: "AUTHORIZATION_DENIED", userId: error.actor?.id ?? null, teamId: error.actor?.groupId ?? null, result: "denied" });
      return <main className="min-h-screen bg-slate-50 p-8"><div className="mx-auto max-w-3xl bg-white p-8"><h1 className="text-2xl font-bold">无权访问</h1><p className="mt-2 text-slate-600">只有管理员可以进入管理员中心。</p></div></main>;
    }
    throw error;
  }
  const requested = (await searchParams).section as AdminSection | undefined; const section = requested && sections.has(requested) ? requested : "members";
  const [departmentsRaw, groupsRaw, membersRaw, channelsRaw, logsRaw, settings, riskSettings] = await Promise.all([
    db.department.findMany({ include: { _count: { select: { groups: true, managers: true } } }, orderBy: { createdAt: "asc" } }),
    db.teamGroup.findMany({ include: { department: { select: { id: true, name: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true } }, _count: { select: { members: true, channels: true } } }, orderBy: [{ department: { name: "asc" } }, { createdAt: "asc" }] }),
    db.user.findMany({ select: { id: true, employeeCode: true, username: true, name: true, role: true, roleAssignments: { select: { role: true }, orderBy: { role: "asc" } }, resourceChannelAccess: { select: { channelId: true }, orderBy: { channelId: "asc" } }, membershipHistory: { select: { id: true, groupId: true, role: true, secondaryRoles: true, effectiveFrom: true, effectiveTo: true, reason: true, group: { select: { name: true } } }, orderBy: { effectiveFrom: "desc" } }, groupId: true, departmentId: true, managementScopeName: true, managementCountryCode: true, active: true, hireDate: true, recruitmentSource: true, referrerName: true, stageOverride: true, stageOverrideReason: true, stageOverrideAt: true, lastLoginAt: true, department: { select: { id: true, name: true, active: true } }, group: { select: { id: true, name: true, active: true, department: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } }),
    db.channel.findMany({ include: { group: { select: { id: true, name: true, active: true, department: { select: { id: true, name: true } } } }, createdBy: { select: { name: true } }, _count: { select: { batches: true } } }, orderBy: { createdAt: "desc" } }),
    db.auditLog.findMany({ include: { actor: { select: { id: true, name: true, username: true } } }, orderBy: { createdAt: "desc" }, take: 300 }),
    getSystemSettings(),
    getRiskSettings(),
  ]);
  const departments = departmentsRaw.map(({ _count, ...department }) => ({ ...department, ...businessWorkStatus(department), groupCount: _count.groups, managerCount: _count.managers }));
  const groups = groupsRaw.map(({ _count, department, ...group }) => {
    const businessTime = resolveGroupBusinessTime({ ...group, department });
    return { ...group, departmentName: department.name, inheritedTimezone: group.timezone === null, effectiveCountryCode: businessTime.countryCode, effectiveTimezone: businessTime.timezone, effectiveWorkStartMinutes: businessTime.workStartMinutes, effectiveWorkEndMinutes: businessTime.workEndMinutes, ...businessWorkStatus(businessTime), memberCount: _count.members, channelCount: _count.channels };
  });
  const businessDate = localDateYYYYMMDD(new Date(), settings.timezone);
  const members = membersRaw.map((member) => {
    const resolved = resolveEmployeeStage({ onDate: businessDate, hireDate: member.hireDate, override: member.stageOverride, trainingDays: riskSettings.trainingDays, observationDays: riskSettings.observationDays });
    return { ...member, stage: resolved.stage, employmentDay: resolved.employmentDay, stageSource: resolved.source, stageOverrideAt: member.stageOverrideAt?.toISOString() ?? null, lastLoginAt: member.lastLoginAt?.toISOString() ?? null };
  });
  const channels = collapseGlobalChannelCopies(channelsRaw).map(({ row, groupCount, batchCount }) => {
    const { createdBy, _count: _count, createdAt, ...channel } = row;
    const companyPrices = Array.from(new Map(channelsRaw.filter((item) => item.id === row.id).map((item) => [item.group.department.id, {
      departmentId: item.group.department.id,
      departmentName: item.group.department.name,
      effectiveFanPriceCents: item.effectiveFanPriceCents,
      rebateRateBps: item.rebateRateBps,
    }])).values());
    return { ...channel, creator: createdBy, createdAt: createdAt.toISOString(), batchCount, groupCount, companyPrices };
  });
  const resourceChannels = channels.map((channel) => ({ id: channel.id, name: channel.name, active: channel.active, channelType: channel.channelType }));
  const logs = logsRaw.map((log) => ({ ...log, createdAt: log.createdAt.toISOString() }));
  const actors = Array.from(new Map(logs.map((log) => [log.actor.id, log.actor])).values()); const actions = Array.from(new Set(logs.map((log) => log.action)));

  return <main className="min-h-screen bg-slate-50 text-slate-900"><div className="lg:flex"><AdminSectionNav active={section} /><div className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{section === "members" && <MemberManager members={members} groups={groups} departments={departments} resourceChannels={resourceChannels} stageContext={{ businessDate, trainingDays: riskSettings.trainingDays, observationDays: riskSettings.observationDays }} />}{section === "departments" && <DepartmentManager departments={departments} />}{section === "groups" && <GroupManager groups={groups} departments={departments} />}{section === "channels" && <ChannelManager channels={channels} groups={groups} />}{section === "risk" && <RiskSettingsForm settings={riskSettings} />}{section === "audit" && <AuditLogTable initialLogs={logs} actors={actors} actions={actions} timezone={settings.timezone} />}{section === "settings" && <SystemSettingsForm settings={settings} />}</div></div></main>;
}
