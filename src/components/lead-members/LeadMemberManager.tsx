"use client";

import { Info, Plus } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LeadMemberDrawer } from "./LeadMemberDrawer";
import { LeadMemberTable, type LeadMember } from "./LeadMemberTable";
import { CollaborationSettings } from "./CollaborationSettings";

class LeadMemberRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LeadMemberRequestError";
  }
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim())
      return payload.error;
  } catch {
    // Keep the Chinese fallback below when the response is not JSON.
  }
  return "操作失败，请稍后重试";
}

async function requestLeadMembers(): Promise<LeadMember[]> {
  let response: Response;
  try {
    response = await fetch("/api/lead/members");
  } catch {
    throw new LeadMemberRequestError("网络异常，请检查连接后重试", 0);
  }
  if (!response.ok)
    throw new LeadMemberRequestError(
      await readApiError(response),
      response.status,
    );
  return response.json() as Promise<LeadMember[]>;
}

async function requestLeadMutation(
  body: object,
  method: "POST" | "PATCH",
): Promise<LeadMember> {
  let response: Response;
  try {
    response = await fetch("/api/lead/members", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new LeadMemberRequestError("网络异常，请检查连接后重试", 0);
  }
  if (!response.ok)
    throw new LeadMemberRequestError(
      await readApiError(response),
      response.status,
    );
  return response.json() as Promise<LeadMember>;
}

function successMessage(
  action: "create" | "update" | "reset" | "enable" | "disable",
  name: string,
) {
  if (action === "create") return `已添加前台账号“${name}”`;
  if (action === "update") return `已保存前台账号“${name}”的修改`;
  if (action === "reset") return `已重置前台账号“${name}”的密码`;
  if (action === "enable") return `已重新启用前台账号“${name}”`;
  return `已停用前台账号“${name}”`;
}

export function LeadMemberManager({ groupName }: { groupName: string }) {
  const [members, setMembers] = useState<LeadMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [groupUnavailable, setGroupUnavailable] = useState(false);
  const [drawer, setDrawer] = useState<LeadMember | "new" | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState("");

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setMembers(await requestLeadMembers());
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "加载前台账号失败，请稍后重试";
      setLoadError(message);
      if (reason instanceof LeadMemberRequestError && reason.status === 403)
        setGroupUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const filtered = useMemo(
    () =>
      members.filter((member) => {
        const query = search.trim().toLowerCase();
        return (
          (!query ||
            `${member.name} ${member.username}`
              .toLowerCase()
              .includes(query)) &&
          (!status || String(member.active) === status)
        );
      }),
    [members, search, status],
  );
  const selected = drawer === "new" || drawer === null ? null : drawer;

  function openDrawer(value: LeadMember | "new") {
    setNotice("");
    setDrawer(value);
  }
  function updateMember(member: LeadMember, isNew = false) {
    setMembers((current) =>
      isNew
        ? [member, ...current]
        : current.map((item) => (item.id === member.id ? member : item)),
    );
  }
  function handleMutationError(reason: unknown) {
    if (
      reason instanceof LeadMemberRequestError &&
      reason.status === 403 &&
      /启用中的小组/.test(reason.message)
    ) {
      setGroupUnavailable(true);
    }
  }

  async function save(body: {
    name: string;
    username: string;
    password?: string;
    role: "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
    secondaryRoles: Array<"RECEPTION" | "GROUP_OPERATOR">;
  }) {
    try {
      const saved = await requestLeadMutation(
        selected ? { id: selected.id, ...body } : body,
        selected ? "PATCH" : "POST",
      );
      updateMember(saved, !selected);
      setNotice(successMessage(selected ? "update" : "create", saved.name));
      setDrawer(null);
    } catch (reason) {
      handleMutationError(reason);
      throw reason;
    }
  }

  async function action(body: { password?: string; active?: boolean }) {
    if (!selected) return;
    try {
      const saved = await requestLeadMutation(
        { id: selected.id, ...body },
        "PATCH",
      );
      updateMember(saved);
      const actionName = Object.prototype.hasOwnProperty.call(body, "password")
        ? "reset"
        : saved.active
          ? "enable"
          : "disable";
      setNotice(successMessage(actionName, saved.name));
      setDrawer(null);
    } catch (reason) {
      handleMutationError(reason);
      throw reason;
    }
  }

  if (groupUnavailable)
    return (
      <section>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900">
          <h2 className="text-xl font-bold">当前小组不可用</h2>
          <p className="mt-2 text-sm leading-6">
            你的组长账号没有归属启用中的小组，暂时不能查看或管理组员。请联系管理员恢复小组后再试。
          </p>
        </div>
      </section>
    );

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-950">前台账号管理</h2>
          <p className="mt-1 text-sm text-slate-600">
            管理“{groupName}”内前台接粉、前台炒群和前台专家的账号与登录状态。
          </p>
        </div>
        <button
          type="button"
          onClick={() => openDrawer("new")}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus size={17} weight="bold" aria-hidden="true" />
          添加前台账号
        </button>
      </div>
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
        <Info
          size={20}
          weight="fill"
          className="mt-0.5 shrink-0 text-blue-600"
          aria-hidden="true"
        />
        <p>
          本组前台账号只分为接粉、炒群、专家三个岗位；所属小组由系统固定。
        </p>
      </div>
      {notice && (
        <p
          role="status"
          className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {notice}
        </p>
      )}
      {loadError ? (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => void loadMembers()}
            className="rounded border border-red-300 px-3 py-1.5 font-medium"
          >
            重新加载
          </button>
        </div>
      ) : null}
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <input
          aria-label="搜索前台账号"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索姓名或账号"
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
      {loading ? (
        <div className="border border-slate-200 bg-white px-6 py-14 text-center text-sm text-slate-500">
          正在加载前台账号…
        </div>
      ) : (
        <LeadMemberTable members={filtered} onEdit={openDrawer} />
      )}
      {!loading && (
        <p className="mt-3 text-sm text-slate-500">
          共 {filtered.length} 个前台账号
        </p>
      )}
      {!loading && <CollaborationSettings members={members} />}
      {drawer && (
        <LeadMemberDrawer
          member={selected}
          groupName={groupName}
          onClose={() => setDrawer(null)}
          onSave={save}
          onAction={action}
        />
      )}
    </section>
  );
}
