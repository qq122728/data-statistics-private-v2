"use client";

import { X } from "@phosphor-icons/react";
import { FormEvent, useEffect, useState } from "react";
import type { LeadMember } from "./LeadMemberTable";

type LeadMemberFormError = {
  message: string;
  field: "name" | "username" | "password" | null;
};
type SaveBody = {
  name: string;
  username: string;
  password?: string;
  role: "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
  secondaryRoles: Array<"RECEPTION" | "GROUP_OPERATOR">;
};

function classifyFormError(message: string): LeadMemberFormError {
  if (/账号.*(?:已存在|不能为空)/.test(message))
    return { message, field: "username" };
  if (/成员姓名|姓名/.test(message)) return { message, field: "name" };
  if (/密码/.test(message)) return { message, field: "password" };
  return { message, field: null };
}

export function LeadMemberDrawer({
  member,
  groupName,
  onClose,
  onSave,
  onAction,
}: {
  member: LeadMember | null;
  groupName: string;
  onClose: () => void;
  onSave: (body: SaveBody) => Promise<void>;
  onAction: (body: { password?: string; active?: boolean }) => Promise<void>;
}) {
  const [name, setName] = useState(member?.name ?? "");
  const [username, setUsername] = useState(member?.username ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(member?.role ?? "RECEPTION");
  const [secondaryRole, setSecondaryRole] = useState<"RECEPTION" | "GROUP_OPERATOR" | "">("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<LeadMemberFormError | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(false);

  useEffect(() => {
    setRole(member?.role ?? "RECEPTION");
    const assigned = member?.roleAssignments?.find((assignment) => assignment.role !== member.role)?.role;
    setSecondaryRole(assigned === "RECEPTION" || assigned === "GROUP_OPERATOR" ? assigned : "");
  }, [member]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name,
        username,
        password: member ? undefined : password,
        role,
        secondaryRoles: secondaryRole ? [secondaryRole] : [],
      });
    } catch (reason) {
      setError(
        classifyFormError(
          reason instanceof Error ? reason.message : "保存失败，请稍后重试",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onAction({ password: temporaryPassword });
    } catch (reason) {
      setError(
        classifyFormError(
          reason instanceof Error ? reason.message : "重置失败，请稍后重试",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus() {
    if (!member) return;
    setSaving(true);
    setError(null);
    try {
      await onAction({ active: !member.active });
    } catch (reason) {
      setError(
        classifyFormError(
          reason instanceof Error ? reason.message : "操作失败，请稍后重试",
        ),
      );
      setConfirmStatus(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/20"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={member ? "编辑前台账号" : "添加前台账号"}
        className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <h2 className="text-xl font-bold text-slate-950">
            {member ? "编辑前台账号" : "添加前台账号"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded p-2 text-slate-500 hover:bg-slate-100"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <form id="lead-member-form" onSubmit={submit} className="space-y-5">
            <label className="block text-sm font-medium text-slate-700">
              姓名
              <input
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                aria-invalid={error?.field === "name"}
                className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-600"
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
            <label className="block text-sm font-medium text-slate-700">
              登录账号
              <input
                name="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                aria-invalid={error?.field === "username"}
                className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-600"
              />
              {error?.field === "username" && (
                <span
                  role="alert"
                  className="mt-1 block text-sm font-normal text-red-700"
                >
                  {error.message}
                </span>
              )}
            </label>
            {!member && (
              <label className="block text-sm font-medium text-slate-700">
                初始密码
                <input
                  name="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={12}
                  required
                  aria-invalid={error?.field === "password"}
                  className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-600"
                />
                <span className="mt-1 block text-sm font-normal text-slate-500">
                  至少 12 位，前台人员首次登录后必须修改
                </span>
                {error?.field === "password" && (
                  <span
                    role="alert"
                    className="mt-1 block text-sm font-normal text-red-700"
                  >
                    {error.message}
                  </span>
                )}
              </label>
            )}
            <label className="block text-sm font-medium text-slate-700">
              岗位
              <select
                name="role"
                value={role}
                onChange={(event) =>
                  { setRole(event.target.value as typeof role); setSecondaryRole(""); }
                }
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5"
              >
                <option value="RECEPTION">前台接粉</option>
                <option value="GROUP_OPERATOR">前台炒群</option>
                <option value="EXPERT">前台专家</option>
              </select>
              <span className="mt-1 block text-sm font-normal text-slate-500">
                接粉负责前段客户；炒群跟进组内客户；专家在推专家后接手。
              </span>
            </label>
            {(role === "RECEPTION" || role === "GROUP_OPERATOR") && <label className="block rounded-lg border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm text-slate-700">
              <span className="font-medium">兼任岗位</span>
              <span className="ml-2 text-slate-500">同一个账号可同时进入两个工作台。</span>
              <span className="mt-2 flex items-center gap-2">
                <input type="checkbox" checked={Boolean(secondaryRole)} onChange={(event) => setSecondaryRole(event.target.checked ? (role === "RECEPTION" ? "GROUP_OPERATOR" : "RECEPTION") : "")} />
                同时兼任{role === "RECEPTION" ? "前台炒群" : "前台接粉"}
              </span>
              <span className="mt-1 block text-xs text-slate-500">兼任后，接粉客户和炒群客户仍分别按负责人统计，不会重复算业绩。</span>
            </label>}
            <div>
              <p className="text-sm font-medium text-slate-700">所属小组</p>
              <p
                aria-label="所属小组"
                className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600"
              >
                {groupName}
              </p>
              <span className="mt-1 block text-sm text-slate-500">
                所属小组由系统固定，不能在这里修改。
              </span>
            </div>
          </form>
          {member && (
            <div className="mt-8 space-y-3 border-t border-slate-200 pt-6">
              {!resetOpen ? (
                <button
                  type="button"
                  onClick={() => {
                    setResetOpen(true);
                    setError(null);
                  }}
                  className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium"
                >
                  重置密码
                </button>
              ) : (
                <form
                  onSubmit={resetPassword}
                  className="rounded-md border border-amber-200 bg-amber-50 p-4"
                >
                  <p className="text-sm font-medium text-amber-900">
                    输入新临时密码。保存后，该前台账号现有登录会全部退出。
                  </p>
                  <input
                    aria-label="新临时密码"
                    name="temporaryPassword"
                    type="password"
                    value={temporaryPassword}
                    onChange={(event) =>
                      setTemporaryPassword(event.target.value)
                    }
                    minLength={12}
                    required
                    aria-invalid={error?.field === "password"}
                    className="mt-3 w-full rounded border border-amber-300 bg-white px-3 py-2"
                  />
                  {error?.field === "password" && (
                    <p role="alert" className="mt-1 text-sm text-red-700">
                      {error.message}
                    </p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button
                      disabled={saving}
                      className="rounded bg-amber-700 px-3 py-2 text-sm text-white disabled:opacity-60"
                    >
                      确认重置
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setResetOpen(false);
                        setError(null);
                      }}
                      className="text-sm text-slate-600"
                    >
                      取消
                    </button>
                  </div>
                </form>
              )}
              {!confirmStatus ? (
                <button
                  type="button"
                  onClick={() => setConfirmStatus(true)}
                  className={`w-full rounded-md border px-4 py-2.5 text-sm font-medium ${member.active ? "border-red-300 text-red-700" : "border-emerald-300 text-emerald-700"}`}
                >
                  {member.active ? "停用账号" : "重新启用账号"}
                </button>
              ) : (
                <div
                  className={`rounded-md border p-4 ${member.active ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}
                >
                  <p
                    className={`text-sm ${member.active ? "text-red-800" : "text-emerald-800"}`}
                  >
                    确认{member.active ? "停用" : "重新启用"}“{member.name}
                    ”的账号？
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={changeStatus}
                      className={`rounded px-3 py-2 text-sm text-white disabled:opacity-60 ${member.active ? "bg-red-600" : "bg-emerald-600"}`}
                    >
                      确认操作
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setConfirmStatus(false)}
                      className="text-sm text-slate-600 disabled:opacity-60"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {error && !error.field && (
            <p
              role="alert"
              className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error.message}
            </p>
          )}
        </div>
        <footer className="border-t border-slate-200 p-6">
          <button
            form="lead-member-form"
            disabled={saving}
            className="w-full rounded-md bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "保存中…" : member ? "保存修改" : "添加前台账号"}
          </button>
        </footer>
      </aside>
    </div>
  );
}
