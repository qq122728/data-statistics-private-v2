"use client";

import { Plus, X } from "@phosphor-icons/react";
import { type FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChannelTable,
  type ManagedChannel,
} from "./ChannelTable";
import type { AdminGroup } from "./MemberTable";
import {
  adminMutationSuccessMessage,
  classifyAdminFormError,
  requestAdminMutation,
  type AdminFormError,
} from "./admin-display";
import { HighRiskConfirmationDialog } from "./HighRiskConfirmationDialog";

type ChannelType = "SMS" | "ADS" | "REBATE";
type PendingAdminMutation = {
  body: Record<string, unknown>;
  name: string;
  method: "POST" | "PATCH";
  operation: "create" | "update" | "enable" | "disable";
};

export function ChannelManager({
  channels,
  groups: _groups,
  resourceMode = false,
  companyMode = false,
}: {
  channels: ManagedChannel[];
  groups: AdminGroup[];
  resourceMode?: boolean;
  /** 公司管理员只能操作本公司的渠道副本；服务端仍会再次校验范围。 */
  companyMode?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<ManagedChannel | "new" | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [channelType, setChannelType] = useState<ChannelType>("SMS");
  const [error, setError] = useState<AdminFormError | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pendingAdminMutation, setPendingAdminMutation] =
    useState<PendingAdminMutation | null>(null);
  const channel = selected === "new" || !selected ? null : selected;
  const filtered = useMemo(
    () =>
      channels.filter(
        (item) =>
          item.name.toLowerCase().includes(search.trim().toLowerCase()) &&
          (!status || String(item.active) === status),
      ),
    [channels, search, status],
  );
  const close = () => {
    setSelected(null);
    setConfirm(false);
    setPendingAdminMutation(null);
  };
  function openNew() {
    setSelected("new");
    setChannelType("SMS");
    setError(null);
    setNotice("");
  }
  function openEdit(item: ManagedChannel) {
    setSelected(item);
    setChannelType(item.channelType ?? "SMS");
    setConfirm(false);
    setError(null);
    setNotice("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");
    const body: Record<string, unknown> = channel
      ? { id: channel.id, ...(companyMode ? { company: true } : { global: true }), name, channelType }
      : { name, ...(companyMode ? { company: true } : { global: true }), channelType };
    if (!resourceMode && !companyMode) {
      setPendingAdminMutation({ body, name, method: channel ? "PATCH" : "POST", operation: channel ? "update" : "create" });
      return;
    }
    setSaving(true);
    try {
      await requestAdminMutation(
        "/api/admin/channels",
        body,
        channel ? "PATCH" : "POST",
      );
      setNotice(
        adminMutationSuccessMessage(
          "channel",
          channel ? "update" : "create",
          name,
        ),
      );
      close();
      router.refresh();
    } catch (reason) {
      setError(
        classifyAdminFormError(
          "channel",
          reason instanceof Error ? reason.message : "保存失败",
        ),
      );
    } finally {
      setSaving(false);
    }
  }
  async function toggle() {
    if (!channel) return;
    if (!resourceMode && !companyMode) {
      setPendingAdminMutation({
        body: { id: channel.id, global: true, active: !channel.active },
        name: channel.name,
        method: "PATCH",
        operation: channel.active ? "disable" : "enable",
      });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await requestAdminMutation(
        "/api/admin/channels",
        { id: channel.id, ...(companyMode ? { company: true } : { global: true }), active: !channel.active },
        "PATCH",
      );
      setNotice(
        adminMutationSuccessMessage(
          "channel",
          channel.active ? "disable" : "enable",
          channel.name,
        ),
      );
      close();
      router.refresh();
    } catch (reason) {
      setError(
        classifyAdminFormError(
          "channel",
          reason instanceof Error ? reason.message : "操作失败",
        ),
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">渠道管理</h2>
          <p className="mt-1 text-sm text-slate-600">
            {companyMode ? "仅管理本公司：保存后会同步到本公司所有小组；其他公司的渠道不会受到影响。所有修改都会写入审计日志。" : resourceMode ? "全局渠道：保存后所有公司和小组都可以选择；资源部负责渠道的日常维护。所有修改都会写入审计日志。" : "日常渠道由资源部维护；总公司仅在特殊情况下介入，并必须填写原因和管理员密码。"}
          </p>
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white"
        >
          <Plus size={17} weight="bold" />
          添加渠道
        </button>
      </div>
      {notice && (
        <p
          role="status"
          className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {notice}
        </p>
      )}
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <input
          aria-label="搜索渠道"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索渠道名称"
          className="rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm"
        />
        <select
          aria-label="按状态筛选"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm"
        >
          <option value="">全部状态</option>
          <option value="true">启用</option>
          <option value="false">停用</option>
        </select>
      </div>
      <ChannelTable channels={filtered} onEdit={openEdit} />
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/20"
          onMouseDown={(event) =>
            event.target === event.currentTarget && close()
          }
        >
          <aside
            role="dialog"
            aria-label={channel ? "编辑渠道" : "添加渠道"}
            className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-white shadow-2xl"
          >
            <header className="flex items-center justify-between border-b px-6 py-5">
              <h3 className="text-xl font-bold">
                {channel ? "编辑渠道" : "添加渠道"}
              </h3>
              <button
                aria-label="关闭"
                onClick={close}
                className="rounded p-2 text-slate-500 hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </header>
            <div className="flex-1 p-6">
              <form id="channel-form" key={channel?.id ?? "new"} onSubmit={submit} className="space-y-5">
                <label className="block text-sm font-medium">
                  渠道名称
                  <input
                    name="name"
                    defaultValue={channel?.name}
                    required
                    aria-invalid={error?.field === "name"}
                    className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5"
                  />
                </label>
                <label className="block text-sm font-medium">渠道类型<select value={channelType} disabled={Boolean(channel)} onChange={(event) => setChannelType(event.target.value as ChannelType)} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 disabled:bg-slate-100"><option value="SMS">短信粉</option><option value="ADS">投流粉</option><option value="REBATE">底料返点</option></select>{channel ? <span className="mt-1 block text-xs font-normal text-slate-500">已产生历史批次的渠道不能改类型，避免旧账变口径。</span> : null}</label>
                {companyMode ? <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">保存后，本公司的所有小组会使用同一条渠道。</p> : null}
                <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-800">
                  {channelType === "ADS" ? "投流粉渠道支持多位接粉员共用同一渠道和日期导入到同一批次。" : "渠道类型只用于统计口径分类，对比不同来源的转化质量。"}
                </div>
              </form>
              {channel && (
                <div className="mt-8 border-t pt-6">
                  {!confirm ? (
                    <button
                      onClick={() => setConfirm(true)}
                      className={`w-full rounded-md border px-4 py-2.5 ${channel.active ? "border-red-300 text-red-700" : "border-emerald-300 text-emerald-700"}`}
                    >
                      {channel.active ? "停用渠道" : "重新启用渠道"}
                    </button>
                  ) : (
                    <div
                      className={`rounded-md p-4 text-sm ${channel.active ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}
                    >
                      <p>
                        确认{channel.active ? "停用" : "重新启用"}“
                        {channel.name}”？历史数据会保留。
                      </p>
                      <div className="mt-3 flex gap-3">
                        <button
                          disabled={saving}
                          onClick={toggle}
                          className={`rounded px-3 py-2 text-white ${channel.active ? "bg-red-600" : "bg-emerald-600"}`}
                        >
                          确认操作
                        </button>
                        <button
                          disabled={saving}
                          onClick={() => setConfirm(false)}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {error && (
                <p role="alert" className="mt-4 text-sm text-red-700">
                  {error.message}
                </p>
              )}
            </div>
            <footer className="border-t p-6">
              <button
                form="channel-form"
                disabled={saving}
                className="w-full rounded-md bg-blue-600 px-4 py-3 font-medium text-white"
              >
                {saving ? "保存中…" : channel ? "保存修改" : "添加渠道"}
              </button>
            </footer>
          </aside>
        </div>
      )}
      <HighRiskConfirmationDialog
        open={Boolean(pendingAdminMutation)}
        title="确认总公司介入渠道管理"
        description={pendingAdminMutation ? `资源部负责日常渠道维护。总公司将${pendingAdminMutation.operation === "create" ? "新增" : pendingAdminMutation.operation === "disable" ? "停用" : pendingAdminMutation.operation === "enable" ? "启用" : "修改"}“${pendingAdminMutation.name}”，必须说明介入原因并验证管理员密码。` : ""}
        confirmLabel="确认总公司介入"
        passwordLabel={companyMode ? "当前公司管理员密码" : resourceMode ? "当前资源部账号密码" : "当前管理员密码"}
        onClose={() => setPendingAdminMutation(null)}
        onConfirm={async (credentials) => {
          if (!pendingAdminMutation) return;
          await requestAdminMutation(
            "/api/admin/channels",
            { ...pendingAdminMutation.body, ...credentials },
            pendingAdminMutation.method,
          );
          setNotice(
            adminMutationSuccessMessage(
              "channel",
              pendingAdminMutation.operation,
              pendingAdminMutation.name,
            ),
          );
          close();
          router.refresh();
        }}
      />
    </section>
  );
}
