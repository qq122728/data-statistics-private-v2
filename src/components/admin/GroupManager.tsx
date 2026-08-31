"use client";

import { Plus, X } from "@phosphor-icons/react";
import { type FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GroupTable, type ManagedGroup } from "./GroupTable";
import {
  adminMutationSuccessMessage,
  classifyAdminFormError,
  requestAdminMutation,
  type AdminFormError,
} from "./admin-display";
import { HighRiskConfirmationDialog } from "./HighRiskConfirmationDialog";
import type { ManagedDepartment } from "./DepartmentManager";
import { BUSINESS_TIMEZONE_OPTIONS } from "../../lib/business-time-config";

export function GroupManager({
  groups,
  departments,
}: {
  groups: ManagedGroup[];
  departments: ManagedDepartment[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<ManagedGroup | "new" | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<AdminFormError | null>(null);
  const [notice, setNotice] = useState("");
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [pendingDisable, setPendingDisable] = useState<ManagedGroup | null>(null);
  const [saving, setSaving] = useState(false);
  const filtered = useMemo(
    () =>
      groups.filter(
        (item) =>
          `${item.departmentName} ${item.name}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()) &&
          (!status || String(item.active) === status),
      ),
    [groups, search, status],
  );
  const group = selected === "new" || !selected ? null : selected;

  function close() {
    setSelected(null);
    setConfirmEnable(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const form = new FormData(event.currentTarget);
      const name = String(form.get("name") ?? "");
      const departmentId = String(form.get("departmentId") ?? "");
      const timezone = String(form.get("timezone") ?? "");
      const groupType = String(form.get("groupType") ?? "HACKER");
      await requestAdminMutation(
        "/api/admin/groups",
        group ? { id: group.id, name, departmentId, timezone } : { name, groupType, departmentId, timezone },
        group ? "PATCH" : "POST",
      );
      setNotice(
        adminMutationSuccessMessage(
          "group",
          group ? "update" : "create",
          name,
        ),
      );
      close();
      router.refresh();
    } catch (caught) {
      setError(
        classifyAdminFormError(
          "group",
          caught instanceof Error ? caught.message : "保存失败",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function enable() {
    if (!group) return;
    setSaving(true);
    setError(null);
    try {
      await requestAdminMutation(
        "/api/admin/groups",
        { id: group.id, active: true },
        "PATCH",
      );
      setNotice(adminMutationSuccessMessage("group", "enable", group.name));
      close();
      router.refresh();
    } catch (caught) {
      setError(
        classifyAdminFormError(
          "group",
          caught instanceof Error ? caught.message : "操作失败",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmDisable(credentials: {
    highRiskReason: string;
    currentPassword: string;
  }) {
    if (!pendingDisable) return;
    await requestAdminMutation(
      "/api/admin/groups",
      { id: pendingDisable.id, active: false, ...credentials },
      "PATCH",
    );
    setNotice(
      adminMutationSuccessMessage("group", "disable", pendingDisable.name),
    );
    setPendingDisable(null);
    close();
    router.refresh();
  }

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">小组管理</h2>
          <p className="mt-1 text-sm text-slate-600">
            改名或停用不会删除历史统计。
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setSelected("new");
            setError(null);
            setNotice("");
          }}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white"
        >
          <Plus size={17} weight="bold" aria-hidden="true" />
          添加小组
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
      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_220px]">
        <input
          aria-label="搜索小组"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索小组名称"
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
      <GroupTable
        groups={filtered}
        onEdit={(item) => {
          setSelected(item);
          setConfirmEnable(false);
          setError(null);
          setNotice("");
        }}
      />
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/20"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && close()
          }
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={group ? "编辑小组" : "添加小组"}
            className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-white shadow-2xl"
          >
            <header className="flex items-center justify-between border-b px-6 py-5">
              <h3 className="text-xl font-bold">
                {group ? "编辑小组" : "添加小组"}
              </h3>
              <button
                type="button"
                aria-label="关闭"
                onClick={close}
                className="rounded p-2 text-slate-500 hover:bg-slate-100"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>
            <div className="flex-1 p-6">
              <form id="group-form" onSubmit={submit} className="space-y-4">
                <label className="block text-sm font-medium">
                  所属下属公司
                  <select
                    name="departmentId"
                    defaultValue={
                      group?.departmentId ??
                      departments.find((item) => item.active)?.id
                    }
                    required
                    aria-invalid={error?.field === "departmentId"}
                    className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5"
                  >
                    {departments
                      .filter(
                        (item) =>
                          item.active || item.id === group?.departmentId,
                      )
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                          {item.active ? "" : "（已停用）"}
                        </option>
                      ))}
                  </select>
                  {error?.field === "departmentId" && (
                    <span
                      role="alert"
                      className="mt-1 block text-sm font-normal text-red-700"
                    >
                      {error.message}
                    </span>
                  )}
                </label>
                <label className="block text-sm font-medium">
                  国家和时区
                  <select name="timezone" defaultValue={group?.timezone ?? ""} className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5">
                    <option value="">继承所属公司的默认时区</option>
                    {BUSINESS_TIMEZONE_OPTIONS.map((option) => <option key={option.timezone} value={option.timezone}>{option.label}</option>)}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-slate-500">工作时间固定为小组当地时间 10:00–22:00</span>
                </label>
                <label className="block text-sm font-medium">
                  小组名称
                  <input
                    name="name"
                    defaultValue={group?.name}
                    required
                    aria-invalid={error?.field === "name"}
                    className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5"
                  />
                  {error?.field === "name" && (
                    <span
                      role="alert"
                      className="mt-1 block text-sm font-normal text-red-700"
                    >
                      {error.message}
                    </span>
                  )}
                </label>
                <label className="block text-sm font-medium">
                  小组类型
                  <select name="groupType" defaultValue={group?.groupType ?? "HACKER"} disabled={Boolean(group)} className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 disabled:bg-slate-100">
                    <option value="HACKER">黑客组（现有统计表）</option>
                    <option value="LAWYER">律师组（律师统计表）</option>
                  </select>
                  <span className="mt-1 block text-xs font-normal text-slate-500">{group ? "小组创建后类型不能直接修改，避免历史统计口径混乱" : "类型决定组员使用的每日统计指标"}</span>
                </label>
              </form>
              {group && (
                <div className="mt-8 border-t pt-6">
                  {group.active ? (
                    <button
                      type="button"
                      onClick={() => setPendingDisable(group)}
                      className="w-full rounded-md border border-red-300 px-4 py-2.5 text-red-700"
                    >
                      停用小组
                    </button>
                  ) : !confirmEnable ? (
                    <button
                      type="button"
                      onClick={() => setConfirmEnable(true)}
                      className="w-full rounded-md border border-emerald-300 px-4 py-2.5 text-emerald-700"
                    >
                      重新启用小组
                    </button>
                  ) : (
                    <div className="rounded-md bg-emerald-50 p-4 text-sm text-emerald-800">
                      <p>确认重新启用“{group.name}”？</p>
                      <div className="mt-3 flex gap-3">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={enable}
                          className="rounded bg-emerald-600 px-3 py-2 text-white disabled:opacity-60"
                        >
                          确认操作
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => setConfirmEnable(false)}
                          className="disabled:opacity-60"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {error && !error.field && (
                <p role="alert" className="mt-4 text-sm text-red-700">
                  {error.message}
                </p>
              )}
            </div>
            <footer className="border-t p-6">
              <button
                form="group-form"
                disabled={saving}
                className="w-full rounded-md bg-blue-600 px-4 py-3 font-medium text-white disabled:opacity-60"
              >
                {saving ? "保存中…" : group ? "保存修改" : "添加小组"}
              </button>
            </footer>
          </aside>
        </div>
      )}
      <HighRiskConfirmationDialog
        open={Boolean(pendingDisable)}
        title="确认停用小组"
        description={`停用“${pendingDisable?.name ?? ""}”后，将不能继续作为启用小组承接成员和渠道管理。现有 ${pendingDisable?.memberCount ?? 0} 位成员、${pendingDisable?.channelCount ?? 0} 个渠道及全部历史数据仍会保留。`}
        confirmLabel="确认停用小组"
        onClose={() => setPendingDisable(null)}
        onConfirm={confirmDisable}
      />
    </section>
  );
}
