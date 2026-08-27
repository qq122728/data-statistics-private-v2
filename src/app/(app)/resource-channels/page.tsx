import { redirect } from "next/navigation";
import { ChannelManager } from "../../../components/admin/ChannelManager";
import { AuthenticationError, AuthorizationError, requireRole } from "../../../lib/auth";
import { db } from "../../../lib/db";
import { collapseGlobalChannelCopies } from "../../../lib/global-channels";
import { recordSecurityEvent } from "../../../lib/security-events";

export default async function ResourceChannelsPage() {
  let user;
  try {
    user = await requireRole("RESOURCE_MANAGER", "COMPANY_MANAGER");
  } catch (error) {
    if (error instanceof AuthenticationError) redirect("/login?next=/resource-channels");
    if (error instanceof AuthorizationError) {
      recordSecurityEvent({ event: "AUTHORIZATION_DENIED", userId: error.actor?.id ?? null, teamId: error.actor?.groupId ?? null, result: "denied" });
      redirect("/dashboard");
    }
    throw error;
  }

  const companyMode = user.role === "COMPANY_MANAGER";
  if (companyMode && user.managementCountryCode) {
    recordSecurityEvent({ event: "AUTHORIZATION_DENIED", userId: user.id, teamId: user.groupId, result: "denied" });
    redirect("/dashboard");
  }
  const allowedChannelIds = user.resourceChannelAccess?.map((access) => access.channelId) ?? [];
  if (companyMode && !user.departmentId) {
    recordSecurityEvent({ event: "AUTHORIZATION_DENIED", userId: user.id, teamId: user.groupId, result: "denied" });
    redirect("/dashboard");
  }
  const companyScope = companyMode ? { departmentId: user.departmentId as string } : {};
  const [groupsRaw, channelsRaw] = await Promise.all([
    db.teamGroup.findMany({
      where: companyScope,
      include: { department: { select: { name: true } }, _count: { select: { members: true, channels: true } } },
      orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
    }),
    db.channel.findMany({
      where: companyMode ? { group: { departmentId: user.departmentId as string } } : { id: { in: allowedChannelIds } },
      include: { group: { select: { id: true, name: true, active: true, department: { select: { id: true, name: true } } } }, createdBy: { select: { name: true } }, _count: { select: { batches: true } } },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  const groups = groupsRaw.map(({ _count, department, ...group }) => ({ ...group, departmentName: department.name, memberCount: _count.members, channelCount: _count.channels }));
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

  return <main className="page-shell space-y-3">
    <div className="page-heading"><div><h1 className="page-title">渠道与结算规则</h1><p className="page-description">{companyMode ? "你可以管理本公司的渠道、启用状态和粉单价；其他公司的渠道不会显示，也不能修改。" : "渠道分为短信粉、投流粉和底料返点；同一渠道可按公司分别定价。投流批次由组长先填写一次广告费，多位接粉员共同导入后，系统按全部有效新增数和广告费 × 115% 自动核算统一成本。"}</p></div></div>
    <section className="panel p-4"><ChannelManager channels={channels} groups={groups} resourceMode={!companyMode} companyMode={companyMode} /></section>
  </main>;
}
