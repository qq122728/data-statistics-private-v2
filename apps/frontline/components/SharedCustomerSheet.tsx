"use client";

import { useMemo, useState } from "react";
import type { WorkRole } from "@/lib/frontline-entry";
import { IconCheck, IconClock, IconLock, IconPlus, IconSearch } from "./Icons";

type ReceptionResult = "待处理" | "有效粉" | "撞粉" | "无WS" | "低金额";
type GroupStatus = "待接手" | "跟进中" | "已进群" | "正常退群" | "异常退群";
type ExpertStage = "未分配" | "排队中" | "交资料" | "追踪中" | "待注册" | "待开单" | "已开单" | "未成交";

type CustomerRow = {
  id: string;
  phone: string;
  sourceDate: string;
  channel: string;
  receptionOwner: string;
  receptionResult: ReceptionResult;
  replied: boolean;
  groupOwner: string;
  groupStatus: GroupStatus;
  expertOwner: string;
  expertStage: ExpertStage;
  deposit: number;
  nextFollowUp: string;
  note: string;
  updatedBy: string;
};

const ROLE_LABEL: Record<WorkRole, string> = { LEAD: "组长", RECEPTION: "接粉", GROUP_OPERATOR: "炒群", EXPERT: "专家" };
const RECEPTION_RESULTS: ReceptionResult[] = ["待处理", "有效粉", "撞粉", "无WS", "低金额"];
const GROUP_STATUSES: GroupStatus[] = ["待接手", "跟进中", "已进群", "正常退群", "异常退群"];
const EXPERT_STAGES: ExpertStage[] = ["未分配", "排队中", "交资料", "追踪中", "待注册", "待开单", "已开单", "未成交"];
const CHANNELS = ["FB-M", "FB-Q", "短信粉嘉豪", "德国投流 B"];
const RECEPTION_OWNERS = ["阿泽", "小七", "牛少", "安强"];
const GROUP_OWNERS = ["金水", "阿彪", "毛泰"];
const EXPERT_OWNERS = ["名将", "黑八", "阿阳"];

const DEMO_ROWS: CustomerRow[] = [
  { id: "demo-1", phone: "4917 6234 8891", sourceDate: "2026-08-30", channel: "FB-M", receptionOwner: "阿泽", receptionResult: "有效粉", replied: true, groupOwner: "金水", groupStatus: "已进群", expertOwner: "名将", expertStage: "追踪中", deposit: 0, nextFollowUp: "2026-08-31", note: "客户已交资料，晚上继续跟进", updatedBy: "名将 · 16:42" },
  { id: "demo-2", phone: "4915 8891 0032", sourceDate: "2026-08-30", channel: "FB-Q", receptionOwner: "阿泽", receptionResult: "有效粉", replied: true, groupOwner: "阿彪", groupStatus: "跟进中", expertOwner: "", expertStage: "未分配", deposit: 0, nextFollowUp: "2026-08-31", note: "已回复，等待客户确认进群", updatedBy: "阿彪 · 15:18" },
  { id: "demo-3", phone: "4916 2379 2917", sourceDate: "2026-08-30", channel: "FB-M", receptionOwner: "小七", receptionResult: "有效粉", replied: true, groupOwner: "金水", groupStatus: "已进群", expertOwner: "黑八", expertStage: "已开单", deposit: 2500, nextFollowUp: "2026-09-01", note: "首充已到账，明天继续维护", updatedBy: "黑八 · 14:26" },
  { id: "demo-4", phone: "4913 5017 6624", sourceDate: "2026-08-30", channel: "FB-Q", receptionOwner: "牛少", receptionResult: "无WS", replied: false, groupOwner: "", groupStatus: "待接手", expertOwner: "", expertStage: "未分配", deposit: 0, nextFollowUp: "", note: "号码没有 WhatsApp", updatedBy: "牛少 · 13:50" },
  { id: "demo-5", phone: "4918 6621 7580", sourceDate: "2026-08-29", channel: "德国投流 B", receptionOwner: "安强", receptionResult: "有效粉", replied: true, groupOwner: "毛泰", groupStatus: "已进群", expertOwner: "阿阳", expertStage: "待注册", deposit: 0, nextFollowUp: "2026-08-31", note: "已约好下午协助注册", updatedBy: "阿阳 · 12:05" },
  { id: "demo-6", phone: "4912 3356 9088", sourceDate: "2026-08-29", channel: "FB-M", receptionOwner: "小七", receptionResult: "撞粉", replied: false, groupOwner: "", groupStatus: "待接手", expertOwner: "", expertStage: "未分配", deposit: 0, nextFollowUp: "", note: "系统发现同号码历史记录", updatedBy: "系统 · 11:32" },
];

function today() {
  return new Intl.DateTimeFormat("en-CA").format(new Date());
}

function stageOf(row: CustomerRow) {
  if (row.expertStage !== "未分配") return "专家";
  if (row.groupStatus !== "待接手") return "炒群";
  return "接粉";
}

function rowTone(row: CustomerRow) {
  if (["撞粉", "无WS", "低金额"].includes(row.receptionResult)) return "bad";
  if (row.expertStage === "已开单") return "ok";
  if (row.nextFollowUp && row.nextFollowUp <= today()) return "warn";
  return "neutral";
}

function phoneValues(text: string) {
  return text
    .split(/[\n,，;；\t]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
}

export function SharedCustomerSheet({ role }: { role: WorkRole }) {
  const [rows, setRows] = useState<CustomerRow[]>(DEMO_ROWS);
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("全部");
  const [adding, setAdding] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(DEMO_ROWS[0]?.id ?? null);
  const [savedMessage, setSavedMessage] = useState("");

  const filteredRows = useMemo(() => rows.filter((row) => {
    const text = `${row.phone} ${row.channel} ${row.receptionOwner} ${row.groupOwner} ${row.expertOwner} ${row.note}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase())) && (stageFilter === "全部" || stageOf(row) === stageFilter);
  }), [query, rows, stageFilter]);

  const summary = useMemo(() => ({
    total: rows.length,
    valid: rows.filter((row) => row.receptionResult === "有效粉").length,
    joined: rows.filter((row) => row.groupStatus === "已进群").length,
    ordered: rows.filter((row) => row.expertStage === "已开单").length,
    deposit: rows.reduce((sum, row) => sum + row.deposit, 0),
  }), [rows]);

  const selected = rows.find((row) => row.id === selectedId) ?? null;

  function updateRow<K extends keyof CustomerRow>(id: string, key: K, value: CustomerRow[K]) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, [key]: value, updatedBy: `当前${ROLE_LABEL[role]} · 刚刚` } : row));
    setSavedMessage("已自动保存，并写入修改记录");
    window.setTimeout(() => setSavedMessage(""), 2200);
  }

  function makeRow(phone: string, index = 0): CustomerRow {
    return {
      id: `new-${Date.now()}-${index}`,
      phone,
      sourceDate: today(),
      channel: "FB-M",
      receptionOwner: RECEPTION_OWNERS[0],
      receptionResult: "待处理",
      replied: false,
      groupOwner: "",
      groupStatus: "待接手",
      expertOwner: "",
      expertStage: "未分配",
      deposit: 0,
      nextFollowUp: "",
      note: "",
      updatedBy: "当前接粉 · 刚刚",
    };
  }

  function addOne() {
    const phone = newPhone.trim();
    if (!phone) return;
    if (rows.some((row) => row.phone.replace(/\s/g, "") === phone.replace(/\s/g, ""))) {
      setSavedMessage("这个号码已经在共享表格中");
      return;
    }
    const row = makeRow(phone);
    setRows((current) => [row, ...current]);
    setSelectedId(row.id);
    setNewPhone("");
    setAdding(false);
    setSavedMessage("号码已新增到客户进度；不会改变每日数据");
  }

  function addPasted() {
    const existing = new Set(rows.map((row) => row.phone.replace(/\s/g, "")));
    const phones = phoneValues(pasteText).filter((phone) => !existing.has(phone.replace(/\s/g, "")));
    if (!phones.length) {
      setSavedMessage("没有发现可以新增的号码");
      return;
    }
    const additions = phones.map((phone, index) => makeRow(phone, index));
    setRows((current) => [...additions, ...current]);
    setSelectedId(additions[0].id);
    setPasteText("");
    setPasteOpen(false);
    setSavedMessage(`已新增 ${additions.length} 个号码，重复号码已自动跳过`);
  }

  const canReception = role === "RECEPTION";
  const canGroup = role === "GROUP_OPERATOR";
  const canExpert = role === "EXPERT";

  return <section className="shared-sheet">
    <div className="shared-sheet__intro card">
      <div>
        <div className="shared-sheet__eyebrow"><span className="shared-sheet__live-dot" />共享客户表 · 自动保存</div>
        <h2>一个客户一行，三个岗位接着做</h2>
        <p>接粉直接填写号码；炒群和专家在同一行继续跟进。当前是 <strong>{ROLE_LABEL[role]}</strong> 身份，只开放蓝色列。</p>
      </div>
      <div className="shared-sheet__stats">
        <div><span>客户</span><strong>{summary.total}</strong></div>
        <div><span>有效粉</span><strong>{summary.valid}</strong></div>
        <div><span>已进群</span><strong>{summary.joined}</strong></div>
        <div><span>已开单</span><strong>{summary.ordered}</strong></div>
        <div><span>累计入金</span><strong>${summary.deposit.toLocaleString()}</strong></div>
      </div>
    </div>

    {canReception && (adding || pasteOpen) ? <div className="shared-sheet__entry card">
      {adding ? <div className="shared-sheet__entry-row">
        <div><strong>直接新增一位客户</strong><p>只需要先填号码，渠道和负责人会带出默认值。</p></div>
        <input className="field" value={newPhone} onChange={(event) => setNewPhone(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addOne(); }} placeholder="在这里填写手机号" autoFocus />
        <button className="btn" data-variant="primary" onClick={addOne}><IconCheck size={16} />保存到表格</button>
        <button className="btn" onClick={() => setAdding(false)}>取消</button>
      </div> : null}
      {pasteOpen ? <div className="shared-sheet__paste">
        <div><strong>一次粘贴多个号码</strong><p>每行一个，也支持逗号或制表符分隔；重复号码会跳过。</p></div>
        <textarea className="field" rows={4} value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder={"4917 1234 5678\n4916 2345 6789\n4915 3456 7890"} autoFocus />
        <div><button className="btn" data-variant="primary" onClick={addPasted}><IconCheck size={16} />加入共享表格</button><button className="btn" onClick={() => setPasteOpen(false)}>取消</button></div>
      </div> : null}
    </div> : null}

    <div className="shared-sheet__toolbar card">
      <div className="shared-sheet__filters">
        {["全部", "接粉", "炒群", "专家"].map((stage) => <button key={stage} className="shared-sheet__filter" data-active={stageFilter === stage} onClick={() => setStageFilter(stage)}>{stage}</button>)}
      </div>
      <label className="shared-sheet__search"><IconSearch size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索号码、渠道或负责人" /></label>
      {canReception ? <div className="shared-sheet__actions"><button className="btn" onClick={() => { setPasteOpen(true); setAdding(false); }}>粘贴多个号码</button><button className="btn" data-variant="primary" onClick={() => { setAdding(true); setPasteOpen(false); }}><IconPlus size={16} />新增一行</button></div> : <span className="shared-sheet__role-lock"><IconLock size={14} />当前只能编辑{ROLE_LABEL[role]}列</span>}
    </div>

    <div className="shared-sheet__layout">
      <div className="shared-sheet__table-card card">
        <div className="shared-sheet__scroll">
          <table className="shared-sheet__table">
            <thead>
              <tr className="shared-sheet__group-head">
                <th rowSpan={2}>#</th><th colSpan={3}>客户基础</th>
                <th colSpan={3} data-owned={canReception}>接粉</th>
                <th colSpan={2} data-owned={canGroup}>炒群</th>
                <th colSpan={3} data-owned={canExpert}>专家与资金</th>
                <th rowSpan={2}>最后更新</th>
              </tr>
              <tr><th>手机号</th><th>下发日期</th><th>渠道</th><th>负责人</th><th>粉质结果</th><th>回复</th><th>负责人</th><th>进群状态</th><th>负责人</th><th>专家阶段</th><th>入金</th></tr>
            </thead>
            <tbody>
              {filteredRows.map((row, index) => <tr key={row.id} data-selected={row.id === selectedId} onClick={() => setSelectedId(row.id)}>
                <td className="shared-sheet__row-num">{index + 1}</td>
                <td className="shared-sheet__phone"><span className="shared-sheet__stage" data-stage={stageOf(row)}>{stageOf(row)}</span><strong>{row.phone}</strong></td>
                <td><input value={row.sourceDate} type="date" disabled={!canReception} onChange={(event) => updateRow(row.id, "sourceDate", event.target.value)} /></td>
                <td><select value={row.channel} disabled={!canReception} onChange={(event) => updateRow(row.id, "channel", event.target.value)}>{CHANNELS.map((value) => <option key={value}>{value}</option>)}</select></td>
                <td data-owned={canReception}><select value={row.receptionOwner} disabled={!canReception} onChange={(event) => updateRow(row.id, "receptionOwner", event.target.value)}>{RECEPTION_OWNERS.map((value) => <option key={value}>{value}</option>)}</select></td>
                <td data-owned={canReception}><select value={row.receptionResult} disabled={!canReception} data-tone={rowTone(row)} onChange={(event) => updateRow(row.id, "receptionResult", event.target.value as ReceptionResult)}>{RECEPTION_RESULTS.map((value) => <option key={value}>{value}</option>)}</select></td>
                <td data-owned={canReception}><label className="shared-sheet__check"><input type="checkbox" checked={row.replied} disabled={!canReception} onChange={(event) => updateRow(row.id, "replied", event.target.checked)} /><span>{row.replied ? "已回复" : "未回复"}</span></label></td>
                <td data-owned={canGroup}><select value={row.groupOwner} disabled={!canGroup} onChange={(event) => updateRow(row.id, "groupOwner", event.target.value)}><option value="">待分配</option>{GROUP_OWNERS.map((value) => <option key={value}>{value}</option>)}</select></td>
                <td data-owned={canGroup}><select value={row.groupStatus} disabled={!canGroup} data-tone={rowTone(row)} onChange={(event) => updateRow(row.id, "groupStatus", event.target.value as GroupStatus)}>{GROUP_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></td>
                <td data-owned={canExpert}><select value={row.expertOwner} disabled={!canExpert} onChange={(event) => updateRow(row.id, "expertOwner", event.target.value)}><option value="">待分配</option>{EXPERT_OWNERS.map((value) => <option key={value}>{value}</option>)}</select></td>
                <td data-owned={canExpert}><select value={row.expertStage} disabled={!canExpert} data-tone={rowTone(row)} onChange={(event) => updateRow(row.id, "expertStage", event.target.value as ExpertStage)}>{EXPERT_STAGES.map((value) => <option key={value}>{value}</option>)}</select></td>
                <td data-owned={canExpert}><label className="shared-sheet__money"><span>$</span><input type="number" min="0" value={row.deposit || ""} disabled={!canExpert} placeholder="0" onChange={(event) => updateRow(row.id, "deposit", Number(event.target.value))} /></label></td>
                <td className="shared-sheet__updated"><IconClock size={13} />{row.updatedBy}</td>
              </tr>)}
              {!filteredRows.length ? <tr><td colSpan={13} className="shared-sheet__empty">没有符合当前筛选的客户</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="shared-sheet__footer"><span>共 {filteredRows.length} 行 · 修改自动保存</span><span><i />系统每次修改都会保留操作人和时间</span></div>
      </div>

      <aside className="shared-sheet__detail card">
        {selected ? <>
          <div className="shared-sheet__detail-head"><div><span>当前选中</span><strong>{selected.phone}</strong></div><span className="shared-sheet__stage" data-stage={stageOf(selected)}>{stageOf(selected)}阶段</span></div>
          <label><span>最新跟进情况</span><textarea className="field" rows={5} value={selected.note} onChange={(event) => updateRow(selected.id, "note", event.target.value)} placeholder="填写客户现在谈到哪里、下一步做什么" /></label>
          <label><span>下次跟进日期</span><input className="field" type="date" value={selected.nextFollowUp} onChange={(event) => updateRow(selected.id, "nextFollowUp", event.target.value)} /></label>
          <div className="shared-sheet__timeline"><strong>这行数据如何流转</strong><div data-done><i />接粉 · {selected.receptionOwner}</div><div data-done={selected.groupStatus !== "待接手"}><i />炒群 · {selected.groupOwner || "尚未分配"}</div><div data-done={selected.expertStage !== "未分配"}><i />专家 · {selected.expertOwner || "尚未分配"}</div></div>
          <button className="btn" style={{ width: "100%", justifyContent: "center" }}>查看完整修改记录</button>
        </> : <div className="shared-sheet__empty">点击一行查看跟进详情</div>}
      </aside>
    </div>

    {savedMessage ? <div className="shared-sheet__toast"><IconCheck size={17} />{savedMessage}</div> : null}
  </section>;
}
