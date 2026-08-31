"use client";

import { useState } from "react";
import type { Confirm } from "./ConfirmDialog";
import { GroupBusinessTabs, type FollowUpHandlerBundle } from "./GroupBusinessTabs";
import { OrganizationScopeSelector, type ScopeSelection } from "./OrganizationScopeSelector";
import { TabDepartmentOverview } from "./TabDepartmentOverview";
import { TabTeamOverview } from "./TabTeamOverview";
import {
  type ChannelName, type ChannelReviewEntry, type Company, type Department, type DownstreamLead,
  type GroupMonthlySummary, type Member, type RepliedPendingGroupCustomer, type TeamGroup,
} from "@/lib/mock-data";

/** 统一的"组织范围 + 小组业务内容"页面骨架——组长/部门管理员/公司管理员/总公司管理员
 *  四类账号共用同一个组件，靠调用方（app/page.tsx）预过滤好的 companies/departments/
 *  teamGroups 数组，以及 companyLocked/departmentLocked/groupLocked/permissionLabel/
 *  readOnly/handlers 这些显式参数决定各自能看什么、能不能操作——本组件不做任何按角色
 *  的判断分支，沿用这个页面里"组件本身保持部门无感知，只认拿到手的数组"的既有约定。
 *
 *  取代原来 TabCompanyDrilldown → TabDepartmentDrilldown → TabGroupDrilldown 三层嵌套：
 *  公司/部门/小组选择收进 OrganizationScopeSelector 一条筛选栏；"全部部门"/"全部小组"
 *  对比视图复用既有 TabDepartmentOverview/TabTeamOverview；选中具体小组之后的三个业务
 *  标签交给 GroupBusinessTabs。 */
export function OrganizationWorkspace({
  companies, departments, teamGroups, groupMonthlySummary,
  members, downstream, repliedPendingGroup, channelReviewStatus,
  onSendForReview, onConfirm,
  initialScope,
  companyLocked = false, departmentLocked = false, groupLocked = false,
  allowAllDepartments = true, allowAllGroups = true,
  permissionLabel, permissionTone = "mute",
  readOnly, handlers, realSummary = false, realChannel = false, realFollowup = false,
}: {
  companies: Company[];
  departments: Department[];
  teamGroups: TeamGroup[];
  groupMonthlySummary: GroupMonthlySummary[];
  members: Member[];
  downstream: DownstreamLead[];
  repliedPendingGroup: RepliedPendingGroupCustomer[];
  channelReviewStatus: Record<string, ChannelReviewEntry>;
  onSendForReview: (channel: ChannelName, date: string) => void;
  onConfirm: (c: Confirm) => void;
  initialScope: ScopeSelection;
  companyLocked?: boolean;
  departmentLocked?: boolean;
  groupLocked?: boolean;
  allowAllDepartments?: boolean;
  allowAllGroups?: boolean;
  permissionLabel: string;
  permissionTone?: "mute" | "ok" | "warn";
  /** 客户进度是不是只读——组长本人 false，其余三档管理员一律 true。 */
  readOnly: boolean;
  /** readOnly=false（只有组长）时必填的真实操作 handler 整套；readOnly=true 时不传。 */
  handlers?: FollowUpHandlerBundle;
  realSummary?: boolean;
  realChannel?: boolean;
  realFollowup?: boolean;
}) {
  const [scope, setScope] = useState<ScopeSelection>(initialScope);

  const departmentsInCompany = departments.filter((d) => d.companyId === scope.companyId);
  const groupsInDepartment = scope.departmentId ? teamGroups.filter((g) => g.departmentId === scope.departmentId) : [];
  const selectedGroup = scope.groupId ? teamGroups.find((g) => g.id === scope.groupId) ?? null : null;
  const detailGroupName = teamGroups.find((g) => g.hasDetailData)?.name ?? "";

  // 组长统计已经接到真实接口后，不能继续显示原型里写死的“公司A/德国部/德国一组”。
  // 真实小组名称和当地时区由 RealOrganizationReporting 根据登录账号返回。
  if (realSummary) {
    return (
      <GroupBusinessTabs
        mode="active"
        members={members} downstream={downstream} repliedPendingGroup={repliedPendingGroup}
        channelReviewStatus={channelReviewStatus} onSendForReview={onSendForReview} onConfirm={onConfirm}
        readOnly={readOnly} handlers={handlers} realSummary realChannel={realChannel} realFollowup={realFollowup}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <OrganizationScopeSelector
        companies={companies} departments={departments} teamGroups={teamGroups}
        value={scope} onChange={setScope}
        companyLocked={companyLocked} departmentLocked={departmentLocked} groupLocked={groupLocked}
        allowAllDepartments={allowAllDepartments} allowAllGroups={allowAllGroups}
        permissionLabel={permissionLabel} permissionTone={permissionTone}
      />

      {scope.departmentId === null ? (
        <>
          <GroupBusinessTabs
            mode="disabled"
            reason={"当前查看“全部部门”对比——数据汇总/渠道数据核对/客户进度是某一个小组的数据，先在上方选一个具体部门和小组才能查看"}
          />
          {departmentsInCompany.length === 0 ? (
            <div className="card">
              <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--ink-3)" }}>该公司还没有任何部门</div>
            </div>
          ) : (
            <TabDepartmentOverview departments={departmentsInCompany} />
          )}
        </>
      ) : scope.groupId === null ? (
        <>
          <GroupBusinessTabs
            mode="disabled"
            reason={"当前查看“全部小组”对比——数据汇总/渠道数据核对/客户进度是某一个小组的数据，先在上方选一个具体小组才能查看"}
          />
          {groupsInDepartment.length === 0 ? (
            <div className="card">
              <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--ink-3)" }}>该部门还没有任何小组</div>
            </div>
          ) : (
            <TabTeamOverview members={members} teamGroups={groupsInDepartment} groupMonthlySummary={groupMonthlySummary} />
          )}
        </>
      ) : selectedGroup?.hasDetailData ? (
        <GroupBusinessTabs
          key={scope.groupId}
          mode="active"
          members={members} downstream={downstream} repliedPendingGroup={repliedPendingGroup}
          channelReviewStatus={channelReviewStatus} onSendForReview={onSendForReview} onConfirm={onConfirm}
          readOnly={readOnly} handlers={handlers}
          realSummary={realSummary}
        />
      ) : (
        <GroupBusinessTabs
          mode="empty"
          reason={detailGroupName
            ? `该组暂无逐人明细数据（本地演示数据范围限制，只有${detailGroupName}有完整数据）`
            : "该组暂无逐人明细数据（本地演示数据范围限制，这几个小组都还没有完整数据）"}
        />
      )}
    </div>
  );
}
