"use client";

import { useState } from "react";
import {
  ATTRIBUTION_OWNERS, BASELINE_STAGE_META, CHANNELS, EXPERT_OWNERS, EXPERT_STAGE_ORDER, GROUP_OPERATORS, HISTORICAL_BATCH_COUNT_KEY, TODAY,
  money, nextBaselineStage,
  type BaselineStage, type DeductionRecord, type DownstreamCategory, type DownstreamLead, type ExpertStage, type HistoricalBatch,
} from "@/lib/mock-data";
import { IconCheck, IconEdit, IconPlus, IconSearch } from "./Icons";
import { ConfirmDialog, type Confirm } from "./ConfirmDialog";
import { DownstreamDrawer } from "./DownstreamDrawer";
import { FunnelPanel } from "./FunnelPanel";

const CATEGORY_META: Record<DownstreamCategory, { label: string }> = {
  inGroup: { label: "在群待推专家" },
  expertQueue: { label: "专家排队中" },
  expertWorking: { label: "专家跟进中" },
  ordered: { label: "已开单" },
  left: { label: "已退群" },
  backfilled: { label: "历史补录" },
};
const CATEGORY_ORDER: DownstreamCategory[] = ["inGroup", "expertQueue", "expertWorking", "ordered", "left", "backfilled"];

const BATCHES = ["全部我的客户", ...["2026-08-27", "2026-08-26", "2026-08-25", "2026-08-24", "2026-08-22"]
  .flatMap((d) => CHANNELS.slice(0, 2).map((c) => `${d} · ${c}`))];

/** 认领老客户——每个岗位只认领"现在正处在自己这一段"的客户，不越界碰别人岗位的状态：
 *  炒群只认领"已进群"（还没推专家、还在炒群自己手上的老粉）；未回复/已回复归接粉的"录入老客户"管；
 *  已推专家/已注册/已开单都是专家的地盘，炒群这边不出现这几个选项。 */
const CLAIM_BASELINE_STAGES: BaselineStage[] = ["JOINED"];
/** 专家这边只认领"已经推过专家"往后的基线——还没推专家的老粉不该在专家工作台认领 */
const EXPERT_CLAIM_BASELINE_STAGES: BaselineStage[] = ["INTRODUCED", "REGISTERED", "ORDERED"];

/** 专家线性阶段点错了，退回上一步用——只覆盖主链的4个纯前进阶段，排队中是第一档没有上一步，
 *  未成交/停止维护这两个侧支已经各自有专属的"恢复…"按钮了，不用这张表 */
const MAIN_CHAIN_REVERT: Partial<Record<ExpertStage, ExpertStage>> = {
  交资料: "排队中", 追踪中: "交资料", 待注册: "追踪中", 待开单: "待注册",
};

/** 某个批次里，哪些阶段真的有历史数字——没数字的阶段不该让人认领 */
function claimBaselinesFor(batch: HistoricalBatch | undefined, allowed: BaselineStage[]): BaselineStage[] {
  return allowed.filter((s) => {
    if (!batch) return false;
    const key = HISTORICAL_BATCH_COUNT_KEY[s];
    return key ? batch.counts[key] > 0 : false;
  });
}

function Chip({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 14px",
        borderRadius: 999, border: `1px solid ${active ? "var(--accent)" : "var(--line-strong)"}`,
        background: active ? "var(--accent)" : "var(--surface)",
        color: active ? "#fff" : "var(--ink-2)", fontSize: 13.5, fontWeight: 600, cursor: "pointer", flexShrink: 0,
      }}>
      {label}
      <span className="tnum" style={{
        minWidth: 20, height: 20, padding: "0 6px", borderRadius: 999,
        background: active ? "rgba(255,255,255,.22)" : "var(--surface-sunken)",
        color: active ? "#fff" : "var(--ink-2)", fontSize: 12,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}>{count}</span>
    </button>
  );
}

function InfoRow({ label, children, warn }: { label: string; children: React.ReactNode; warn?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
      <span style={{ color: "var(--ink-3)" }}>{label}</span>
      <span style={{ color: warn ? "var(--warn)" : "var(--ink)", fontWeight: warn ? 700 : 500, textAlign: "right" }}>{children}</span>
    </div>
  );
}

function MoneyCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>{label}</p>
      <p className="tnum" style={{ margin: "1px 0 0", fontSize: 13.5, fontWeight: 600 }}>{value}</p>
    </div>
  );
}

const MONEY_KIND_TONE: Record<string, "ok" | "bad"> = { 首充: "ok", 续充: "ok", 出金: "bad" };

/** 财务明细——专家/组长点"已开单"客户的这个入口，看这位客户每一笔首充/续充/出金，
 *  金额或日期录错了可以逐笔编辑（不是只能撤销最近一笔）。种子数据/历史补录没有逐笔流水，
 *  显示"—"提示只有这次真录进去的才能编辑。 */
function FinanceDrawer({
  lead, onClose, onEdit,
}: {
  lead: DownstreamLead | null;
  onClose: () => void;
  onEdit: (d: DownstreamLead, event: NonNullable<DownstreamLead["moneyEvents"]>[number]) => void;
}) {
  if (!lead) return null;
  const events = lead.moneyEvents ?? [];
  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(19,24,36,.35)", display: "flex", justifyContent: "flex-end" }}
    >
      <aside
        role="dialog" aria-modal="true"
        style={{
          width: "min(440px, 100%)", height: "100%", background: "var(--surface)",
          borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column",
          boxShadow: "-14px 0 40px rgba(19,24,36,.14)",
        }}
      >
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{lead.code} · 财务明细</h3>
            <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--ink-3)" }}>
              首充 {money(lead.depositUsd)} · 续充 {lead.continuationCount} 次 {money(lead.continuationUsd)} · 出金 {money(lead.withdrawalUsd)}
            </p>
          </div>
          <button className="btn" data-size="sm" onClick={onClose}>关闭</button>
        </header>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 20px" }}>
          {events.length ? events.map((e) => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="badge" data-tone={MONEY_KIND_TONE[e.kind]}>{e.kind}</span>
                <div>
                  <p className="tnum" style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{money(e.amountUsd)}</p>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>{e.date}</p>
                </div>
              </div>
              <button className="btn" data-size="sm" onClick={() => onEdit(lead, e)}>编辑</button>
            </div>
          )) : (
            <p style={{ padding: "20px 0", color: "var(--ink-3)", fontSize: 13.5, lineHeight: 1.6 }}>
              没有逐笔流水——这是种子数据/历史补录直接写好的合计数，没有一笔一笔的记录，暂时不支持编辑。
              之后通过"登记开单"“录入续充”“录入出金”本身产生的记录，都能在这里逐笔编辑。
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

export function TabDownstream({
  onToast, downstream, deductions, onAdvanceBackfilled, onPushToExpert, onRecallFromExpert,
  onMarkLeftGroup, onUndoLeftGroup, onMarkMisrecorded, onUndoMisrecorded, onUpdateGroupNote, onEditGroupJoinDate,
  onBeginExpertReception, onBeginExpertTracking, onMarkPendingRegistration, onMarkRegistered, onRevertExpertStage,
  onOpenOrder, onCancelOrder, onDeclineDeposit, onRecoverFromDecline, onMarkStalled, onRecoverFromStalled,
  onAddContinuation, onAddWithdrawal, onUndoLastMoneyEvent, onEditMoneyEvent,
  onUpdateExpertNote,
  historicalBatches, onBatchCreate, onClaimHistorical, canManage = false, canManageExpert = false,
}: {
  onToast?: (msg: string, tone?: "ok" | "warn") => void;
  downstream: DownstreamLead[];
  deductions: DeductionRecord[];
  /** 历史补录客户：以前拉过群的现在推专家了、以前推过专家的现在注册或开单了——推进到下一步 */
  onAdvanceBackfilled?: (id: string) => void;
  /** 正常客户（不是历史补录）：在群里聊得不错，推给专家——在群待推专家→专家排队中 */
  onPushToExpert?: (id: string, expertOwner: string) => void;
  /** 推错专家了——撤回推专家，退回「在群待推专家」。只在专家还没开始接待（还在排队中）时能撤 */
  onRecallFromExpert?: (id: string) => void;
  /** 客户退群了——已开单/历史补录不算这个范围。进群不满14天算异常退群，"我的业绩"要分开统计 */
  onMarkLeftGroup?: (id: string, date: string, reason: string) => void;
  onUndoLeftGroup?: (id: string) => void;
  /** 整条记录录错了（撞错客户、导错重复号…）——打个标留痕迹，不真的删记录，点错了能撤销 */
  onMarkMisrecorded?: (id: string, reason: string) => void;
  onUndoMisrecorded?: (id: string) => void;
  /** 炒群在任何阶段都能填一句客户情况，接粉和专家都看得到 */
  onUpdateGroupNote?: (id: string, note: string) => void;
  /** 炒群修正/补录进群日期——专家认领老客户时进群日期是按"在群天数"倒推的，不一定准 */
  onEditGroupJoinDate?: (id: string, date: string) => void;
  /** 专家阶段是线性推进的8档，每一步都有专属按钮和必填字段，不是随手一个下拉选任意档：
   *  排队中→交资料（接待日期+设备账号）→追踪中（日期）→待注册（日期）→待开单（注册日期）
   *  →已开单（首充日期+金额+方式）；待开单也能转「未成交」，已开单也能转「停止维护」，两个都可恢复。
   *  交资料/追踪中/待注册/待开单这4档还各配一个"撤回上一步"，点错了能退回去。 */
  onBeginExpertReception?: (id: string, date: string, deviceNote: string) => void;
  onBeginExpertTracking?: (id: string, date: string) => void;
  onMarkPendingRegistration?: (id: string, date: string) => void;
  onMarkRegistered?: (id: string, date: string) => void;
  onRevertExpertStage?: (id: string, stage: ExpertStage) => void;
  onOpenOrder?: (id: string, date: string, amountUsd: number, method: string) => void;
  /** 登记开单点错了——把首充金额冲正，退回「待开单」。只对种子数据没有的、这次真录进去的那一笔生效 */
  onCancelOrder?: (id: string) => void;
  onDeclineDeposit?: (id: string, reason: string, note: string) => void;
  onRecoverFromDecline?: (id: string) => void;
  onMarkStalled?: (id: string, reason: string, note: string) => void;
  onRecoverFromStalled?: (id: string) => void;
  /** 已开单/停止维护之后，一笔一笔录续充、出金；只支持撤销最近一笔 */
  onAddContinuation?: (id: string, date: string, amountUsd: number) => void;
  onAddWithdrawal?: (id: string, date: string, amountUsd: number) => void;
  onUndoLastMoneyEvent?: (id: string) => void;
  /** 财务明细弹窗里改某一笔流水的金额/日期——专家/组长发现录错了用，按差额冲正，不是整条覆盖 */
  onEditMoneyEvent?: (id: string, eventId: string, amountUsd: number, date: string) => void;
  /** 专家在任何阶段都能填一句专家情况，接粉和炒群都看得到 */
  onUpdateExpertNote?: (id: string, note: string) => void;
  /** 现有的历史汇总批次（没有号码、只有汇总数字的老账） */
  historicalBatches: HistoricalBatch[];
  /** 认领老客户时顺手新建一个批次 */
  onBatchCreate: (batch: HistoricalBatch) => void;
  /** 认领"以前就已经在群里/推过专家"的老客户——炒群或专家的动作，不经过接粉。
   *  炒群认领时 groupOperator/expertOwner 都不用传，组件自己按角色补默认值。
   *  viaExpertWorkspace=true 时（专家认领），认领结果要落进真实的 ExpertStage 状态机
   *  （排队中/待开单/已开单），而不是走炒群那套"历史补录+标记下一步"的旧流程——
   *  这样认领完就能直接用正常的操作按钮（开始接待/登记开单/财务明细…）继续跟进。
   *  已开单的话，firstChargeAmount/firstChargeDate/continuations 会写成真实的财务流水。 */
  onClaimHistorical: (input: {
    phone: string; name: string; email: string; amountUsd: number | null; platform: string;
    channel: string; sourceDate: string; note: string;
    attributionOwner: string; baseline: BaselineStage; batchId: string; daysInGroup: number;
    groupOperator?: string; expertOwner?: string; viaExpertWorkspace?: boolean;
    stageEventDate?: string;
    firstChargeAmount?: number; firstChargeDate?: string;
    continuations?: Array<{ amountUsd: number; date: string }>;
  }) => void;
  /** 这一页是不是炒群自己在操作——true 才显示"认领老客户"和"标记：下一步"这些写操作；
   *  接粉工作台里嵌的这一页永远是 false，保持"只能看不能改" */
  canManage?: boolean;
  /** 这一页是不是专家自己在操作——true 才显示"开始跟进"、专家情况才能编辑 */
  canManageExpert?: boolean;
}) {
  const [batch, setBatch] = useState(BATCHES[0]);
  const [filter, setFilter] = useState<DownstreamCategory | "all">("all");
  const [expertStageFilter, setExpertStageFilter] = useState<ExpertStage | "all">("all");
  const [search, setSearch] = useState("");
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [financeDrawerId, setFinanceDrawerId] = useState<string | null>(null);
  // 都存 id、从 downstream 实时找——存整个对象快照的话，弹窗开着的时候编辑了数据，drawer 里还是旧的
  const drawer = drawerId ? downstream.find((x) => x.id === drawerId) ?? null : null;
  const financeDrawer = financeDrawerId ? downstream.find((x) => x.id === financeDrawerId) ?? null : null;
  const [showFunnel, setShowFunnel] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editingExpertNote, setEditingExpertNote] = useState<string | null>(null);

  function askPushToExpert(d: DownstreamLead) {
    setConfirm({
      title: "推给专家？", confirmLabel: "确认推专家", target: `${d.code}`,
      desc: "选一个专家，客户会从「在群待推专家」进入「专家排队中」，交给专家跟进。",
      kindLabel: "推给哪位专家", kindOptions: EXPERT_OWNERS.map((o) => ({ value: o, label: o })),
      onConfirm: (_reason, _num, expert) => {
        onPushToExpert?.(d.id, expert ?? EXPERT_OWNERS[0]);
        setConfirm(null);
      },
    });
  }

  /** 推错专家了——退回「在群待推专家」，只在专家还没开始接待时能撤 */
  function askRecallFromExpert(d: DownstreamLead) {
    setConfirm({
      title: "撤回推专家", confirmLabel: "确认撤回", target: `${d.code}`, danger: true,
      desc: "客户还在排队中、专家还没开始接待，可以撤回改推给别的专家。仅用于推错人的情况。",
      onConfirm: () => { onRecallFromExpert?.(d.id); setConfirm(null); },
    });
  }

  /** 客户退群了——按退群日期跟进群日期算天数，不满14天算异常退群 */
  function askMarkLeftGroup(d: DownstreamLead) {
    setConfirm({
      title: "标记退群", confirmLabel: "确认标记", target: `${d.code}`, danger: true,
      desc: "客户退群了，转入「已退群」。进群不满14天退的算异常退群，满14天算正常退群，系统自动判断。",
      dateLabel: "退群日期", defaultDate: TODAY,
      reasonLabel: "退群原因（选填）", reasonRequired: false,
      onConfirm: (reason, _num, _kind, date) => {
        onMarkLeftGroup?.(d.id, date ?? TODAY, reason);
        setConfirm(null);
      },
    });
  }

  /** 标记退群点错了——恢复到退群前的状态 */
  function askUndoLeftGroup(d: DownstreamLead) {
    setConfirm({
      title: "撤销退群标记", confirmLabel: "确认撤销", target: `${d.code}`, danger: true,
      desc: "把客户恢复到退群前的状态。仅用于标记退群本身点错了的情况。",
      onConfirm: () => { onUndoLeftGroup?.(d.id); setConfirm(null); },
    });
  }

  /** 整条记录录错了——留痕迹标记，不真的删掉；必须填原因，方便以后核对 */
  function askMarkMisrecorded(d: DownstreamLead) {
    setConfirm({
      title: "标记误录", confirmLabel: "确认标记", target: `${d.code}`, danger: true,
      desc: "这条记录会标成误录，留痕但不影响其它人查看历史；不会真的删掉这条记录。",
      reasonLabel: "误录原因", reasonPlaceholder: "比如：撞错客户、导错重复号",
      onConfirm: (reason) => { onMarkMisrecorded?.(d.id, reason); setConfirm(null); },
    });
  }

  /** 标记误录点错了——撤销 */
  function askUndoMisrecorded(d: DownstreamLead) {
    setConfirm({
      title: "撤销误录标记", confirmLabel: "确认撤销", target: `${d.code}`, danger: true,
      desc: "把这条记录恢复成正常状态。仅用于标记误录本身点错了的情况。",
      onConfirm: () => { onUndoMisrecorded?.(d.id); setConfirm(null); },
    });
  }

  /** 排队中→交资料：专家用自己的设备账号开始接待，日期和设备号都是必填 */
  function askBeginReception(d: DownstreamLead) {
    setConfirm({
      title: "开始接待", confirmLabel: "确认开始接待", target: `${d.code}`,
      desc: "专家已经用自己的设备账号接待这位客户，转入「交资料」。",
      dateLabel: "实际接待日期", defaultDate: TODAY,
      reasonLabel: "专家设备账号", reasonPlaceholder: "填写用来接待这位客户的设备账号",
      onConfirm: (reason, _num, _kind, date) => {
        onBeginExpertReception?.(d.id, date ?? TODAY, reason);
        setConfirm(null);
      },
    });
  }

  /** 交资料→追踪中 */
  function askBeginTracking(d: DownstreamLead) {
    setConfirm({
      title: "资料已交 · 开始追踪", confirmLabel: "确认", target: `${d.code}`,
      desc: "客户已经提交注册资料，转入「追踪中」。",
      dateLabel: "实际交资料日期", defaultDate: TODAY,
      onConfirm: (_reason, _num, _kind, date) => {
        onBeginExpertTracking?.(d.id, date ?? TODAY);
        setConfirm(null);
      },
    });
  }

  /** 追踪中→待注册 */
  function askMarkPendingRegistration(d: DownstreamLead) {
    setConfirm({
      title: "转为待注册", confirmLabel: "确认", target: `${d.code}`,
      desc: "追踪有进展，客户准备注册，转入「待注册」。",
      dateLabel: "日期", defaultDate: TODAY,
      onConfirm: (_reason, _num, _kind, date) => {
        onMarkPendingRegistration?.(d.id, date ?? TODAY);
        setConfirm(null);
      },
    });
  }

  /** 待注册→待开单：客户完成注册 */
  function askMarkRegistered(d: DownstreamLead) {
    setConfirm({
      title: "标记已注册", confirmLabel: "确认", target: `${d.code}`,
      desc: "客户已完成注册，转入「待开单」。",
      dateLabel: "实际注册日期", defaultDate: TODAY,
      onConfirm: (_reason, _num, _kind, date) => {
        onMarkRegistered?.(d.id, date ?? TODAY);
        setConfirm(null);
      },
    });
  }

  /** 交资料/追踪中/待注册/待开单点错了——退回上一步，通用一个弹窗，目标阶段从 MAIN_CHAIN_REVERT 查 */
  function askRevertStage(d: DownstreamLead) {
    const prev = MAIN_CHAIN_REVERT[d.expertStage as ExpertStage];
    if (!prev) return;
    setConfirm({
      title: "撤回上一步", confirmLabel: "确认撤回", target: `${d.code}`, danger: true,
      desc: `把客户从「${d.expertStage}」退回「${prev}」，仅用于这一步点错了的情况。`,
      onConfirm: () => { onRevertExpertStage?.(d.id, prev); setConfirm(null); },
    });
  }

  /** 待开单→已开单：登记首充日期、金额、方式 */
  function askOpenOrder(d: DownstreamLead) {
    setConfirm({
      title: "登记开单", confirmLabel: "确认开单", target: `${d.code}`,
      desc: "客户已完成首充，登记开单，转入「已开单」。",
      dateLabel: "首充日期", defaultDate: TODAY,
      numberLabel: "首充金额（USD）",
      kindLabel: "充值方式", kindOptions: [{ value: "CRYPTO", label: "加密货币" }, { value: "BANK", label: "银行卡" }],
      onConfirm: (_reason, num, kind, date) => {
        onOpenOrder?.(d.id, date ?? TODAY, num ?? 0, kind ?? "CRYPTO");
        setConfirm(null);
      },
    });
  }

  /** 登记开单点错了——把首充金额冲正，退回「待开单」 */
  function askCancelOrder(d: DownstreamLead) {
    const firstDeposit = [...(d.moneyEvents ?? [])].reverse().find((e) => e.kind === "首充");
    setConfirm({
      title: "撤销开单", confirmLabel: "确认撤销", target: `${d.code}`, danger: true,
      desc: `会把首充 $${firstDeposit?.amountUsd ?? 0} 从业绩里冲正，客户退回「待开单」。仅用于登记开单本身填错了的情况。`,
      onConfirm: () => { onCancelOrder?.(d.id); setConfirm(null); },
    });
  }

  const DECLINE_REASONS = ["资金暂时紧张", "对平台/流程存疑", "另有考虑", "暂时联系不上", "其他"];
  /** 待开单→未成交（可恢复） */
  function askDeclineDeposit(d: DownstreamLead) {
    setConfirm({
      title: "标记不首充", confirmLabel: "确认标记", target: `${d.code}`,
      desc: "客户暂时不愿首充，转入「未成交」，之后愿意了可以恢复跟进。",
      kindLabel: "原因", kindOptions: DECLINE_REASONS.map((r) => ({ value: r, label: r })),
      reasonLabel: "补充说明（选填）", reasonRequired: false,
      onConfirm: (reason, _num, kind) => {
        onDeclineDeposit?.(d.id, kind ?? DECLINE_REASONS[0], reason);
        setConfirm(null);
      },
    });
  }

  /** 未成交→待开单 */
  function askRecoverFromDecline(d: DownstreamLead) {
    setConfirm({
      title: "恢复首充跟进", confirmLabel: "确认恢复", target: `${d.code}`,
      desc: "客户回心转意了，转回「待开单」继续跟进首充。",
      onConfirm: () => { onRecoverFromDecline?.(d.id); setConfirm(null); },
    });
  }

  const STALL_REASONS = ["多次催促无回应", "客户明确表示不再充值", "长期失联", "其他"];
  /** 已开单→停止维护（可恢复） */
  function askMarkStalled(d: DownstreamLead) {
    setConfirm({
      title: "标记停止维护", confirmLabel: "确认标记", target: `${d.code}`,
      desc: "已开单客户续充卡住推不动了，转入「停止维护」，之后有进展可以恢复。",
      kindLabel: "原因", kindOptions: STALL_REASONS.map((r) => ({ value: r, label: r })),
      reasonLabel: "补充说明（选填）", reasonRequired: false,
      onConfirm: (reason, _num, kind) => {
        onMarkStalled?.(d.id, kind ?? STALL_REASONS[0], reason);
        setConfirm(null);
      },
    });
  }

  /** 停止维护→已开单 */
  function askRecoverFromStalled(d: DownstreamLead) {
    setConfirm({
      title: "恢复跟进", confirmLabel: "确认恢复", target: `${d.code}`,
      desc: "客户又有进展了，转回「已开单」继续跟进续充。",
      onConfirm: () => { onRecoverFromStalled?.(d.id); setConfirm(null); },
    });
  }

  /** 已开单/停止维护之后，一笔一笔记续充 */
  function askAddContinuation(d: DownstreamLead) {
    setConfirm({
      title: "录入续充", confirmLabel: "确认录入", target: `${d.code}`,
      desc: "记一笔续充金额，会计入这位客户的续充合计和净业绩。",
      dateLabel: "续充日期", defaultDate: TODAY,
      numberLabel: "续充金额（USD）",
      onConfirm: (_reason, num, _kind, date) => {
        onAddContinuation?.(d.id, date ?? TODAY, num ?? 0);
        setConfirm(null);
      },
    });
  }

  /** 已开单/停止维护之后，一笔一笔记出金 */
  function askAddWithdrawal(d: DownstreamLead) {
    setConfirm({
      title: "录入出金", confirmLabel: "确认录入", target: `${d.code}`,
      desc: "记一笔出金金额，会从净业绩里扣除。",
      dateLabel: "出金日期", defaultDate: TODAY,
      numberLabel: "出金金额（USD）",
      onConfirm: (_reason, num, _kind, date) => {
        onAddWithdrawal?.(d.id, date ?? TODAY, num ?? 0);
        setConfirm(null);
      },
    });
  }

  /** 续充/出金最近一笔录错了——快捷撤销最近一笔；首充走"撤销开单"那条路，不算在这里面。
   *  想改任意一笔（不只是最近一笔），去"财务明细"弹窗里逐笔编辑 */
  function askUndoLastMoneyEvent(d: DownstreamLead) {
    const moneyOnly = (d.moneyEvents ?? []).filter((e) => e.kind !== "首充");
    const last = moneyOnly[moneyOnly.length - 1];
    if (!last) return;
    setConfirm({
      title: `撤销最近一笔${last.kind}`, confirmLabel: "确认撤销", target: `${d.code}`, danger: true,
      desc: `会把 ${last.date} 录入的这笔${last.kind} $${last.amountUsd} 冲正。`,
      onConfirm: () => { onUndoLastMoneyEvent?.(d.id); setConfirm(null); },
    });
  }

  /** 财务明细弹窗里点"编辑"——改这一笔的金额和日期，走二次确认弹窗 */
  function askEditMoneyEvent(d: DownstreamLead, event: NonNullable<DownstreamLead["moneyEvents"]>[number]) {
    setConfirm({
      title: `编辑这笔${event.kind}记录`, confirmLabel: "保存修改", target: `${d.code}`, danger: true,
      desc: `修改这笔${event.kind}记录的金额和日期，保存后立刻影响这位客户的资金合计，请仔细核对。`,
      dateLabel: "日期", defaultDate: event.date,
      numberLabel: `${event.kind}金额（USD）`, defaultNumber: String(event.amountUsd),
      onConfirm: (_reason, num, _kind, date) => {
        onEditMoneyEvent?.(d.id, event.id, num ?? event.amountUsd, date ?? event.date);
        setConfirm(null);
      },
    });
  }
  /** 炒群修正/补录进群日期——专家认领来的老客户，进群日期是倒推的，不一定准 */
  function askEditGroupJoinDate(d: DownstreamLead) {
    setConfirm({
      title: "编辑进群日期", confirmLabel: "保存修改", target: `${d.code}`, danger: true,
      desc: "修改这位客户的进群日期，保存后会重新计算「进群第 N 天」，也会影响客户漏斗数据里的进群统计，请仔细核对。",
      dateLabel: "进群日期", defaultDate: d.groupJoinDate ?? TODAY,
      onConfirm: (_reason, _num, _kind, date) => {
        if (date) onEditGroupJoinDate?.(d.id, date);
        setConfirm(null);
      },
    });
  }
  const [claimDraft, setClaimDraft] = useState<{
    phone: string; name: string; email: string; amountUsd: string; platform: string;
    channel: string; sourceDate: string; note: string;
    attributionOwner: string; baseline: BaselineStage; batchId: string; daysInGroup: string;
    groupOperator: string;
    /** 这个基线阶段本身是什么时候发生的（推专家/注册）——留空按今天算，来源日期不能代替它，
     *  老客户认领的时间点跟批次原始来源日期往往差很多天 */
    stageEventDate: string;
    /** 专家认领"已开单"的老客户才用得到——首充金额/日期，续充可以一笔一笔加 */
    firstChargeAmount: string; firstChargeDate: string;
    continuations: Array<{ id: string; amount: string; date: string }>;
  } | null>(null);
  /** 谁能认领、能认领到哪些基线阶段——炒群只能认领"已进群"这一档（自己岗位的状态），专家能认领"已推专家"往后的3档 */
  const claimableStages = canManageExpert ? EXPERT_CLAIM_BASELINE_STAGES : CLAIM_BASELINE_STAGES;
  const [newBatchDraft, setNewBatchDraft] = useState<{
    channel: string; batchDate: string; label: string;
    fans: string; replied: string; joined: string; introduced: string; registered: string; ordered: string;
  } | null>(null);

  let rows = downstream;
  if (batch !== BATCHES[0]) {
    const [d, c] = batch.split(" · ");
    rows = rows.filter((r) => r.sourceDate === d && r.channel === c);
  }
  const counts = CATEGORY_ORDER.reduce((acc, c) => {
    acc[c] = rows.filter((r) => r.category === c).length;
    return acc;
  }, {} as Record<DownstreamCategory, number>);
  const expertStageCounts = EXPERT_STAGE_ORDER.reduce((acc, s) => {
    acc[s] = rows.filter((r) => r.expertStage === s).length;
    return acc;
  }, {} as Record<ExpertStage, number>);
  let filtered = canManageExpert
    ? (expertStageFilter === "all" ? rows : rows.filter((r) => r.expertStage === expertStageFilter))
    : (filter === "all" ? rows : rows.filter((r) => r.category === filter));
  const q = search.replace(/\s/g, "");
  if (q) filtered = filtered.filter((r) => r.code.replace(/\s/g, "").includes(q));

  // "可跟进/扣粉统计"跟chip一样，都要跟着当前选的批次走，不能选了批次这两个数字不动
  const canFollow = rows.filter((d) => d.category !== "ordered").length;
  const deductionsInBatch = batch === BATCHES[0]
    ? deductions
    : deductions.filter((d) => d.date === batch.split(" · ")[0] && d.channel === batch.split(" · ")[1]);
  // deductionsInBatch.length 数的是"报了几次"（登记记录条数），不是被扣了几个粉——
  // 一条记录里 dup/low/noWs 是三个数字，真要统计"扣了多少位"得把这三个数字加起来
  const deductedCount = deductionsInBatch.reduce((sum, d) => sum + d.dup + d.low + d.noWs, 0);

  /** 认领"以前就已经在群里"的老客户——手机号、接粉归属、炒群状态、在群天数都填了才能保存 */
  function submitClaimDraft() {
    if (!claimDraft) return;
    const phone = claimDraft.phone.trim();
    if (!phone) { onToast?.("请先填手机号", "warn"); return; }
    if (!claimDraft.batchId) { onToast?.("请先选择所属历史批次", "warn"); return; }
    const batch = historicalBatches.find((b) => b.id === claimDraft.batchId);
    if (!claimBaselinesFor(batch, claimableStages).includes(claimDraft.baseline)) {
      onToast?.("这个批次没有对应阶段的历史数字，选不了这个状态", "warn");
      return;
    }
    const needsFirstCharge = canManageExpert && claimDraft.baseline === "ORDERED";
    const firstChargeAmount = Number(claimDraft.firstChargeAmount);
    if (needsFirstCharge && (!claimDraft.firstChargeAmount || !(firstChargeAmount > 0))) {
      onToast?.("请填首充金额", "warn");
      return;
    }
    const days = Math.max(0, Number(claimDraft.daysInGroup) || 0);
    onClaimHistorical({
      phone, name: claimDraft.name.trim(), email: claimDraft.email.trim(),
      amountUsd: claimDraft.amountUsd ? Number(claimDraft.amountUsd) : null,
      platform: claimDraft.platform, channel: claimDraft.channel, sourceDate: claimDraft.sourceDate,
      note: claimDraft.note.trim(), attributionOwner: claimDraft.attributionOwner,
      baseline: claimDraft.baseline, batchId: claimDraft.batchId, daysInGroup: days,
      // 专家认领：顺手指定这个客户当时是哪位炒群带的，专家负责人就是自己；炒群认领反过来，不用传这两个
      groupOperator: canManageExpert ? claimDraft.groupOperator : undefined,
      expertOwner: canManageExpert ? EXPERT_OWNERS[0] : undefined,
      viaExpertWorkspace: canManageExpert,
      stageEventDate: claimDraft.stageEventDate || undefined,
      firstChargeAmount: needsFirstCharge ? firstChargeAmount : undefined,
      firstChargeDate: needsFirstCharge ? claimDraft.firstChargeDate : undefined,
      continuations: needsFirstCharge
        ? claimDraft.continuations
          .filter((c) => c.amount && Number(c.amount) > 0)
          .map((c) => ({ amountUsd: Number(c.amount), date: c.date }))
        : undefined,
    });
    onToast?.(`已认领 ${claimDraft.name || phone} 进客户进度`);
    setClaimDraft(null);
    setNewBatchDraft(null);
  }

  /** 新建一批历史汇总数字——没有号码，只有渠道/日期和当时的汇总数 */
  function submitNewBatch() {
    if (!newBatchDraft) return;
    const num = (s: string) => Math.max(0, Number(s) || 0);
    const newBatch: HistoricalBatch = {
      id: `batch-${Date.now()}`,
      channel: newBatchDraft.channel, batchDate: newBatchDraft.batchDate,
      label: newBatchDraft.label.trim() || undefined,
      counts: {
        fans: num(newBatchDraft.fans), replied: num(newBatchDraft.replied), joined: num(newBatchDraft.joined),
        introduced: num(newBatchDraft.introduced), registered: num(newBatchDraft.registered), ordered: num(newBatchDraft.ordered),
      },
      createdAt: TODAY,
    };
    onBatchCreate(newBatch);
    const options = claimBaselinesFor(newBatch, claimableStages);
    setClaimDraft((d) => d ? {
      ...d, batchId: newBatch.id, channel: newBatch.channel, sourceDate: newBatch.batchDate,
      baseline: options.includes(d.baseline) ? d.baseline : (options[0] ?? claimableStages[0]),
    } : d);
    setNewBatchDraft(null);
    onToast?.(`已新建批次：${newBatch.label || newBatch.channel}`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 客户漏斗数据——炒群/专家自己带的这批客户，跟接粉"我的业绩"同一套口径。折叠着，
          不占主要工作流的地方，但每个岗位都能点开看，因为大家对这份数据都有利益关系 */}
      {canManage || canManageExpert ? (
        <div>
          <button className="btn" data-size="sm" onClick={() => setShowFunnel((v) => !v)}>
            {showFunnel ? "收起客户漏斗数据" : "展开客户漏斗数据"}
          </button>
          {showFunnel ? (
            <div style={{ marginTop: 12 }}>
              <FunnelPanel
                activeLeads={[]}
                downstreamLeads={downstream.filter((d) =>
                  canManageExpert ? d.expertOwner === EXPERT_OWNERS[0] : d.groupOperator === GROUP_OPERATORS[0])}
                title={canManageExpert ? "我接待客户的漏斗数据" : "我带的群的漏斗数据"}
                note={canManageExpert
                  ? "从推专家到开单的完整漏斗，只看分到自己名下的客户"
                  : "从进群到开单的完整漏斗，只看自己带的这批客户"}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 工具栏——跟"客户回复管理"用同一套：chip裸露在画布上，筛选和统计文字靠右 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {canManageExpert ? (
          <>
            <Chip active={expertStageFilter === "all"} label="全部" count={rows.length} onClick={() => setExpertStageFilter("all")} />
            {EXPERT_STAGE_ORDER.map((s) => (
              <Chip key={s} active={expertStageFilter === s} label={s} count={expertStageCounts[s]} onClick={() => setExpertStageFilter(s)} />
            ))}
          </>
        ) : (
          <>
            <Chip active={filter === "all"} label="全部" count={rows.length} onClick={() => setFilter("all")} />
            {CATEGORY_ORDER.map((c) => (
              <Chip key={c} active={filter === c} label={CATEGORY_META[c].label} count={counts[c]} onClick={() => setFilter(c)} />
            ))}
          </>
        )}
        {canManage || canManageExpert ? (
          <button
            onClick={() => {
              if (claimDraft) { setClaimDraft(null); setNewBatchDraft(null); return; }
              const firstBatch = historicalBatches[0];
              setClaimDraft({
                phone: "", name: "", email: "", amountUsd: "", platform: "",
                channel: firstBatch?.channel ?? CHANNELS[0], sourceDate: firstBatch?.batchDate ?? TODAY, note: "",
                attributionOwner: ATTRIBUTION_OWNERS[0], baseline: claimableStages[0],
                batchId: firstBatch?.id ?? "", daysInGroup: "1", groupOperator: GROUP_OPERATORS[0],
                stageEventDate: "",
                firstChargeAmount: "", firstChargeDate: TODAY, continuations: [],
              });
            }}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px",
              borderRadius: 999, cursor: "pointer", fontSize: 13.5, fontWeight: 600,
              border: `1px solid ${claimDraft ? "var(--accent)" : "var(--line-strong)"}`,
              background: claimDraft ? "var(--accent-soft)" : "var(--surface)",
              color: claimDraft ? "var(--accent)" : "var(--ink-2)",
            }}>
            <IconPlus size={14} />认领老客户
          </button>
        ) : null}
        <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
            可跟进 <strong className="tnum" style={{ color: "var(--ink)" }}>{canFollow}</strong> 位 ·
            扣粉统计 <strong className="tnum" style={{ color: "var(--ink)" }}>{deductedCount}</strong> 位
          </span>
          <select className="field" value={batch} onChange={(e) => setBatch(e.target.value)}
            style={{ width: 200, flexShrink: 0 }} aria-label="来源批次">
            {BATCHES.map((b) => <option key={b}>{b}</option>)}
          </select>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 10, top: 8, color: "var(--ink-3)" }}><IconSearch size={17} /></span>
            <input className="field" style={{ paddingLeft: 33, width: 200 }}
              placeholder="搜手机号" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {/* 认领老客户——系统启用前就已经在群里/推过专家的老粉，炒群或专家自己认领，不经过接粉 */}
      {(canManage || canManageExpert) && claimDraft ? (() => {
        const selectedBatch = historicalBatches.find((b) => b.id === claimDraft.batchId);
        const availableBaselines = claimBaselinesFor(selectedBatch, claimableStages);
        return (
        <div style={{
          border: "1.5px dashed var(--accent)", borderRadius: "var(--radius-lg)",
          background: "var(--accent-soft)", padding: 14,
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 20, height: 20, borderRadius: 999, background: "var(--accent)",
              color: "#fff", fontSize: 12, fontWeight: 700, flexShrink: 0,
            }}>+</span>
            <strong style={{ fontSize: 13.5 }}>认领老客户</strong>
            <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
              {canManageExpert
                ? "系统启用前就已经推过专家的老客户，认领之后不重算旧进度，只算认领后新发生的"
                : "系统启用前就已经在群里的老粉，认领之后不重算旧进度，只算认领后新发生的"}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
            <div style={{ minWidth: 320, flex: 1 }}>
              <label className="label">所属历史批次 *</label>
              <select className="field" style={{ width: "100%" }}
                value={claimDraft.batchId}
                onChange={(e) => {
                  const b = historicalBatches.find((x) => x.id === e.target.value);
                  const options = claimBaselinesFor(b, claimableStages);
                  setClaimDraft({
                    ...claimDraft, batchId: e.target.value,
                    channel: b?.channel ?? claimDraft.channel, sourceDate: b?.batchDate ?? claimDraft.sourceDate,
                    baseline: options.includes(claimDraft.baseline) ? claimDraft.baseline : (options[0] ?? claimableStages[0]),
                  });
                }}>
                <option value="">请选择</option>
                {historicalBatches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {(b.label ? `${b.label} · ` : "") + `${b.channel} · ${b.batchDate} · 粉${b.counts.fans}/回复${b.counts.replied}/进群${b.counts.joined}/推专家${b.counts.introduced}/注册${b.counts.registered}/开单${b.counts.ordered}`}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn" onClick={() => setNewBatchDraft(
              newBatchDraft ? null : { channel: CHANNELS[0], batchDate: TODAY, label: "", fans: "", replied: "", joined: "", introduced: "", registered: "", ordered: "" },
            )}>
              {newBatchDraft ? "取消新建" : "+ 新建批次"}
            </button>
          </div>

          {newBatchDraft ? (
            <div style={{
              border: "1px dashed var(--line-strong)", borderRadius: "var(--radius)",
              background: "var(--surface)", padding: 12, display: "flex", flexDirection: "column", gap: 8,
            }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10 }}>
                <div>
                  <label className="label">渠道</label>
                  <select className="field" style={{ width: "100%" }}
                    value={newBatchDraft.channel}
                    onChange={(e) => setNewBatchDraft({ ...newBatchDraft, channel: e.target.value })}>
                    {CHANNELS.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">批次日期</label>
                  <input className="field" type="date" style={{ width: "100%" }}
                    value={newBatchDraft.batchDate}
                    onChange={(e) => setNewBatchDraft({ ...newBatchDraft, batchDate: e.target.value })} />
                </div>
                <div>
                  <label className="label">批次备注（选填）</label>
                  <input className="field" style={{ width: "100%" }} placeholder="例如：黑八小组"
                    value={newBatchDraft.label}
                    onChange={(e) => setNewBatchDraft({ ...newBatchDraft, label: e.target.value })} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 10 }}>
                {([
                  ["fans", "粉"], ["replied", "回复"], ["joined", "进群"],
                  ["introduced", "推专家"], ["registered", "注册"], ["ordered", "开单"],
                ] as const).map(([k, label]) => (
                  <div key={k}>
                    <label className="label">{label}</label>
                    <input className="field" style={{ width: "100%" }} inputMode="numeric" placeholder="0"
                      value={newBatchDraft[k]}
                      onChange={(e) => setNewBatchDraft({ ...newBatchDraft, [k]: e.target.value })} />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="btn" data-variant="primary" onClick={submitNewBatch}>
                  <IconCheck size={15} />保存批次
                </button>
              </div>
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10 }}>
            <div>
              <label className="label">手机号 *</label>
              <input className="field" style={{ width: "100%" }} placeholder="必填"
                value={claimDraft.phone}
                onChange={(e) => setClaimDraft({ ...claimDraft, phone: e.target.value })} />
            </div>
            <div>
              <label className="label">姓名</label>
              <input className="field" style={{ width: "100%" }}
                value={claimDraft.name}
                onChange={(e) => setClaimDraft({ ...claimDraft, name: e.target.value })} />
            </div>
            <div>
              <label className="label">邮箱</label>
              <input className="field" style={{ width: "100%" }}
                value={claimDraft.email}
                onChange={(e) => setClaimDraft({ ...claimDraft, email: e.target.value })} />
            </div>
            <div>
              <label className="label">金额</label>
              <input className="field" style={{ width: "100%" }} inputMode="numeric"
                value={claimDraft.amountUsd}
                onChange={(e) => setClaimDraft({ ...claimDraft, amountUsd: e.target.value })} />
            </div>
            <div>
              <label className="label">平台</label>
              <input className="field" style={{ width: "100%" }}
                value={claimDraft.platform}
                onChange={(e) => setClaimDraft({ ...claimDraft, platform: e.target.value })} />
            </div>
            <div>
              <label className="label">客户情况</label>
              <input className="field" style={{ width: "100%" }} placeholder="选填一句备注"
                value={claimDraft.note}
                onChange={(e) => setClaimDraft({ ...claimDraft, note: e.target.value })} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: `repeat(${canManageExpert ? 4 : 3}, minmax(0,1fr))`, gap: 10 }}>
            <div>
              <label className="label">接粉归属 *</label>
              <select className="field" style={{ width: "100%" }}
                value={claimDraft.attributionOwner}
                onChange={(e) => setClaimDraft({ ...claimDraft, attributionOwner: e.target.value })}>
                {ATTRIBUTION_OWNERS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            {canManageExpert ? (
              <div>
                <label className="label">炒群归属 *</label>
                <select className="field" style={{ width: "100%" }}
                  value={claimDraft.groupOperator}
                  onChange={(e) => setClaimDraft({ ...claimDraft, groupOperator: e.target.value })}>
                  {GROUP_OPERATORS.map((o) => <option key={o}>{o}</option>)}
                </select>
              </div>
            ) : null}
            <div>
              <label className="label">客户阶段 *</label>
              <select className="field" style={{ width: "100%" }}
                value={claimDraft.baseline}
                disabled={availableBaselines.length <= 1}
                onChange={(e) => setClaimDraft({ ...claimDraft, baseline: e.target.value as BaselineStage })}>
                {availableBaselines.map((k) => (
                  <option key={k} value={k}>{BASELINE_STAGE_META[k].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">在群天数 *</label>
              <input className="field" style={{ width: "100%" }} inputMode="numeric" placeholder="已经在群多少天"
                value={claimDraft.daysInGroup}
                onChange={(e) => setClaimDraft({ ...claimDraft, daysInGroup: e.target.value })} />
            </div>
          </div>

          {canManageExpert && (claimDraft.baseline === "INTRODUCED" || claimDraft.baseline === "REGISTERED") ? (
            <div style={{ maxWidth: 280 }}>
              <label className="label">
                {claimDraft.baseline === "INTRODUCED" ? "推专家日期" : "注册日期"}
              </label>
              <input className="field" type="date" style={{ width: "100%" }}
                value={claimDraft.stageEventDate}
                onChange={(e) => setClaimDraft({ ...claimDraft, stageEventDate: e.target.value })} />
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
                不填默认今天——来源批次的日期不代表这一步真正发生的时间
              </p>
            </div>
          ) : null}

          {canManageExpert && claimDraft.baseline === "ORDERED" ? (
            <div style={{
              border: "1px dashed var(--line-strong)", borderRadius: "var(--radius)",
              background: "var(--surface)", padding: 12, display: "flex", flexDirection: "column", gap: 10,
            }}>
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)", fontWeight: 600 }}>
                已开单客户的首充/续充——填了之后会记成真实的财务流水，之后能在"财务明细"里逐笔编辑
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 10 }}>
                <div>
                  <label className="label">首充金额（USD）*</label>
                  <input className="field" style={{ width: "100%" }} inputMode="numeric" placeholder="必填"
                    value={claimDraft.firstChargeAmount}
                    onChange={(e) => setClaimDraft({ ...claimDraft, firstChargeAmount: e.target.value })} />
                </div>
                <div>
                  <label className="label">首充日期 *</label>
                  <input className="field" type="date" style={{ width: "100%" }}
                    value={claimDraft.firstChargeDate}
                    onChange={(e) => setClaimDraft({ ...claimDraft, firstChargeDate: e.target.value })} />
                </div>
              </div>
              {claimDraft.continuations.map((c, i) => (
                <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "flex-end" }}>
                  <div>
                    <label className="label">续充金额（USD）</label>
                    <input className="field" style={{ width: "100%" }} inputMode="numeric" placeholder={`第 ${i + 1} 笔续充`}
                      value={c.amount}
                      onChange={(e) => setClaimDraft({
                        ...claimDraft,
                        continuations: claimDraft.continuations.map((x) => x.id === c.id ? { ...x, amount: e.target.value } : x),
                      })} />
                  </div>
                  <div>
                    <label className="label">续充日期</label>
                    <input className="field" type="date" style={{ width: "100%" }}
                      value={c.date}
                      onChange={(e) => setClaimDraft({
                        ...claimDraft,
                        continuations: claimDraft.continuations.map((x) => x.id === c.id ? { ...x, date: e.target.value } : x),
                      })} />
                  </div>
                  <button className="btn" data-size="sm"
                    onClick={() => setClaimDraft({
                      ...claimDraft, continuations: claimDraft.continuations.filter((x) => x.id !== c.id),
                    })}>
                    删除
                  </button>
                </div>
              ))}
              <button className="btn" data-size="sm" style={{ alignSelf: "flex-start" }}
                onClick={() => setClaimDraft({
                  ...claimDraft,
                  continuations: [...claimDraft.continuations, { id: `claim-cont-${Date.now()}`, amount: "", date: TODAY }],
                })}>
                <IconPlus size={13} />新增续充
              </button>
            </div>
          ) : null}

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: "var(--ink-3)", flex: 1 }}>
              {canManageExpert ? (
                claimDraft.baseline === "INTRODUCED"
                  ? "落进「客户进度」· 直接进入「排队中」，可以正常点「开始接待」继续跟进"
                  : claimDraft.baseline === "REGISTERED"
                  ? "落进「客户进度」· 直接进入「待开单」，可以正常「登记开单」或「不首充」"
                  : "落进「客户进度」· 直接进入「已开单」，首充/续充都是真实流水，数据成本不计（老客户不是今天买的数据）"
              ) : (
                `落进「客户进度」· 历史补录（${BASELINE_STAGE_META[claimDraft.baseline].label}）；数据成本不计（老客户不是今天买的数据）`
              )}
            </span>
            <button className="btn" onClick={() => { setClaimDraft(null); setNewBatchDraft(null); }}>取消</button>
            <button className="btn" data-variant="primary" onClick={submitClaimDraft}>
              <IconCheck size={15} />保存
            </button>
          </div>
        </div>
        );
      })() : null}

      <div className="card" style={{ overflow: "hidden" }}>
        <div className="card-head">
          <div>
            <h2 className="card-title">客户进度</h2>
            <p className="card-note">
              {canManage
                ? "你接手的客户，现在走到哪一步了。可以认领老客户、标记进展。"
                : canManageExpert
                ? "推给你跟进的客户，现在走到哪一步了。可以认领老客户、开始跟进、填专家情况。"
                : "我交出去的客户，现在走到哪一步了。这里只能看，不能改 —— 交棒后由炒群和专家负责。"}
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="grid-table">
            <thead>
              <tr>
                <th style={{ width: 160 }}>客户</th>
                <th style={{ width: 190 }}>交接与负责人</th>
                <th style={{ width: 280 }}>最新进度</th>
                <th style={{ width: 210 }}>资金与业绩</th>
                <th style={{ width: 150, textAlign: "center" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontWeight: 700 }}>{d.code}</span>
                      {d.misrecorded ? <span className="badge" data-tone="bad">误录</span> : null}
                    </div>
                    <div style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13, marginTop: 2 }}>{d.statusPhrase}</div>
                    <div style={{ color: "var(--ink-3)", fontSize: 12, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                      {d.daysNote}
                      {canManage ? (
                        <button
                          onClick={() => askEditGroupJoinDate(d)} title="编辑进群日期"
                          style={{
                            all: "unset", cursor: "pointer", display: "inline-flex",
                            color: "var(--ink-3)", padding: 2, borderRadius: 4,
                          }}
                        >
                          <IconEdit size={11} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <InfoRow label="粉的归属">{d.attributionOwner}</InfoRow>
                      <InfoRow label="炒群负责人">{d.groupOperator}</InfoRow>
                      <InfoRow label="专家负责人">{d.expertOwner}</InfoRow>
                      <InfoRow label="专家当前阶段" warn={d.expertStageWarn}>{d.expertStage}</InfoRow>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>炒群最新进度</p>
                        {canManage ? (
                          <button
                            onClick={() => setEditingNote(d.id)} title="点击编辑"
                            style={{
                              all: "unset", cursor: "pointer", display: "inline-flex",
                              color: "var(--ink-3)", padding: 2, borderRadius: 4,
                            }}
                          >
                            <IconEdit size={12} />
                          </button>
                        ) : null}
                      </div>
                      {canManage && editingNote === d.id ? (
                        <textarea
                          autoFocus className="field" style={{ width: "100%", minHeight: 52, padding: "5px 11px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.4 }}
                          defaultValue={d.groupProgressNote}
                          onBlur={(e) => { onUpdateGroupNote?.(d.id, e.target.value); setEditingNote(null); }}
                          onKeyDown={(e) => { if (e.key === "Escape") setEditingNote(null); }}
                        />
                      ) : (
                        <p
                          onClick={canManage ? () => setEditingNote(d.id) : undefined}
                          title={canManage ? "点击编辑" : undefined}
                          style={{
                            margin: 0, fontSize: 13, color: d.groupProgressNote ? "var(--ink)" : "var(--ink-3)",
                            cursor: canManage ? "text" : "default",
                            borderBottom: canManage ? "1.5px dashed var(--line-strong)" : "none",
                          }}
                        >
                          {d.groupProgressNote || (canManage ? "点击填写客户情况" : "暂无")}
                        </p>
                      )}
                      {d.groupProgressMeta ? (
                        <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>{d.groupProgressMeta}</p>
                      ) : null}
                    </div>
                    <div style={{ margin: "8px 0", borderTop: "1px dashed var(--line)" }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>专家情况</p>
                        {canManageExpert ? (
                          <button
                            onClick={() => setEditingExpertNote(d.id)} title="点击编辑"
                            style={{
                              all: "unset", cursor: "pointer", display: "inline-flex",
                              color: "var(--ink-3)", padding: 2, borderRadius: 4,
                            }}
                          >
                            <IconEdit size={12} />
                          </button>
                        ) : null}
                      </div>
                      {canManageExpert && editingExpertNote === d.id ? (
                        <textarea
                          autoFocus className="field" style={{ width: "100%", minHeight: 52, padding: "5px 11px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.4 }}
                          defaultValue={d.expertNote}
                          onBlur={(e) => { onUpdateExpertNote?.(d.id, e.target.value); setEditingExpertNote(null); }}
                          onKeyDown={(e) => { if (e.key === "Escape") setEditingExpertNote(null); }}
                        />
                      ) : (
                        <p
                          onClick={canManageExpert ? () => setEditingExpertNote(d.id) : undefined}
                          title={canManageExpert ? "点击编辑" : undefined}
                          style={{
                            margin: 0, fontSize: 13, color: d.expertNote ? "var(--ink)" : "var(--ink-3)",
                            cursor: canManageExpert ? "text" : "default",
                            borderBottom: canManageExpert ? "1.5px dashed var(--line-strong)" : "none",
                          }}
                        >
                          {d.expertNote || (canManageExpert ? "点击填写专家情况" : "暂无")}
                        </p>
                      )}
                      <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>
                        专家：{d.expertOwner}{canManageExpert ? "" : " · 只读"}
                      </p>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px 10px" }}>
                      <MoneyCell label="首充" value={money(d.depositUsd)} />
                      <MoneyCell label="续充" value={`${d.continuationCount} 次 · ${money(d.continuationUsd)}`} />
                      <MoneyCell label="出金" value={money(d.withdrawalUsd)} />
                    </div>
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--line)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span style={{ fontSize: 12.5, color: "var(--accent)", fontWeight: 600 }}>当前净业绩</span>
                        <span className="tnum" style={{ fontSize: 14.5, fontWeight: 700, color: d.netUsd >= 0 ? "var(--ok)" : "var(--bad)" }}>
                          {d.netUsd >= 0 ? "" : "-"}{money(Math.abs(d.netUsd))}
                        </span>
                      </div>
                      <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--ink-3)" }}>{d.summaryLine}</p>
                    </div>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
                      {canManage && d.category === "backfilled" && d.historicalStage && nextBaselineStage(d.historicalStage) ? (
                        <button className="btn" data-size="sm" data-variant="primary"
                          onClick={() => onAdvanceBackfilled?.(d.id)}>
                          标记：{BASELINE_STAGE_META[nextBaselineStage(d.historicalStage)!].label}
                        </button>
                      ) : null}
                      {canManage && d.category === "inGroup" ? (
                        <button className="btn" data-size="sm" data-variant="primary"
                          onClick={() => askPushToExpert(d)}>
                          推专家
                        </button>
                      ) : null}
                      {canManage && d.category === "expertQueue" && d.expertStage === "排队中" ? (
                        <button className="btn" data-size="sm"
                          onClick={() => askRecallFromExpert(d)}>
                          撤回推专家
                        </button>
                      ) : null}
                      {canManage && (d.category === "inGroup" || d.category === "expertQueue" || d.category === "expertWorking") ? (
                        <button className="btn" data-size="sm"
                          onClick={() => askMarkLeftGroup(d)}>
                          标记退群
                        </button>
                      ) : null}
                      {canManage && d.category === "left" ? (
                        <button className="btn" data-size="sm" data-variant="primary"
                          onClick={() => askUndoLeftGroup(d)}>
                          撤销退群标记
                        </button>
                      ) : null}
                      {canManageExpert && d.expertStage === "排队中" ? (
                        <button className="btn" data-size="sm" data-variant="primary"
                          onClick={() => askBeginReception(d)}>
                          开始接待
                        </button>
                      ) : null}
                      {canManageExpert && d.expertStage === "交资料" ? (
                        <>
                          <button className="btn" data-size="sm" data-variant="primary"
                            onClick={() => askBeginTracking(d)}>
                            资料已交 · 开始追踪
                          </button>
                          <button className="btn" data-size="sm" onClick={() => askRevertStage(d)}>
                            撤回上一步
                          </button>
                        </>
                      ) : null}
                      {canManageExpert && d.expertStage === "追踪中" ? (
                        <>
                          <button className="btn" data-size="sm" data-variant="primary"
                            onClick={() => askMarkPendingRegistration(d)}>
                            转为待注册
                          </button>
                          <button className="btn" data-size="sm" onClick={() => askRevertStage(d)}>
                            撤回上一步
                          </button>
                        </>
                      ) : null}
                      {canManageExpert && d.expertStage === "待注册" ? (
                        <>
                          <button className="btn" data-size="sm" data-variant="primary"
                            onClick={() => askMarkRegistered(d)}>
                            标记已注册
                          </button>
                          <button className="btn" data-size="sm" onClick={() => askRevertStage(d)}>
                            撤回上一步
                          </button>
                        </>
                      ) : null}
                      {canManageExpert && d.expertStage === "待开单" ? (
                        <>
                          <button className="btn" data-size="sm" data-variant="primary"
                            onClick={() => askOpenOrder(d)}>
                            登记开单
                          </button>
                          <button className="btn" data-size="sm"
                            onClick={() => askDeclineDeposit(d)}>
                            不首充
                          </button>
                          <button className="btn" data-size="sm" onClick={() => askRevertStage(d)}>
                            撤回上一步
                          </button>
                        </>
                      ) : null}
                      {canManageExpert && d.expertStage === "未成交" ? (
                        <button className="btn" data-size="sm" data-variant="primary"
                          onClick={() => askRecoverFromDecline(d)}>
                          恢复首充跟进
                        </button>
                      ) : null}
                      {canManageExpert && d.expertStage === "已开单" ? (
                        <>
                          {d.moneyEvents?.some((e) => e.kind === "首充") ? (
                            <button className="btn" data-size="sm" onClick={() => askCancelOrder(d)}>
                              撤销开单
                            </button>
                          ) : null}
                          <button className="btn" data-size="sm"
                            onClick={() => askMarkStalled(d)}>
                            停止维护
                          </button>
                        </>
                      ) : null}
                      {canManageExpert && d.expertStage === "停止维护" ? (
                        <button className="btn" data-size="sm" data-variant="primary"
                          onClick={() => askRecoverFromStalled(d)}>
                          恢复跟进
                        </button>
                      ) : null}
                      {canManageExpert && d.category === "ordered" ? (
                        <>
                          <button className="btn" data-size="sm" data-variant="primary" onClick={() => setFinanceDrawerId(d.id)}>
                            财务明细
                          </button>
                          <button className="btn" data-size="sm" onClick={() => askAddContinuation(d)}>
                            + 续充
                          </button>
                          <button className="btn" data-size="sm" onClick={() => askAddWithdrawal(d)}>
                            + 出金
                          </button>
                          {d.moneyEvents?.some((e) => e.kind !== "首充") ? (
                            <button className="btn" data-size="sm" onClick={() => askUndoLastMoneyEvent(d)}>
                              撤销上一笔
                            </button>
                          ) : null}
                        </>
                      ) : null}
                      <button className="btn" data-size="sm" onClick={() => setDrawerId(d.id)}>
                        查看资料
                      </button>
                      {canManage || canManageExpert ? (
                        d.misrecorded ? (
                          <button
                            onClick={() => askUndoMisrecorded(d)}
                            style={{ all: "unset", cursor: "pointer", color: "var(--ink-3)", fontSize: 12.5, fontWeight: 600 }}>
                            撤销误录标记
                          </button>
                        ) : (
                          <button
                            onClick={() => askMarkMisrecorded(d)}
                            style={{ all: "unset", cursor: "pointer", color: "var(--bad)", fontSize: 12.5, fontWeight: 600 }}>
                            标记误录
                          </button>
                        )
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length ? (
                <tr>
                  <td colSpan={5} style={{ padding: "44px 0", textAlign: "center", color: "var(--ink-3)" }}>
                    这个状态下暂时没有客户
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)" }}>
        说明：这一页的数字不计入你的「本步效率」考核 —— 你的效率只算到「确认入群」为止。这里是让你知道客户后来怎么样了。
      </p>

      <DownstreamDrawer lead={drawer} onClose={() => setDrawerId(null)} />
      <FinanceDrawer
        lead={financeDrawer} onClose={() => setFinanceDrawerId(null)}
        onEdit={(d, event) => askEditMoneyEvent(d, event)}
      />
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
