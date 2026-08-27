"use client";

import { useEffect, useMemo, useState } from "react";
import type { LeadMember } from "./LeadMemberTable";
import { WorkflowConfirmationDialog, type WorkflowConfirmation } from "../ui/WorkflowConfirmationDialog";

type Assignment = { groupOperatorId: string; receptionistId: string };

export function CollaborationSettings({ members }: { members: LeadMember[] }) {
  const operators = useMemo(
    () =>
      members.filter(
        (member) => member.active && member.role === "GROUP_OPERATOR",
      ),
    [members],
  );
  const receptionists = useMemo(
    () =>
      members.filter(
        (member) =>
          member.active && member.role === "RECEPTION",
      ),
    [members],
  );
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [operatorId, setOperatorId] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<WorkflowConfirmation | null>(null);

  useEffect(() => {
    if (!operators.some((operator) => operator.id === operatorId))
      setOperatorId(operators[0]?.id ?? "");
  }, [operatorId, operators]);
  useEffect(() => {
    void fetch("/api/lead/collaborations")
      .then(async (response) =>
        response.ok ? response.json() : Promise.reject(),
      )
      .then((payload: { assignments: Assignment[] }) =>
        setAssignments(payload.assignments),
      )
      .catch(() => setNotice("配合关系加载失败，请刷新后重试"));
  }, []);

  const selected = new Set(
    assignments
      .filter((item) => item.groupOperatorId === operatorId)
      .map((item) => item.receptionistId),
  );
  function toggle(receptionistId: string) {
    setAssignments((current) =>
      selected.has(receptionistId)
        ? current.filter(
            (item) =>
              item.groupOperatorId !== operatorId ||
              item.receptionistId !== receptionistId,
          )
        : [
            ...current.filter(
              (item) => item.receptionistId !== receptionistId,
            ),
            { groupOperatorId: operatorId, receptionistId },
          ],
    );
  }
  async function save(): Promise<boolean> {
    if (!operatorId) return false;
    setSaving(true);
    setNotice("");
    try {
      const receptionistIds = assignments
        .filter((item) => item.groupOperatorId === operatorId)
        .map((item) => item.receptionistId);
      const response = await fetch("/api/lead/collaborations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupOperatorId: operatorId, receptionistIds }),
      });
      if (!response.ok) throw new Error();
      setNotice("已保存炒群员配合的前台接粉员");
      return true;
    } catch {
      setNotice("保存失败，请稍后重试");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function requestSave() {
    const operator = operators.find((item) => item.id === operatorId);
    const count = assignments.filter((item) => item.groupOperatorId === operatorId).length;
    setConfirmation({
      title: "确认保存配合关系？",
      description: "保存后，选中的接粉员会由这位炒群员负责承接；一个接粉员只能归属一名炒群员。",
      confirmLabel: "确认保存",
      target: `${operator?.name ?? "当前炒群员"} · ${count} 名接粉员`,
      onConfirm: async () => { if (await save()) setConfirmation(null); },
    });
  }

  return (
    <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="m-0 text-base font-bold text-slate-900">炒群配合设置</h2>
      <p className="mt-1 text-sm text-slate-500">
        一个炒群员可配合多个接粉员，但一个接粉员只能归属一名炒群员。重新勾选并保存后，会自动转给当前炒群员。
      </p>
      {!operators.length ? (
        <p className="mt-4 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          请先添加一位岗位为“前台炒群”的组员。
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            炒群员
            <select
              value={operatorId}
              onChange={(event) => setOperatorId(event.target.value)}
              className="control min-w-44"
            >
              {operators.map((operator) => (
                <option key={operator.id} value={operator.id}>
                  {operator.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            {receptionists.map((receptionist) => (
              <label
                key={receptionist.id}
                className="flex min-h-9 items-center gap-2 rounded border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700"
              >
                <input
                  type="checkbox"
                  checked={selected.has(receptionist.id)}
                  onChange={() => toggle(receptionist.id)}
                />
                {receptionist.name}
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={requestSave}
            className="min-h-9 rounded bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "保存中…" : "保存配合关系"}
          </button>
        </div>
      )}
      {notice ? (
        <p role="status" className="mt-3 text-sm text-slate-600">
          {notice}
        </p>
      ) : null}
      <WorkflowConfirmationDialog confirmation={confirmation} busy={saving} onClose={() => { if (!saving) setConfirmation(null); }} />
    </section>
  );
}
