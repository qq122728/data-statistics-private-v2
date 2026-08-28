import { CheckCircle, Circle } from "@phosphor-icons/react";
import type { AdminGroup } from "./MemberTable";

export function formatChannelGroupLabel(
  group: Pick<AdminGroup, "name" | "departmentName">,
): string {
  return group.departmentName
    ? `${group.departmentName} / ${group.name}`
    : group.name;
}

export type ManagedChannel = {
  id: string;
  name: string;
  groupId: string;
  active: boolean;
  channelType?: "SMS" | "ADS" | "REBATE";
  group: { id: string; name: string; active: boolean };
  creator: { name: string } | null;
  createdAt: string;
  batchCount: number;
  groupCount?: number;
};
export function channelTypeLabel(type: ManagedChannel["channelType"]) {
  return type === "ADS" ? "投流粉" : type === "REBATE" ? "底料返点" : "短信粉";
}
export function ChannelTable({
  channels,
  onEdit,
}: {
  channels: ManagedChannel[];
  groups?: AdminGroup[];
  onEdit: (channel: ManagedChannel) => void;
}) {
  return (
    <div className="overflow-x-auto border border-slate-200 bg-white">
      <table className="w-full min-w-[960px] text-left text-sm">
        <thead className="bg-slate-50 text-sm uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">渠道名称</th>
            <th className="px-4 py-3">类型</th>
            <th className="px-4 py-3">使用范围</th>
            <th className="px-4 py-3">创建人</th>
            <th className="px-4 py-3">创建时间</th>
            <th className="px-4 py-3">历史批次</th>
            <th className="px-4 py-3">状态</th>
            <th className="px-4 py-3 text-right">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {channels.map((channel) => (
            <tr
              key={channel.id}
              className="hover:bg-slate-50"
            >
              <td className="px-4 py-4 font-medium">{channel.name}</td>
              <td className="px-4 py-4"><span className="rounded bg-slate-100 px-2 py-1 font-medium text-slate-700">{channelTypeLabel(channel.channelType)}</span></td>
              <td className="px-4 py-4 text-slate-600">
                全部公司 / {channel.groupCount ?? 1} 个小组
              </td>
              <td className="px-4 py-4 text-slate-600">
                {channel.creator?.name ?? "系统"}
              </td>
              <td className="px-4 py-4 text-slate-600">
                {new Intl.DateTimeFormat("zh-CN").format(
                  new Date(channel.createdAt),
                )}
              </td>
              <td className="px-4 py-4 text-slate-600">{channel.batchCount}</td>
              <td className="px-4 py-4">
                <span
                  className={`inline-flex items-center gap-2 ${channel.active ? "text-blue-700" : "text-slate-500"}`}
                >
                  {channel.active ? (
                    <CheckCircle size={17} weight="fill" aria-hidden="true" />
                  ) : (
                    <Circle size={17} aria-hidden="true" />
                  )}
                  {channel.active ? "启用" : "停用"}
                </span>
              </td>
              <td className="px-4 py-4 text-right">
                <button
                  onClick={() => onEdit(channel)}
                  className="rounded px-3 py-1.5 font-medium text-blue-700 hover:bg-blue-50"
                >
                  编辑
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!channels.length && (
        <div className="p-12 text-center text-sm text-slate-500">
          没有符合条件的渠道
        </div>
      )}
    </div>
  );
}
