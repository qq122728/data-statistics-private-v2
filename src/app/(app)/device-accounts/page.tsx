import { redirect } from "next/navigation";
import {
  DeviceAccountManager,
  type DeviceAccountRow,
} from "../../../components/device-accounts/DeviceAccountManager";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { db } from "../../../lib/db";

export default async function DeviceAccountsPage() {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      redirect("/login?next=/device-accounts");
    throw error;
  }
  const isAdmin = user.role === "ADMIN";
  if (!isAdmin && !user.groupId) redirect("/dashboard");

  const canManageGroup = user.role === "LEAD";
  const [accounts, owners] = await Promise.all([
    db.deviceAccount.findMany({
      where: isAdmin ? {} : {
        groupId: user.groupId!,
        ...(canManageGroup ? {} : { ownerId: user.id }),
      },
      include: {
        group: { select: { name: true } },
        owner: { select: { id: true, name: true, role: true } },
      },
      orderBy: [
        { renewalDate: { sort: "asc", nulls: "last" } },
        { updatedAt: "desc" },
      ],
    }),
    isAdmin
      ? db.user.findMany({
          where: { active: true, role: { in: ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] } },
          select: { id: true, name: true, role: true },
          orderBy: [{ groupId: "asc" }, { role: "asc" }, { name: "asc" }],
        })
      : canManageGroup
      ? db.user.findMany({
          where: {
            groupId: user.groupId,
            active: true,
            role: { in: ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] },
          },
          select: { id: true, name: true, role: true },
          orderBy: [{ role: "asc" }, { name: "asc" }],
        })
      : Promise.resolve([
          { id: user.id, name: user.name, role: user.role },
        ]),
  ]);

  const rows: DeviceAccountRow[] = accounts.map((account) => ({
    id: account.id,
    ownerId: account.ownerId,
    ownerName: account.owner.name,
    groupName: account.group.name,
    ownerRole: account.owner.role as
      | "LEAD"
      | "RECEPTION"
      | "GROUP_OPERATOR"
      | "EXPERT",
    accountType: account.accountType,
    provider: account.provider,
    accountNumber: account.accountNumber,
    renewalDate: account.renewalDate,
    purpose: account.purpose,
    situation: account.situation,
    phoneCode: account.phoneCode,
    followUp: account.followUp,
    updatedAt: account.updatedAt.toISOString(),
  }));

  return (
    <main className={`page-shell space-y-3${canManageGroup ? " lead-compact-page" : ""}`}>
      <div className="page-heading">
        <div>
          <h1 className="page-title">设备账号</h1>
          <p className="page-description">
            {isAdmin
              ? "查看所有小组的设备账号、归属人员、续费日期和跟进情况；管理员为只读，避免误改一线资料。"
              : canManageGroup
              ? "维护本组普通 WS、商业 WS、RCS 和 SIG 账号，优先处理临近续费与待跟进账号。"
              : "维护自己的普通 WS、商业 WS、RCS 和 SIG 账号，记录续费、用途和跟进情况。"}
          </p>
        </div>
      </div>
      <DeviceAccountManager
        initialAccounts={rows}
        owners={owners.map((owner) => ({
          id: owner.id,
          name: owner.name,
          role: owner.role as "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT",
        }))}
        currentUserId={user.id}
        canManageGroup={canManageGroup}
        readOnly={isAdmin}
      />
    </main>
  );
}
