"use client";

import { useState } from "react";
import type { Confirm } from "./ConfirmDialog";
import { Modal } from "./Modal";
import { ROLE_META, type Role } from "./AppShell";
import { IconBell, IconCheck, IconSend } from "./Icons";
import {
  MY_DEPARTMENT, MY_TEAM_GROUP, TODAY,
  buildDailyTakeaway, computeOrderedSummaryColumns, money, parseRatePercent,
  type Company, type Department, type Member, type Notice, type NoticeScope, type SummaryColumn, type TeamGroup,
} from "@/lib/mock-data";

const MONTH_START = `${TODAY.slice(0, 7)}-01`;

/** 这个原型里各角色演示身份固定绑定的组织节点——跟 app/page.tsx 里 deptTeamGroups/
 *  companyDepartments 的过滤条件（"部门管理员在这个原型里永远绑定 dep-1"）用的是
 *  同一套硬编码，不是另起一套判断口径。德国一组的 id 优先从传入的 teamGroups 里找
 *  hasDetailData 的那条（跟 TabGroupLeadership 拿"我的组"的方式一样），找不到才退回
 *  写死的 tg-1。 */
const MY_GROUP_FALLBACK_ID = "tg-1";
const MY_DEPARTMENT_ID = "dep-1";
const MY_COMPANY_ID = "co-1";

type ScopeOption = { key: string; scope: NoticeScope; scopeTargetId: string | null; scopeLabel: string; label: string };

/** LEAD 不走这个函数——组长发通知没有范围选择器，永远是"仅本组"，在提交时直接写死。 */
function scopeOptionsFor(
  role: Role, deptTeamGroups: TeamGroup[], companyDepartments: Department[], companies: Company[],
): ScopeOption[] {
  if (role === "DEPT_MANAGER") {
    return [
      { key: "DEPARTMENT", scope: "DEPARTMENT", scopeTargetId: MY_DEPARTMENT_ID, scopeLabel: MY_DEPARTMENT, label: `全部门（${MY_DEPARTMENT}）` },
      ...deptTeamGroups.map((g) => ({ key: `GROUP:${g.id}`, scope: "GROUP" as const, scopeTargetId: g.id, scopeLabel: g.name, label: `仅 ${g.name}` })),
    ];
  }
  if (role === "COMPANY_MANAGER") {
    const companyName = companies.find((c) => c.id === MY_COMPANY_ID)?.name ?? MY_COMPANY_ID;
    return [
      { key: "COMPANY", scope: "COMPANY", scopeTargetId: MY_COMPANY_ID, scopeLabel: companyName, label: `全公司（${companyName}）` },
      ...companyDepartments.map((d) => ({ key: `DEPARTMENT:${d.id}`, scope: "DEPARTMENT" as const, scopeTargetId: d.id, scopeLabel: d.name, label: `仅 ${d.name}` })),
    ];
  }
  if (role === "HQ_MANAGER") {
    return [
      { key: "ALL", scope: "ALL", scopeTargetId: null, scopeLabel: "全总公司", label: "全总公司" },
      ...companies.map((c) => ({ key: `COMPANY:${c.id}`, scope: "COMPANY" as const, scopeTargetId: c.id, scopeLabel: c.name, label: `仅 ${c.name}` })),
    ];
  }
  return [];
}

/** 可见性——"下钻广播"：一条通知只有 scope 对应那一层管理员本人 + scope 往下嵌套的
 *  角色看得到，不会向上冒泡、也不会平移到同级其它分支。GROUP 是链条最底层，只有
 *  组长看得到；即便是部门管理员自己发的部门通知，部门管理员本人也不会出现在收件箱
 *  （这里只按角色+scope判断，不检查是不是自己发的，效果是一样的：公告类页面本来
 *  就不做"我发的也进我收件箱"这种事）。 */
function isVisibleTo(n: Notice, role: Role, myGroupId: string): boolean {
  switch (n.scope) {
    case "ALL":
      return true;
    case "COMPANY":
      return n.scopeTargetId === MY_COMPANY_ID && (role === "COMPANY_MANAGER" || role === "DEPT_MANAGER" || role === "LEAD");
    case "DEPARTMENT":
      return n.scopeTargetId === MY_DEPARTMENT_ID && (role === "DEPT_MANAGER" || role === "LEAD");
    case "GROUP":
      return n.scopeTargetId === myGroupId && role === "LEAD";
    default:
      return false;
  }
}

function ScopeBadge({ children }: { children: React.ReactNode }) {
  return <span className="badge" data-tone="mute">{children}</span>;
}

function MetricRow({
  label, value, rate, flag,
}: { label: string; value: React.ReactNode; rate?: string; flag?: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", justifyContent: "space-between",
      padding: "7px 0", borderBottom: "1px solid var(--line)", fontSize: 13.5,
    }}>
      <span style={{ color: "var(--ink-2)" }}>{label}</span>
      <span className="tnum" style={{ fontWeight: 600, color: flag ? "var(--bad)" : "var(--ink)" }}>
        {value}
        {rate ? (
          <span style={{ marginLeft: 6, fontSize: 12, fontWeight: flag ? 700 : 400, color: flag ? "var(--bad)" : "var(--ink-3)" }}>
            ({rate})
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** 今日/本月累计 各占一栏——异常退群这一行如果"今日"比"本月累计"的均值明显偏高
 *  （≥1.5倍），标红提醒；净业绩是这一栏的收尾数字，加粗放大、按正负着色，跟
 *  SummaryTable 净业绩那一行的配色规则一致（正数 --ok，负数 --bad）。 */
function ReportSection({
  label, col, baselineAbnormalRate,
}: { label: string; col: SummaryColumn; baselineAbnormalRate: number | null }) {
  const abnormalRate = parseRatePercent(col.leftAbnormalRate);
  const flagAbnormal = baselineAbnormalRate !== null && baselineAbnormalRate > 0
    && abnormalRate !== null && abnormalRate >= baselineAbnormalRate * 1.5;
  const net = col.netUsd ?? 0;

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 12.5, fontWeight: 700, color: "var(--ink-3)", letterSpacing: "0.02em" }}>
        {label}
      </p>
      <MetricRow label="添加数据" value={col.added ?? "—"} />
      <MetricRow label="进群" value={col.joined ?? "—"} rate={col.joinedRate} />
      <MetricRow label="异常退群" value={col.leftAbnormal ?? "—"} rate={col.leftAbnormalRate} flag={flagAbnormal} />
      <MetricRow label="推专家" value={col.pushed} />
      <MetricRow label="开单" value={col.ordered} />
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", paddingTop: 10, marginTop: 2 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>净业绩</span>
        <span className="tnum" style={{ fontSize: 19, fontWeight: 800, color: net >= 0 ? "var(--ok)" : "var(--bad)" }}>
          {net >= 0 ? "" : "-"}{money(Math.abs(net))}
        </span>
      </div>
    </div>
  );
}

/** 今日日报预览——需求文档 6.5：组内"当日数据 + 累计汇总"两段，按当地下班时间推送。
 *  这版原型没有真实的定时推送通道，只做"按需预览"：数字实时从 computeOrderedSummaryColumns
 *  取，跟数据汇总页面同一份底层数据，不会对不上；AI 要点提炼是规则引擎生成的一句话
 *  摘要，不是真的调了大模型，页面上明确标注清楚，不能让人以为这是真收到了推送。 */
function DailyReportCard({ members }: { members: Member[] }) {
  const todayCol = computeOrderedSummaryColumns(TODAY, TODAY, members)[0];
  const monthCol = computeOrderedSummaryColumns(MONTH_START, TODAY, members)[0];
  const takeaway = buildDailyTakeaway(todayCol, monthCol);
  const monthAbnormalRate = parseRatePercent(monthCol.leftAbnormalRate);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2 className="card-title">今日日报预览</h2>
          <p className="card-note">
            {MY_TEAM_GROUP} · {TODAY} 当日数据 + 本月累计汇总——这是预览，本地演示环境不会真的推送到手机，
            需要接入真实消息通道才能做到按下班时间自动推送。
          </p>
        </div>
        <span className="badge" data-tone="mute"><IconBell size={13} />未接入推送</span>
      </div>
      <div style={{ padding: 18 }}>
        <div style={{
          padding: "12px 14px", borderRadius: "var(--radius)",
          background: "var(--accent-soft)", border: "1px solid var(--line)", marginBottom: 18,
        }}>
          <p style={{ margin: "0 0 4px", fontSize: 11.5, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.03em" }}>
            AI 要点提炼 · 基于当日数字自动生成
          </p>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7, color: "var(--ink)" }}>{takeaway}</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
          <ReportSection label="今日" col={todayCol} baselineAbnormalRate={monthAbnormalRate} />
          <ReportSection label="本月累计" col={monthCol} baselineAbnormalRate={null} />
        </div>
      </div>
    </div>
  );
}

/** 通知中心——LEAD/DEPT_MANAGER/COMPANY_MANAGER/HQ_MANAGER 四个角色共用，资源部两个
 *  账号不管人也不管组织结构，继续用 app/page.tsx 里原来的占位页，不接这个组件。
 *  发通知走这个项目统一的两步交互：Modal 填自由表单 → ConfirmDialog 二次确认才真正
 *  发送；收件箱按"下钻广播"规则过滤 notices，只显示这个角色应该看到的那些。 */
export function TabNoticeCenter({
  role, notices, members, deptTeamGroups, companyDepartments, companies,
  onSendNotice, onToast, onConfirm,
}: {
  role: Role;
  notices: Notice[];
  members: Member[];
  deptTeamGroups: TeamGroup[];
  companyDepartments: Department[];
  companies: Company[];
  onSendNotice: (draft: {
    title: string; content: string; senderName: string; senderRoleLabel: string;
    scope: NoticeScope; scopeTargetId: string | null; scopeLabel: string;
  }) => void;
  onToast: (msg: string, tone?: "ok" | "warn") => void;
  onConfirm: (c: Confirm) => void;
}) {
  const myGroupId = deptTeamGroups.find((g) => g.hasDetailData)?.id ?? MY_GROUP_FALLBACK_ID;
  const scopeOptions = scopeOptionsFor(role, deptTeamGroups, companyDepartments, companies);
  const persona = ROLE_META[role];

  const [composeOpen, setComposeOpen] = useState(false);
  const [draft, setDraft] = useState({ title: "", content: "", scopeKey: scopeOptions[0]?.key ?? "" });

  function openCompose() {
    setDraft({ title: "", content: "", scopeKey: scopeOptions[0]?.key ?? "" });
    setComposeOpen(true);
  }

  function submitCompose() {
    const title = draft.title.trim();
    const content = draft.content.trim();
    if (!title) { onToast("请填标题", "warn"); return; }
    if (!content) { onToast("请填内容", "warn"); return; }

    const picked = role === "LEAD"
      ? { scope: "GROUP" as const, scopeTargetId: myGroupId, scopeLabel: MY_TEAM_GROUP }
      : scopeOptions.find((o) => o.key === draft.scopeKey);
    if (!picked) { onToast("请选择发送范围", "warn"); return; }

    onConfirm({
      title: "确认发送通知", confirmLabel: "确认发送", target: title,
      desc: `发送范围：${picked.scopeLabel}。发送后会出现在范围内所有人的通知中心，演示环境不会真的推送到任何人的设备。`,
      onConfirm: () => {
        onSendNotice({
          title, content, senderName: persona.name, senderRoleLabel: persona.title,
          scope: picked.scope, scopeTargetId: picked.scopeTargetId, scopeLabel: picked.scopeLabel,
        });
        setComposeOpen(false);
      },
    });
  }

  const visibleNotices = notices.filter((n) => isVisibleTo(n, role, myGroupId));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {role === "LEAD" ? <DailyReportCard members={members} /> : null}

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">通知中心</h2>
            <p className="card-note">
              {role === "LEAD"
                ? `发给本组的通知，范围固定是 ${MY_TEAM_GROUP}；下面收件箱显示发给你能看到的范围的通知。`
                : "发给指定范围人员的公告，下面收件箱只显示发给你能看到的范围的通知——往下嵌套的范围能看到，同级、上级看不到。"}
            </p>
          </div>
          <button className="btn" data-size="sm" data-variant="primary" onClick={openCompose}>
            <IconSend size={13} />发通知
          </button>
        </div>
        <div style={{ padding: visibleNotices.length ? 0 : "40px 0", textAlign: visibleNotices.length ? undefined : "center", color: "var(--ink-3)", fontSize: 13.5 }}>
          {visibleNotices.length ? visibleNotices.map((n) => (
            <div key={n.id} style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <strong style={{ fontSize: 14 }}>{n.title}</strong>
                  <ScopeBadge>{n.scopeLabel}</ScopeBadge>
                </div>
                <span style={{ fontSize: 12, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
                  {n.senderName} · {n.senderRoleLabel} · {n.createdAt}
                </span>
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6 }}>{n.content}</p>
            </div>
          )) : "暂无收到的通知"}
        </div>
      </div>

      <Modal open={composeOpen} onClose={() => setComposeOpen(false)} title="发通知" note="填好之后还需要再确认一步才会真正发送。">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {role === "LEAD" ? (
            <div>
              <label className="label">发送范围</label>
              <p style={{ margin: 0, fontSize: 13.5 }}>{MY_TEAM_GROUP}（组内通知，固定范围）</p>
            </div>
          ) : (
            <div>
              <label className="label">发送范围 *</label>
              <select className="field" style={{ width: "100%" }}
                value={draft.scopeKey} onChange={(e) => setDraft({ ...draft, scopeKey: e.target.value })}>
                {scopeOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label">标题 *</label>
            <input className="field" style={{ width: "100%" }} placeholder="必填"
              value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <div>
            <label className="label">内容 *</label>
            <textarea
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              placeholder="必填"
              rows={4}
              style={{
                width: "100%", padding: "9px 11px", resize: "vertical",
                border: "1px solid var(--line-strong)", borderRadius: "var(--radius)",
                fontSize: 13.5, outline: "none",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => setComposeOpen(false)}>取消</button>
            <button className="btn" data-variant="primary" onClick={submitCompose}>
              <IconCheck size={15} />提交
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
