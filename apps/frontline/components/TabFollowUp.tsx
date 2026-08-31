"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ARCHIVED,
  BASELINE_STAGE_META,
  CHANNELS,
  DEVICES,
  HISTORICAL_BATCH_COUNT_KEY,
  INVALID,
  PENDING_GROUP,
  PENDING_REPLY,
  TODAY,
  money,
  formatPhone,
  nowStamp,
  stageOf,
  type HistoricalBatch,
  type Lead,
} from "@/lib/mock-data";
import { ConfirmDialog, type Confirm } from "./ConfirmDialog";
import { CustomerDrawer } from "./CustomerDrawer";
import { IconCheck, IconPlus, IconSearch } from "./Icons";

type SubTab = "reply" | "group" | "archived" | "invalid";
type SortKey = "waited" | "amount" | "visits";
type Density = "cozy" | "compact";
type EditField = "name" | "email" | "amountUsd" | "platform" | "note";
/** 接粉这边"录入老客户"能选的基线只有这两档，已进群及以上归炒群管 */
type EntryBaselineStage = "NOT_REPLIED" | "REPLIED";

const PAGE_SIZE = 25;
const ACTOR = "陈小雨（我自己）";
/** 接粉这边"录入老客户"只处理还没入群的老粉——未回复/已回复。
 *  "以前就已经在群里"的老客户由炒群在"客户进度"页自己认领，接粉这边不用管。 */
const ENTRY_BASELINE_STAGES: EntryBaselineStage[] = ["NOT_REPLIED", "REPLIED"];

/** 当前tab + 所选批次，能选的基线只剩哪些——面板渲染和提交校验共用同一份逻辑，不会算出两个不同答案 */
function entryBaselinesFor(sub: SubTab, batch: HistoricalBatch | undefined): EntryBaselineStage[] {
  const contextStages: EntryBaselineStage[] = sub === "group" ? ["REPLIED"] : sub === "reply" ? ["NOT_REPLIED"] : ENTRY_BASELINE_STAGES;
  return contextStages.filter((s) => {
    if (s === "NOT_REPLIED") return true;
    if (!batch) return false;
    const key = HISTORICAL_BATCH_COUNT_KEY[s];
    return key ? batch.counts[key] > 0 : false;
  });
}

/** 来源批次 = 日期 + 渠道，接粉按批集中处理 */
const BATCHES = ["全部我的客户", ...["2026-08-27", "2026-08-26", "2026-08-25", "2026-08-24", "2026-08-22"]
  .flatMap((d) => CHANNELS.slice(0, 2).map((c) => `${d} · ${c}`))];

export function TabFollowUp({
  onToast, importedLeads, historicalGroupLeads, onHandoff, onReplyCountChange,
  onHistoricalReplyAdd, onHistoricalGroupAdd,
  historicalBatches, onBatchCreate, onBatchStageAdvance,
}: {
  onToast: (m: string, t?: "ok" | "warn") => void;
  /** 号码导入页"确认导入"新加的客户，直接进待回复 */
  importedLeads: Lead[];
  /** 录入老客户时，基线选到"已回复"，直接进已回复待入群 */
  historicalGroupLeads: Lead[];
  /** 确认入群之后，把客户交给"客户进度"页 */
  onHandoff: (lead: Lead) => void;
  /** 待回复人数变化时报给外面，顶部导航的红色数字要跟着这个走 */
  onReplyCountChange: (n: number) => void;
  /** 录入老客户，基线选到"未回复" */
  onHistoricalReplyAdd: (lead: Lead) => void;
  /** 录入老客户，基线选到"已回复" */
  onHistoricalGroupAdd: (lead: Lead) => void;
  /** 现有的历史汇总批次（没有号码、只有汇总数字的老账） */
  historicalBatches: HistoricalBatch[];
  /** 录入老客户时顺手新建一个批次 */
  onBatchCreate: (batch: HistoricalBatch) => void;
  /** 认领之后，这个号码新发生的事（回复/入群…）要记到对应批次的对应格 +1 */
  onBatchStageAdvance: (batchId: string, key: keyof HistoricalBatch["counts"]) => void;
}) {
  const [sub, setSub] = useState<SubTab>("reply");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [moved, setMoved] = useState<Record<string, SubTab>>({});
  const [search, setSearch] = useState("");
  const [batch, setBatch] = useState(BATCHES[0]);
  const [sortKey, setSortKey] = useState<SortKey>("waited");
  const [sortDesc, setSortDesc] = useState(true);
  const [density, setDensity] = useState<Density>("cozy");
  const [cursor, setCursor] = useState(0);
  const [page, setPage] = useState(1);
  const [archiveKind, setArchiveKind] = useState<"all" | "UNANSWERED" | "NOT_JOINED">("all");
  const [invalidKind, setInvalidKind] = useState<"all" | "LOW_AMOUNT" | "NO_WS">("all");
  const [drawer, setDrawer] = useState<Lead | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; field: EditField } | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Lead>>>({});
  const [historicalDraft, setHistoricalDraft] = useState<{
    phone: string; name: string; email: string; amountUsd: string; platform: string;
    channel: string; sourceDate: string; note: string; baseline: EntryBaselineStage; batchId: string;
    // 已回复基线专用：真正回复客户是哪天，跟批次的来源日期是两回事——不填默认今天
    repliedDate: string;
  } | null>(null);
  const [newBatchDraft, setNewBatchDraft] = useState<{
    channel: string; batchDate: string; label: string;
    fans: string; replied: string; joined: string; introduced: string; registered: string; ordered: string;
  } | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  /** 三个子 tab 各自的原始数据来自哪个数组——用来在客户被"移动"之后，
   *  还能知道他本来是从哪来的、现在该落在哪个 tab。刚导入的客户原始位置就是"待回复"，
   *  录入老客户时基线选到"已回复"的，原始位置直接是"已回复待入群"。 */
  const ORIGIN = useMemo(() => {
    const o: Record<string, SubTab> = {};
    PENDING_REPLY.forEach((l) => { o[l.id] = "reply"; });
    PENDING_GROUP.forEach((l) => { o[l.id] = "group"; });
    ARCHIVED.forEach((l) => { o[l.id] = "archived"; });
    INVALID.forEach((l) => { o[l.id] = "invalid"; });
    importedLeads.forEach((l) => { o[l.id] = "reply"; });
    historicalGroupLeads.forEach((l) => { o[l.id] = "group"; });
    return o;
  }, [importedLeads, historicalGroupLeads]);
  const ALL_LEADS = useMemo(
    () => [...PENDING_REPLY, ...PENDING_GROUP, ...ARCHIVED, ...INVALID, ...importedLeads, ...historicalGroupLeads],
    [importedLeads, historicalGroupLeads],
  );

  const merge = (l: Lead): Lead => ({ ...l, ...edits[l.id] });
  const effectiveTab = (id: string): SubTab => moved[id] ?? ORIGIN[id];
  const liveLeads = ALL_LEADS.filter((l) => !gone.has(l.id)).map(merge);
  const replyRows = liveLeads.filter((l) => effectiveTab(l.id) === "reply");
  const groupRows = liveLeads.filter((l) => effectiveTab(l.id) === "group");
  const archivedRowsAll = liveLeads.filter((l) => effectiveTab(l.id) === "archived");
  const archivedRows = archivedRowsAll.filter(
    (l) => archiveKind === "all" || l.archiveKind === archiveKind,
  );
  const invalidRowsAll = liveLeads.filter((l) => effectiveTab(l.id) === "invalid");
  const invalidRows = invalidRowsAll.filter(
    (l) => invalidKind === "all" || l.invalidKind === invalidKind,
  );

  const subTabs: Array<{ id: SubTab; label: string; count: number }> = [
    { id: "reply", label: "待回复", count: replyRows.length },
    { id: "group", label: "已回复，待入群", count: groupRows.length },
    { id: "archived", label: "归档", count: archivedRowsAll.length },
    { id: "invalid", label: "无效库", count: invalidRowsAll.length },
  ];

  const base = sub === "reply" ? replyRows : sub === "group" ? groupRows
    : sub === "invalid" ? invalidRows : archivedRows;

  const filtered = useMemo(() => {
    const q = search.replace(/\s/g, "").toLowerCase();
    let rows = q
      ? base.filter((r) => r.phone.replace(/\s/g, "").includes(q) || r.name.toLowerCase().includes(q))
      : base;
    if (batch !== BATCHES[0]) {
      const [d, c] = batch.split(" · ");
      rows = rows.filter((r) => r.sourceDate === d && r.channel === c);
    }
    if (sub === "reply") {
      // 待回复的排序是固定的：来源日期越老越靠前，同一天里回访次数越少越靠前。
      // 不给用户改——避免专挑好联系的客户，把最冷的号码一直压在后面没人理。
      return [...rows].sort((a, b) =>
        a.sourceDate !== b.sourceDate ? (a.sourceDate < b.sourceDate ? -1 : 1) : a.visits - b.visits);
    }
    if (sub === "group") {
      // 已回复待入群也是固定排序：准备拉群的客户排最前面，同一类里按回复时间升序。
      return [...rows].sort((a, b) => {
        const aReady = a.chatStatus === "READY" ? 0 : 1;
        const bReady = b.chatStatus === "READY" ? 0 : 1;
        return aReady !== bReady ? aReady - bReady : (a.repliedAt ?? "").localeCompare(b.repliedAt ?? "");
      });
    }
    const pick = (l: Lead) =>
      sortKey === "amount" ? (l.amountUsd ?? -1) : sortKey === "visits" ? l.visits : l.waitedDays;
    return [...rows].sort((a, b) => (sortDesc ? pick(b) - pick(a) : pick(a) - pick(b)));
  }, [base, search, batch, sortKey, sortDesc, sub]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const selectable = sub === "reply" ? visible : [];
  const allOn = selectable.length > 0 && selectable.every((r) => selected.has(r.id));

  useEffect(() => { setCursor(0); setPage(1); setSelected(new Set()); },
    [sub, search, batch, sortKey, sortDesc, archiveKind]);

  // 录入老客户面板开着的时候切"待回复"/"已回复待入群"tab——基线要跟着当前tab走，
  // 不然面板显示的是"已回复"，实际存的还是切之前那个tab对应的基线
  useEffect(() => {
    if (!historicalDraft) return;
    const wanted: EntryBaselineStage = sub === "group" ? "REPLIED" : "NOT_REPLIED";
    if (historicalDraft.baseline !== wanted) {
      setHistoricalDraft((d) => d ? { ...d, baseline: wanted } : d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub]);

  useEffect(() => { onReplyCountChange(replyRows.length); }, [replyRows.length, onReplyCountChange]);

  useEffect(() => {
    if (sub !== "reply") return;
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      if (el && ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return;
      if (confirm || drawer || !visible.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, Math.min(visible.length - 1, e.key === "ArrowDown" ? c + 1 : c - 1)));
      } else if (e.key === " ") {
        e.preventDefault();
        const r = visible[cursor];
        if (r) toggle(r.id);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const r = visible[cursor];
        if (r) askReply(r);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sub, visible, cursor, confirm, drawer]);

  useEffect(() => {
    bodyRef.current?.querySelector<HTMLElement>(`tr[data-cursor="1"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuFor]);

  function toggle(id: string) {
    setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  const drop = (id: string) => setGone((p) => new Set([...p, id]));
  const move = (id: string, to: SubTab) => setMoved((p) => ({ ...p, [id]: to }));
  const patch = (id: string, v: Partial<Lead>) =>
    setEdits((p) => ({ ...p, [id]: { ...p[id], ...v } }));
  /** 在客户的操作记录里追加一条，供详情抽屉的「操作记录」展示 */
  const logHistory = (l: Lead, action: string, note?: string) =>
    patch(l.id, { history: [...(l.history ?? []), { action, date: TODAY, actor: ACTOR, note }] });

  /* ---- 需要确认的动作 ---- */
  function askReply(l: Lead) {
    if (!l.device && !edits[l.id]?.device) { onToast(`请先为 ${l.phone} 填写设备号`, "warn"); return; }
    setConfirm({
      title: "确认客户已经联系？", confirmLabel: "确认已回复", target: `${l.phone} · ${l.name}`,
      desc: "确认后客户会从待回复进入待入群，设备号记录为本次实际联系使用的设备。",
      onConfirm: () => {
        move(l.id, "group");
        patch(l.id, { repliedAt: nowStamp() });
        logHistory(l, "确认已回复");
        // 认领自某个历史批次、启用前还没回复过的老粉，今天这次回复是新发生的，记进批次的"回复"格
        if (l.isHistoricalRecord && l.historicalBatchId && l.historicalBaselineStage === "NOT_REPLIED") {
          onBatchStageAdvance(l.historicalBatchId, "replied");
        }
        setConfirm(null);
        onToast(`已确认 ${l.name} 回复`);
      },
    });
  }
  function askJoin(l: Lead) {
    setConfirm({
      title: "确认客户已经入群？", confirmLabel: "确认入群", target: `${l.phone} · ${l.name}`,
      desc: "确认后客户交接到炒群岗位继续跟进，你之后只能查看不能修改。",
      onConfirm: () => {
        onHandoff(l);
        drop(l.id);
        // 能走到这一步说明基线是"未回复"或"已回复"，进群本身对这个号码来说是新发生的
        if (l.isHistoricalRecord && l.historicalBatchId) {
          onBatchStageAdvance(l.historicalBatchId, "joined");
        }
        setConfirm(null);
        onToast(`已确认 ${l.name} 入群，交给炒群跟进`);
      },
    });
  }
  function askUndoReply(l: Lead) {
    setConfirm({
      title: "确认撤销客户回复？", confirmLabel: "确认撤销", danger: true, target: `${l.phone} · ${l.name}`,
      desc: "撤销后客户回到待回复。只有还没入群的客户可以撤销。",
      reasonLabel: "撤销原因", reasonPlaceholder: "例如：点错了，客户实际没回复",
      onConfirm: (reason) => {
        move(l.id, "reply");
        patch(l.id, { repliedAt: undefined, chatStatus: undefined });
        logHistory(l, "撤销回复", reason);
        setConfirm(null);
        onToast(`已撤销 ${l.name} 的回复`);
      },
    });
  }
  function askArchive(l: Lead) {
    setConfirm({
      title: "确认手动归档该客户？", confirmLabel: "确认归档", danger: true, target: `${l.phone} · ${l.name}`,
      desc: "用于已经回复但最终没进群的客户。归档后进入「未进群归档」，不算未回复归档。",
      reasonLabel: "归档原因", reasonPlaceholder: "例如：多次沟通后明确拒绝进群",
      numberLabel: "实际回访次数", defaultNumber: String(l.visits),
      onConfirm: (reason, num) => {
        move(l.id, "archived");
        patch(l.id, {
          archiveKind: "NOT_JOINED", archiveReason: reason,
          visits: num ?? l.visits,
        });
        logHistory(l, "手动归档", reason);
        setConfirm(null);
        onToast(`已归档 ${l.name}`);
      },
    });
  }
  function askRestore(l: Lead) {
    setConfirm({
      title: "确认恢复该客户？", confirmLabel: "确认恢复", target: `${l.phone} · ${l.name}`,
      desc: "恢复后客户回到待回复，重新开始跟进。归档记录还留着，能在操作记录里看到。",
      reasonLabel: "恢复原因", reasonPlaceholder: "例如：客户主动回消息了，之前判断错了",
      onConfirm: (reason) => {
        move(l.id, "reply");
        patch(l.id, { archiveKind: undefined, archiveReason: undefined });
        logHistory(l, "已恢复", reason);
        setConfirm(null);
        onToast(`已恢复 ${l.name}，回到待回复`);
      },
    });
  }
  function askVoid(l: Lead) {
    const never = l.visits === 0 && !l.repliedAt;
    setConfirm({
      title: never ? "确认删除这条错误导入？" : "确认标记为误录？",
      confirmLabel: never ? "确认删除" : "确认标记误录", danger: true,
      target: `${l.phone} · ${l.name}`,
      desc: never
        ? "这条还没有任何跟进记录，可以直接从客户通讯录删除；每日统计数字不会因此改变。"
        : "已经跟进过的客户不能删除，只能标记误录并保留历史痕迹；客户进度不会改变每日统计数字。",
      ...(never ? {} : { reasonLabel: "误录原因", reasonPlaceholder: "例如：号码录错，实际不是这个客户" }),
      onConfirm: (reason) => {
        if (!never) logHistory(l, "标记误录", reason);
        drop(l.id);
        setConfirm(null);
        onToast(never ? "已删除该条导入" : `已标记 ${l.name} 为误录`);
      },
    });
  }

  function askInvalidate(l: Lead) {
    setConfirm({
      title: "改判为无效库？", confirmLabel: "确认改判", danger: true, target: `${l.phone} · ${l.name}`,
      desc: "适用于金额太低、或者查出来没有 WhatsApp 的客户。这里只维护客户分类和跟进记录，不会改变每日统计数字。",
      kindLabel: "属于哪一种", kindOptions: [{ value: "LOW_AMOUNT", label: "金额太低" }, { value: "NO_WS", label: "没有 WhatsApp" }],
      reasonLabel: "改判原因", reasonPlaceholder: "例如：客户金额太低，只有$2000",
      onConfirm: (reason, _num, kind) => {
        move(l.id, "invalid");
        patch(l.id, { invalidKind: (kind as Lead["invalidKind"]) ?? "LOW_AMOUNT", invalidReason: reason });
        logHistory(l, "改判无效库", reason);
        setConfirm(null);
        onToast(`已把 ${l.name} 移入无效库`);
      },
    });
  }
  function askRestoreValid(l: Lead) {
    setConfirm({
      title: "恢复为有效客户？", confirmLabel: "确认恢复", target: `${l.phone} · ${l.name}`,
      desc: "恢复后客户回到待回复；这里只恢复客户分类，不会改变每日统计数字。",
      reasonLabel: "恢复原因", reasonPlaceholder: "例如：核实后金额其实够，之前判断错了",
      onConfirm: (reason) => {
        move(l.id, "reply");
        patch(l.id, { invalidKind: undefined, invalidReason: undefined });
        logHistory(l, "恢复有效", reason);
        setConfirm(null);
        onToast(`已恢复 ${l.name} 为有效客户`);
      },
    });
  }

  /** 录入老客户：把系统启用前就存在、现在才有具体号码的老粉认领进来。
   *  认领本身不产生"新增/回复/入群"这些动作——旧进度已经算在当时的汇总数字里了，
   *  不能再算一次。只有认领之后新发生的事（推专家、注册、开单、续充）才算新账。 */
  function submitHistoricalDraft() {
    if (!historicalDraft) return;
    const phone = historicalDraft.phone.trim();
    if (!phone) { onToast("请先填手机号", "warn"); return; }
    if (!historicalDraft.batchId) { onToast("请先选择所属历史批次", "warn"); return; }
    const batch = historicalBatches.find((b) => b.id === historicalDraft.batchId);
    if (!entryBaselinesFor(sub, batch).includes(historicalDraft.baseline)) {
      onToast("这个批次没有对应阶段的历史数字，选不了这个状态", "warn");
      return;
    }

    const base: Lead = {
      id: `hist-${Date.now()}`,
      phone, name: historicalDraft.name.trim(), email: historicalDraft.email.trim(),
      amountUsd: historicalDraft.amountUsd ? Number(historicalDraft.amountUsd) : null,
      platform: historicalDraft.platform, device: "",
      channel: historicalDraft.channel, sourceDate: historicalDraft.sourceDate,
      waitedDays: 0, visits: 0, lastVisitNote: historicalDraft.note.trim() || null,
      isHistoricalRecord: true, historicalBaselineStage: historicalDraft.baseline,
      historicalBatchId: historicalDraft.batchId,
      history: [{
        action: "历史补录", date: TODAY, actor: ACTOR,
        note: `基线：${BASELINE_STAGE_META[historicalDraft.baseline].label} · 批次：${batch?.label || batch?.channel || ""}`,
      }],
    };

    if (historicalDraft.baseline === "NOT_REPLIED") {
      onHistoricalReplyAdd(base);
      onToast(`已把 ${base.name || base.phone} 补录进待回复`);
    } else {
      const repliedAt = historicalDraft.repliedDate
        ? `${historicalDraft.repliedDate.slice(5)} 00:00`
        : nowStamp();
      onHistoricalGroupAdd({ ...base, repliedAt });
      onToast(`已把 ${base.name || base.phone} 补录进已回复，待入群`);
    }
    setHistoricalDraft(null);
  }

  /** 新建一批历史汇总数字——没有号码，只有渠道/日期和当时的汇总数（粉/回复/进群/推专家/注册/开单） */
  function submitNewBatch() {
    if (!newBatchDraft) return;
    const num = (s: string) => Math.max(0, Number(s) || 0);
    const batch: HistoricalBatch = {
      id: `batch-${Date.now()}`,
      channel: newBatchDraft.channel, batchDate: newBatchDraft.batchDate,
      label: newBatchDraft.label.trim() || undefined,
      counts: {
        fans: num(newBatchDraft.fans), replied: num(newBatchDraft.replied), joined: num(newBatchDraft.joined),
        introduced: num(newBatchDraft.introduced), registered: num(newBatchDraft.registered), ordered: num(newBatchDraft.ordered),
      },
      createdAt: TODAY,
    };
    onBatchCreate(batch);
    setHistoricalDraft((d) => d ? { ...d, batchId: batch.id, channel: batch.channel, sourceDate: batch.batchDate } : d);
    setNewBatchDraft(null);
    onToast(`已新建批次：${batch.label || batch.channel}`);
  }

  function askVisit(l: Lead) {
    setConfirm({
      title: "记一次回访", confirmLabel: "记下", target: `${l.phone} · ${l.name}`,
      desc: "确认后回访次数 +1。",
      onConfirm: () => {
        patch(l.id, { visits: l.visits + 1 });
        setConfirm(null);
        onToast(`已记录对 ${l.name} 的一次回访`);
      },
    });
  }

  function confirmBulk() {
    const ok = visible.filter((r) => selected.has(r.id) && (r.device || edits[r.id]?.device));
    const skipped = selected.size - ok.length;
    if (!ok.length) { onToast("勾选的号码都还没填设备号", "warn"); return; }
    setConfirm({
      title: `确认这 ${ok.length} 位客户都已经联系？`, confirmLabel: `确认（${ok.length}）`,
      desc: skipped
        ? `确认后这 ${ok.length} 位进入待入群；另有 ${skipped} 位还没填设备号，本次跳过。`
        : `确认后这 ${ok.length} 位客户会从待回复进入待入群。`,
      onConfirm: () => {
        ok.forEach((r) => {
          move(r.id, "group");
          patch(r.id, { repliedAt: nowStamp() });
          logHistory(r, "批量确认已回复");
          if (r.isHistoricalRecord && r.historicalBatchId && r.historicalBaselineStage === "NOT_REPLIED") {
            onBatchStageAdvance(r.historicalBatchId, "replied");
          }
        });
        setSelected(new Set()); setConfirm(null);
        onToast(`已确认 ${ok.length} 位客户回复${skipped ? `，跳过 ${skipped} 位无设备号的` : ""}`);
      },
    });
  }

  function sortBy(k: SortKey) {
    if (k === sortKey) setSortDesc((d) => !d); else { setSortKey(k); setSortDesc(true); }
  }
  const arrow = (k: SortKey) =>
    sortKey === k ? <span className="sort-arrow">{sortDesc ? "▼" : "▲"}</span> : null;

  /* 就地编辑单元格 */
  function Cell({ lead, field, value, numeric, wrap }: { lead: Lead; field: EditField; value: string; numeric?: boolean; wrap?: boolean }) {
    const on = editing?.id === lead.id && editing.field === field;
    if (on) {
      if (wrap) {
        return (
          <textarea
            autoFocus className="field" style={{ width: "100%", minHeight: 56, padding: "5px 11px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.4 }}
            defaultValue={value}
            onBlur={(e) => {
              patch(lead.id, { lastVisitNote: e.target.value } as Partial<Lead>);
              setEditing(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(null);
            }}
          />
        );
      }
      return (
        <input
          autoFocus className="field" style={{ width: "100%", height: 28 }}
          defaultValue={numeric ? String(lead.amountUsd ?? "") : value}
          onBlur={(e) => {
            patch(lead.id, numeric
              ? { amountUsd: e.target.value ? Number(e.target.value) : null }
              : ({ [field === "note" ? "lastVisitNote" : field]: e.target.value } as Partial<Lead>));
            setEditing(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(null);
          }}
        />
      );
    }
    const empty = numeric ? lead.amountUsd == null : !value;
    return (
      <button
        onClick={() => setEditing({ id: lead.id, field })}
        title="点击编辑"
        className="editable-cell"
        style={{
          color: empty ? "var(--ink-3)" : "inherit",
          ...(wrap ? { whiteSpace: "normal", textOverflow: "clip", overflow: "visible", wordBreak: "break-word", textAlign: "left" } : {}),
        }}
      >
        {empty ? "填写" : value}
      </button>
    );
  }

  /** 客户资料——姓名/邮箱/金额/平台，一行一个字段，带标签 */
  function ProfileRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ width: 34, flexShrink: 0, color: "var(--ink-3)", fontSize: 11.5 }}>{label}</span>
        <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      </div>
    );
  }

  function ProfileCell({ lead }: { lead: Lead }) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "1px 0" }}>
        <ProfileRow label="姓名">
          <span style={{ fontWeight: 700, fontSize: 13.5 }}><Cell lead={lead} field="name" value={lead.name} /></span>
        </ProfileRow>
        <ProfileRow label="邮箱"><Cell lead={lead} field="email" value={lead.email} /></ProfileRow>
        <ProfileRow label="金额"><Cell lead={lead} field="amountUsd" value={money(lead.amountUsd)} numeric /></ProfileRow>
        <ProfileRow label="平台"><Cell lead={lead} field="platform" value={lead.platform} /></ProfileRow>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 工具栏 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {subTabs.map((t) => {
          const on = sub === t.id;
          return (
            <button key={t.id} onClick={() => setSub(t.id)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 14px",
                borderRadius: 999, border: `1px solid ${on ? "var(--accent)" : "var(--line-strong)"}`,
                background: on ? "var(--accent)" : "var(--surface)", color: on ? "#fff" : "var(--ink-2)",
                fontSize: 13.5, fontWeight: 600, cursor: "pointer",
              }}>
              {t.label}
              <span className="tnum" style={{
                minWidth: 20, height: 20, padding: "0 6px", borderRadius: 999,
                background: on ? "rgba(255,255,255,.22)" : "var(--surface-sunken)",
                color: on ? "#fff" : "var(--ink-2)", fontSize: 12,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}>{t.count}</span>
            </button>
          );
        })}

        <button
          onClick={() => {
            if (historicalDraft) { setHistoricalDraft(null); setNewBatchDraft(null); return; }
            if (sub !== "reply" && sub !== "group") setSub("reply");
            const firstBatch = historicalBatches[0];
            setHistoricalDraft({
              phone: "", name: "", email: "", amountUsd: "", platform: "",
              channel: firstBatch?.channel ?? CHANNELS[0], sourceDate: firstBatch?.batchDate ?? TODAY, note: "",
              baseline: sub === "group" ? "REPLIED" : "NOT_REPLIED",
              batchId: firstBatch?.id ?? "",
              repliedDate: "",
            });
          }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px",
            borderRadius: 999, cursor: "pointer", fontSize: 13.5, fontWeight: 600,
            border: `1px solid ${historicalDraft ? "var(--accent)" : "var(--line-strong)"}`,
            background: historicalDraft ? "var(--accent-soft)" : "var(--surface)",
            color: historicalDraft ? "var(--accent)" : "var(--ink-2)",
          }}>
          <IconPlus size={14} />录入老客户
        </button>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select className="field" value={batch} onChange={(e) => setBatch(e.target.value)}
            style={{ width: 210 }} aria-label="来源批次">
            {BATCHES.map((b) => <option key={b}>{b}</option>)}
          </select>
          <div style={{ display: "flex", border: "1px solid var(--line-strong)", borderRadius: "var(--radius)", overflow: "hidden" }}>
            {(["cozy", "compact"] as Density[]).map((d) => (
              <button key={d} onClick={() => setDensity(d)}
                style={{
                  height: 32, padding: "0 12px", border: "none", cursor: "pointer",
                  background: density === d ? "var(--accent-soft)" : "var(--surface)",
                  color: density === d ? "var(--accent)" : "var(--ink-3)", fontSize: 13, fontWeight: 600,
                }}>{d === "cozy" ? "宽松" : "紧凑"}</button>
            ))}
          </div>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 10, top: 8, color: "var(--ink-3)" }}><IconSearch size={17} /></span>
            <input className="field" style={{ paddingLeft: 33, width: 200 }}
              placeholder="搜手机号或姓名" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {/* 录入老客户——像Excel加一行一样，逐格填，不是弹窗 */}
      {historicalDraft ? (() => {
        const selectedBatch = historicalBatches.find((b) => b.id === historicalDraft.batchId);
        // 待回复/已回复待入群这两个tab本来就只装对应状态的客户——选别的选项都会立刻跳去别的地方，
        // 反而让人糊涂。这里各自锁死成一个选项，真有新进展了，用这一行已经有的确认按钮就行。
        const availableBaselines = entryBaselinesFor(sub, selectedBatch);
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
            <strong style={{ fontSize: 13.5 }}>录入老客户</strong>
            <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
              系统启用前就存在的粉，认领之后不重算旧进度，只算认领后新发生的
            </span>
          </div>

          {/* 第一步：这个号码属于哪一批没有号码、只有汇总数字的老账 */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
            <div style={{ minWidth: 320, flex: 1 }}>
              <label className="label">所属历史批次 *</label>
              <select className="field" style={{ width: "100%" }}
                value={historicalDraft.batchId}
                onChange={(e) => {
                  const b = historicalBatches.find((x) => x.id === e.target.value);
                  setHistoricalDraft({
                    ...historicalDraft, batchId: e.target.value,
                    channel: b?.channel ?? historicalDraft.channel, sourceDate: b?.batchDate ?? historicalDraft.sourceDate,
                    baseline: sub === "group" ? "REPLIED" : "NOT_REPLIED",
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

          {/* 新建批次——没有号码，只填渠道/日期和当时的汇总数字 */}
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
                value={historicalDraft.phone}
                onChange={(e) => setHistoricalDraft({ ...historicalDraft, phone: e.target.value })} />
            </div>
            <div>
              <label className="label">姓名</label>
              <input className="field" style={{ width: "100%" }}
                value={historicalDraft.name}
                onChange={(e) => setHistoricalDraft({ ...historicalDraft, name: e.target.value })} />
            </div>
            <div>
              <label className="label">邮箱</label>
              <input className="field" style={{ width: "100%" }}
                value={historicalDraft.email}
                onChange={(e) => setHistoricalDraft({ ...historicalDraft, email: e.target.value })} />
            </div>
            <div>
              <label className="label">金额</label>
              <input className="field" style={{ width: "100%" }} inputMode="numeric"
                value={historicalDraft.amountUsd}
                onChange={(e) => setHistoricalDraft({ ...historicalDraft, amountUsd: e.target.value })} />
            </div>
            <div>
              <label className="label">平台</label>
              <input className="field" style={{ width: "100%" }}
                value={historicalDraft.platform}
                onChange={(e) => setHistoricalDraft({ ...historicalDraft, platform: e.target.value })} />
            </div>
            <div>
              <label className="label">客户情况</label>
              <input className="field" style={{ width: "100%" }} placeholder="选填一句备注"
                value={historicalDraft.note}
                onChange={(e) => setHistoricalDraft({ ...historicalDraft, note: e.target.value })} />
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
            <div style={{ minWidth: 220 }}>
              <label className="label">启用前已经到哪一步 *</label>
              <select className="field" style={{ width: "100%" }}
                value={historicalDraft.baseline}
                disabled={availableBaselines.length <= 1}
                onChange={(e) => setHistoricalDraft({ ...historicalDraft, baseline: e.target.value as EntryBaselineStage })}>
                {availableBaselines.map((k) => (
                  <option key={k} value={k}>{BASELINE_STAGE_META[k].label}</option>
                ))}
              </select>
            </div>
            {historicalDraft.baseline === "REPLIED" ? (
              <div style={{ minWidth: 200 }}>
                <label className="label">回复日期</label>
                <input className="field" type="date" style={{ width: "100%" }}
                  value={historicalDraft.repliedDate}
                  onChange={(e) => setHistoricalDraft({ ...historicalDraft, repliedDate: e.target.value })} />
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
                  不填默认今天——批次的来源日期不代表客户真正回复的时间
                </p>
              </div>
            ) : null}
            <span style={{ fontSize: 12.5, color: "var(--ink-3)", flex: 1 }}>
              {sub === "group" ? "已经在「已回复，待入群」里了；真正拉群之后，用这一行的「确认入群」即可"
                : "落进「待回复」；这个客户回复之后，用这一行的「确认已回复」即可"}
            </span>
            <button className="btn" onClick={() => { setHistoricalDraft(null); setNewBatchDraft(null); }}>取消</button>
            <button className="btn" data-variant="primary" onClick={submitHistoricalDraft}>
              <IconCheck size={15} />保存
            </button>
          </div>
        </div>
        );
      })() : null}

      {/* 归档类型筛选——比上面的主chip矮一级，但形状统一用胶囊，不再是圆角矩形 */}
      {sub === "archived" ? (
        <div style={{ display: "flex", gap: 6 }}>
          {([["all", "全部"], ["UNANSWERED", "未回复归档"], ["NOT_JOINED", "未进群归档"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setArchiveKind(k)}
              style={{
                height: 28, padding: "0 12px", borderRadius: 999, cursor: "pointer",
                border: `1px solid ${archiveKind === k ? "var(--accent)" : "var(--line)"}`,
                background: archiveKind === k ? "var(--accent-soft)" : "var(--surface-sunken)",
                color: archiveKind === k ? "var(--accent)" : "var(--ink-2)", fontSize: 12.5, fontWeight: 600,
              }}>
              {label} {k === "all" ? archivedRowsAll.length : archivedRowsAll.filter((a) => a.archiveKind === k).length}
            </button>
          ))}
        </div>
      ) : null}

      {/* 无效库类型筛选 */}
      {sub === "invalid" ? (
        <div style={{ display: "flex", gap: 6 }}>
          {([["all", "全部"], ["LOW_AMOUNT", "低金额"], ["NO_WS", "无 WhatsApp"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setInvalidKind(k)}
              style={{
                height: 28, padding: "0 12px", borderRadius: 999, cursor: "pointer",
                border: `1px solid ${invalidKind === k ? "var(--accent)" : "var(--line)"}`,
                background: invalidKind === k ? "var(--accent-soft)" : "var(--surface-sunken)",
                color: invalidKind === k ? "var(--accent)" : "var(--ink-2)", fontSize: 12.5, fontWeight: 600,
              }}>
              {label} {k === "all" ? invalidRowsAll.length : invalidRowsAll.filter((a) => a.invalidKind === k).length}
            </button>
          ))}
        </div>
      ) : null}

      {/* 批量条 */}
      {sub === "reply" ? (
        <div style={{
          display: "flex", alignItems: "center", gap: 14, padding: "9px 16px",
          borderRadius: "var(--radius)", flexWrap: "wrap",
          background: selected.size ? "var(--accent-soft)" : "var(--surface)",
          border: `1px solid ${selected.size ? "var(--accent)" : "var(--line)"}`,
        }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
            <input type="checkbox" checked={allOn}
              onChange={() => setSelected(allOn ? new Set() : new Set(selectable.map((r) => r.id)))}
              style={{ width: 16, height: 16, cursor: "pointer" }} />
            全选本页
          </label>
          <span style={{ fontSize: 13.5, color: selected.size ? "var(--accent)" : "var(--ink-3)", fontWeight: selected.size ? 600 : 400 }}>
            {selected.size ? `已选 ${selected.size} 位` : `共 ${filtered.length} 位客户`}
          </span>
          <span style={{ fontSize: 12.5, color: "var(--ink-3)", display: "flex", alignItems: "center", gap: 5 }}>
            <kbd>↑</kbd><kbd>↓</kbd>移动 <kbd>空格</kbd>勾选 <kbd>回车</kbd>确认已回复
          </span>
          <button className="btn" data-variant="primary" disabled={!selected.size}
            onClick={confirmBulk} style={{ marginLeft: "auto" }}>
            <IconCheck size={16} />批量确认已回复{selected.size ? `（${selected.size}）` : ""}
          </button>
        </div>
      ) : null}

      {/* 表格 */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="table-scroll">
          {sub === "group" ? (
            <table className="grid-table" data-density={density}>
              <thead>
                <tr>
                  <th style={{ width: 132, textAlign: "center" }}>手机号</th>
                  <th style={{ width: 118, textAlign: "center" }}>来源</th>
                  <th style={{ width: 240 }}>客户资料</th>
                  <th style={{ width: 190 }}>客户情况</th>
                  <th style={{ width: 110, textAlign: "center" }}>已回复</th>
                  <th style={{ width: 110, textAlign: "center" }}>炒群负责人</th>
                  <th style={{ width: 100, textAlign: "center" }}>当前状态</th>
                  <th style={{ width: 260, textAlign: "center" }}>交接操作</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((lead) => {
                  return (
                    <tr key={lead.id}>
                      <td style={{ fontWeight: 700, whiteSpace: "nowrap", textAlign: "center" }}>
                      {formatPhone(lead.phone)}
                      {lead.isHistoricalRecord ? (
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--warn)", marginTop: 2 }}>历史补录</div>
                      ) : null}
                    </td>
                      <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap", fontSize: 12.5, textAlign: "center" }}>
                        {lead.channel}<br /><span style={{ color: "var(--ink-3)" }}>{lead.sourceDate}</span>
                      </td>
                      <td><ProfileCell lead={lead} /></td>
                      <td style={{ color: "var(--ink-2)" }}>
                        <Cell lead={lead} field="note" value={lead.lastVisitNote ?? ""} wrap />
                      </td>
                      <td style={{ textAlign: "center", color: "var(--ink-2)", fontSize: 13 }}>
                        {lead.repliedAt || <span className="muted">—</span>}
                      </td>
                      <td style={{ textAlign: "center", fontSize: 13 }}>
                        {lead.groupOperator || <span className="muted">待分配</span>}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <select className="field" style={{ height: 30, fontSize: 12.5, width: "100%" }}
                          value={lead.chatStatus ?? "NORMAL"}
                          onChange={(e) => patch(lead.id, { chatStatus: e.target.value as Lead["chatStatus"] })}>
                          <option value="NORMAL">正常聊天</option>
                          <option value="READY">准备拉群</option>
                        </select>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center", flexWrap: "nowrap" }}>
                          <button className="btn" data-size="sm" style={{ flexShrink: 0 }} onClick={() => setDrawer(lead)}>详情</button>
                          <button className="btn" data-size="sm" data-variant="primary" style={{ flexShrink: 0 }} onClick={() => askJoin(lead)}>
                            <IconCheck size={14} />确认入群
                          </button>
                          <div style={{ position: "relative", flexShrink: 0 }}>
                            <button className="btn" data-size="sm"
                              onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === lead.id ? null : lead.id); }}>
                              更多 ▾
                            </button>
                            {menuFor === lead.id ? (
                              <div onClick={(e) => e.stopPropagation()} style={{
                                position: "absolute", right: 0, top: 34, zIndex: 20, minWidth: 158,
                                background: "var(--surface)", border: "1px solid var(--line-strong)",
                                borderRadius: "var(--radius)", boxShadow: "0 10px 28px rgba(19,24,36,.15)",
                                padding: 4, display: "flex", flexDirection: "column",
                              }}>
                                <MenuItem onClick={() => { setMenuFor(null); askUndoReply(lead); }}>撤销回复</MenuItem>
                                <MenuItem onClick={() => { setMenuFor(null); askArchive(lead); }}>手动归档</MenuItem>
                                <MenuItem onClick={() => { setMenuFor(null); askInvalidate(lead); }}>改判无效库</MenuItem>
                                <MenuItem danger onClick={() => { setMenuFor(null); askVoid(lead); }}>
                                  {lead.visits === 0 && !lead.repliedAt ? "删除错误导入" : "标记误录"}
                                </MenuItem>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!visible.length ? (
                  <tr>
                    <td colSpan={8} style={{ padding: "44px 0", textAlign: "center", color: "var(--ink-3)" }}>
                      {search.trim() || batch !== BATCHES[0] ? "没有匹配的号码" : "这里还没有号码"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : (
          <table className="grid-table" data-density={density}>
            <thead>
              <tr>
                {sub === "reply" ? <th style={{ width: 38 }} /> : null}
                <th style={{ width: 132, textAlign: "center" }}>手机号</th>
                <th style={{ width: 118, textAlign: "center" }}>来源</th>
                <th style={{ width: 250 }}>客户资料</th>
                <th style={{ width: 190 }}>
                  {sub === "archived" ? "归档原因" : "客户情况"}
                </th>
                <th style={{ width: 100, textAlign: "center" }}>当前状态</th>
                <th style={{ width: sub === "archived" ? 160 : 336, textAlign: "center" }}>
                  {sub === "archived" ? "操作" : "本次处理"}
                </th>
              </tr>
            </thead>
            <tbody ref={bodyRef}>
              {visible.map((lead, idx) => {
                const st = stageOf(lead);
                const dev = edits[lead.id]?.device ?? lead.device;
                return (
                  <tr key={lead.id}
                    data-cursor={sub === "reply" && idx === cursor ? "1" : undefined}
                    onClick={() => sub === "reply" && setCursor(idx)}>
                    {sub === "reply" ? (
                      <td style={{ textAlign: "center" }}>
                        <input type="checkbox" checked={selected.has(lead.id)}
                          onChange={() => toggle(lead.id)} style={{ width: 16, height: 16, cursor: "pointer" }} />
                      </td>
                    ) : null}
                    <td style={{ fontWeight: 700, whiteSpace: "nowrap", textAlign: "center" }}>
                      {formatPhone(lead.phone)}
                      {lead.isHistoricalRecord ? (
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--warn)", marginTop: 2 }}>历史补录</div>
                      ) : null}
                    </td>
                    <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap", fontSize: 12.5, textAlign: "center" }}>
                      {lead.channel}<br /><span style={{ color: "var(--ink-3)" }}>{lead.sourceDate}</span>
                    </td>
                    <td><ProfileCell lead={lead} /></td>
                    <td style={{ color: "var(--ink-2)" }}>
                      {sub === "archived"
                        ? lead.archiveReason
                        : <Cell lead={lead} field="note" value={lead.lastVisitNote ?? ""} wrap />}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span className="badge" data-tone={st.tone}>{st.label}</span>
                      {sub === "invalid" ? (
                        <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--warn)" }} title={lead.invalidReason}>
                          {lead.invalidKind === "LOW_AMOUNT" ? "低金额" : "无 WhatsApp"}
                        </div>
                      ) : null}
                    </td>

                    <td style={{ textAlign: "center" }}>
                      {sub === "archived" ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center" }}>
                          <button className="btn" data-size="sm" onClick={() => setDrawer(lead)}>详情</button>
                          <button className="btn" data-size="sm" data-variant="primary" onClick={() => askRestore(lead)}>恢复</button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center", flexWrap: "nowrap" }}>
                          <button className="btn" data-size="sm" style={{ flexShrink: 0 }} onClick={() => setDrawer(lead)}>详情</button>
                          <input className="field" list="device-options" style={{ width: 84, height: 30, flexShrink: 0 }}
                            placeholder="设备号" defaultValue={dev} aria-label="接粉设备号"
                            onBlur={(e) => {
                              if (!e.target.value.trim()) { e.target.value = dev; onToast(`请为 ${lead.phone} 填写设备号`, "warn"); return; }
                              patch(lead.id, { device: e.target.value.trim() });
                            }} />
                          <button className="btn" data-size="sm" style={{ flexShrink: 0 }} onClick={() => askVisit(lead)}>
                            <IconPlus size={14} />回访 {lead.visits}
                          </button>
                          <button className="btn" data-size="sm" data-variant="primary" style={{ flexShrink: 0 }} onClick={() => askReply(lead)}>
                            <IconCheck size={14} />已回复
                          </button>

                          {/* 更多菜单 */}
                          <div style={{ position: "relative", flexShrink: 0 }}>
                            <button className="btn" data-size="sm"
                              onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === lead.id ? null : lead.id); }}>
                              更多 ▾
                            </button>
                            {menuFor === lead.id ? (
                              <div onClick={(e) => e.stopPropagation()} style={{
                                position: "absolute", right: 0, top: 34, zIndex: 20, minWidth: 158,
                                background: "var(--surface)", border: "1px solid var(--line-strong)",
                                borderRadius: "var(--radius)", boxShadow: "0 10px 28px rgba(19,24,36,.15)",
                                padding: 4, display: "flex", flexDirection: "column",
                              }}>
                                {sub === "invalid" ? (
                                  <MenuItem onClick={() => { setMenuFor(null); askRestoreValid(lead); }}>恢复为有效</MenuItem>
                                ) : (
                                  <MenuItem onClick={() => { setMenuFor(null); askInvalidate(lead); }}>改判无效库</MenuItem>
                                )}
                                <MenuItem danger onClick={() => { setMenuFor(null); askVoid(lead); }}>
                                  {lead.visits === 0 && !lead.repliedAt ? "删除错误导入" : "标记误录"}
                                </MenuItem>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!visible.length ? (
                <tr>
                  <td colSpan={7} style={{ padding: "44px 0", textAlign: "center", color: "var(--ink-3)" }}>
                    {search.trim() || batch !== BATCHES[0] ? "没有匹配的号码"
                      : sub === "reply" ? "待回复已清空 —— 今天的活干完了" : "这里还没有号码"}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          )}
        </div>

        {/* 分页 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, padding: "10px 16px", borderTop: "1px solid var(--line)", flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
            共 <strong className="tnum">{filtered.length}</strong> 位客户 · 第 {safePage}/{pageCount} 页 · 每页 {PAGE_SIZE} 条
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="btn" data-size="sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>上一页</button>
            <button className="btn" data-size="sm" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>下一页</button>
            <span style={{ fontSize: 13, color: "var(--ink-3)" }}>跳至</span>
            <input className="field" style={{ width: 58, height: 30, textAlign: "center" }} inputMode="numeric"
              defaultValue={safePage} key={safePage}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const n = Number((e.target as HTMLInputElement).value);
                if (Number.isInteger(n) && n >= 1 && n <= pageCount) setPage(n);
              }} />
            <span style={{ fontSize: 13, color: "var(--ink-3)" }}>页</span>
          </div>
        </div>
      </div>

      <datalist id="device-options">
        {DEVICES.map((d) => <option key={d} value={d} />)}
      </datalist>

      <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)" }}>
        {sub === "reply"
          ? "待回复固定按来源日期→回访次数排序，最该联系的客户排最前面，不能改 · 姓名/金额/平台/客户情况可直接点击修改"
          : sub === "group"
          ? "已回复待入群固定按准备拉群优先、同类按回复时间排序，不能改 · 姓名/金额/平台/客户情况可直接点击修改"
          : "点表头可切换排序 · 姓名/金额/平台/客户情况可直接点击修改"}
      </p>

      <CustomerDrawer lead={drawer} onClose={() => setDrawer(null)} />
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 7, width: "100%",
        padding: "8px 10px", border: "none", borderRadius: 7, cursor: "pointer",
        background: "transparent", textAlign: "left", fontSize: 13.5, fontWeight: 500,
        color: danger ? "var(--bad)" : "var(--ink)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-sunken)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
      {children}
    </button>
  );
}
