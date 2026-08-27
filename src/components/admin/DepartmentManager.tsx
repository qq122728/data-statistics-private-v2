"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HighRiskConfirmationDialog } from "./HighRiskConfirmationDialog";
import { requestAdminMutation } from "./admin-display";
import { BUSINESS_TIMEZONE_OPTIONS, businessTimezoneOption, minutesToTime } from "../../lib/business-time-config";

export type ManagedDepartment = {
  id: string;
  name: string;
  active: boolean;
  groupCount: number;
  managerCount: number;
  timezone: string;
  workStartMinutes: number;
  workEndMinutes: number;
  localTime: string;
  label: string;
};

export function DepartmentManager({
  departments,
}: {
  departments: ManagedDepartment[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [editingId, setEditingId] = useState("");
  const [editingName, setEditingName] = useState("");
  const [editingTimezone, setEditingTimezone] = useState("");
  const [pendingDisable, setPendingDisable] =
    useState<ManagedDepartment | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) return setError("请填写下属公司名称");
    setBusy(true);
    setError("");
    try {
      await requestAdminMutation(
        "/api/admin/departments",
        { name, timezone },
        "POST",
      );
      setName("");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "添加失败");
    } finally {
      setBusy(false);
    }
  }

  async function update(department: ManagedDepartment, body: object) {
    setBusy(true);
    setError("");
    try {
      await requestAdminMutation(
        "/api/admin/departments",
        { id: department.id, ...body },
        "PATCH",
      );
      setEditingId("");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisable(
    credentials: { highRiskReason: string; currentPassword: string },
  ) {
    if (!pendingDisable) return;
    setBusy(true);
    setError("");
    try {
      await requestAdminMutation(
        "/api/admin/departments",
        { id: pendingDisable.id, active: false, ...credentials },
        "PATCH",
      );
      setPendingDisable(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="mb-5">
        <h2 className="text-2xl font-bold">下属公司管理</h2>
        <p className="mt-1 text-sm text-slate-600">
          总公司可以建立多家下属公司，再把小组和公司管理员放到对应公司；停用不会删除历史数据。
        </p>
      </div>
      <div className="mb-4 grid max-w-3xl gap-2 md:grid-cols-[1fr_220px_auto] md:items-end">
        <label className="block text-sm font-medium text-slate-700">下属公司名称
          <input
            aria-label="下属公司名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：德国公司、美国纽约公司"
            className="mt-1 min-w-0 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm"
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">国家和默认时区
          <select aria-label="下属公司默认国家和时区" value={timezone} onChange={(event) => setTimezone(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm">
            {BUSINESS_TIMEZONE_OPTIONS.map((option) => <option key={option.timezone} value={option.timezone}>{option.label}</option>)}
          </select>
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={create}
          className="rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          添加下属公司
        </button>
      </div>
      <p className="-mt-2 mb-4 text-xs text-slate-500">德国选“德国时间”；美国请按办公城市选东部（纽约）或西部（洛杉矶）。系统会自动处理夏令时。</p>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      <div className="overflow-hidden border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3">下属公司</th>
              <th className="px-4 py-3">默认时区</th>
              <th className="px-4 py-3">当地状态</th>
              <th className="px-4 py-3">小组数</th>
              <th className="px-4 py-3">公司管理员</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {departments.map((department) => (
              <tr key={department.id}>
                <td className="px-4 py-3">
                  {editingId === department.id ? (
                    <input
                      aria-label={`修改下属公司“${department.name}”名称`}
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      className="rounded border border-slate-300 px-2 py-1"
                    />
                  ) : (
                    <strong>{department.name}</strong>
                  )}
                </td>
                <td className="px-4 py-3">
                  {editingId === department.id ? <select aria-label={`修改下属公司“${department.name}”默认时区`} value={editingTimezone} onChange={(event) => setEditingTimezone(event.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1">{BUSINESS_TIMEZONE_OPTIONS.map((option) => <option key={option.timezone} value={option.timezone}>{option.label}</option>)}</select> : <span>{businessTimezoneOption(department.timezone).label}<small className="block text-slate-500">{minutesToTime(department.workStartMinutes)}–{minutesToTime(department.workEndMinutes)}</small></span>}
                </td>
                <td className="px-4 py-3"><span className="font-medium">{department.label}</span><small className="block text-slate-500">{department.localTime}</small></td>
                <td className="px-4 py-3">{department.groupCount}</td>
                <td className="px-4 py-3">{department.managerCount}</td>
                <td className="px-4 py-3">
                  {department.active ? "启用" : "停用"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    {editingId === department.id ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          update(department, { name: editingName, timezone: editingTimezone })
                        }
                        className="font-semibold text-blue-600"
                      >
                        保存
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(department.id);
                          setEditingName(department.name);
                          setEditingTimezone(department.timezone);
                        }}
                        className="font-semibold text-blue-600"
                      >
                        改名
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        department.active
                          ? setPendingDisable(department)
                          : update(department, { active: true })
                      }
                      className="font-semibold text-slate-600"
                    >
                      {department.active ? "停用" : "启用"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <HighRiskConfirmationDialog
        open={Boolean(pendingDisable)}
        title="确认停用下属公司"
        description={`停用“${pendingDisable?.name ?? ""}”后，该公司将从启用范围中移除。所属小组和历史数据不会被删除；请先停用或移动启用中的小组和公司管理员。`}
        confirmLabel="确认停用下属公司"
        onClose={() => setPendingDisable(null)}
        onConfirm={confirmDisable}
      />
    </section>
  );
}
