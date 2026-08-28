import { CaretDown, Check, ChatCircleDots, ClipboardText, Eye, FileArrowUp, PhoneCall, Plus } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { EntryChannel } from "./ChannelCombobox";
import type { EntryException as Exception, EntryLead as Lead } from "./entry-types";
import { EntryWorkflowNextStep, EntryWorkflowStatus } from "./EntryWorkflowStatus";
import { parseCustomerImportClipboard } from "../../lib/customer-import-clipboard";
import { parseCustomerImportFile } from "../../lib/customer-import-file";

export type ReceptionLeadAction = "restoreValid" | "followUp" | "reply" | "undoReply" | "joinGroup" | "leaveGroup";
export type ImportBatchSummary = {
  id: string;
  sourceDate: string;
  channelName: string;
  total: number;
  valid: number;
  lowAmount: number;
  noWs: number;
  collision: number;
};

export type ImportCustomerRow = {
  id: string;
  phone: string;
  customerName: string;
  customerEmail: string;
  deviceMode: "SELECT" | "MANUAL";
  deviceId: string;
  deviceCode: string;
  lossAmount: string;
  customerPlatform: string;
  notes: string;
  // 实际录入人不变；这项决定客户归属到哪位同组成员的业务／代理线。
  attributionOwnerId?: string;
};

function channelTypeLabel(type: "SMS" | "ADS" | "REBATE") {
  return type === "ADS" ? "投流粉" : type === "REBATE" ? "底料返点" : "短信粉";
}

type SharedRowProps = {
  context: (lead: Lead) => ReactNode;
  notes: (lead: Lead) => ReactNode;
  empty: (text: string) => ReactNode;
  actionDisabled: (lead: Lead) => boolean;
  onAction: (lead: Lead, action: ReceptionLeadAction, extra?: Record<string, unknown>) => void;
};

export function EntryImportPanel({
  channels, leads, sourceDate, channelId, newChannelName, newChannelType, addingChannel, importRows, devices,
  attributionOwners = [], defaultAttributionOwnerId = "", allowMemberChannelCreation, busy, recognizedPhoneCount,
  onSourceDate, onChannelId, onNewChannelName, onNewChannelType, onAddingChannel, onImportRows,
  onCreateChannel, onConfirmImport, onClearImportRows, onAddImportRow,
  batchSummaries, selectedBatchId, onViewBatch, onCloseBatch,
}: SharedRowProps & {
  channels: EntryChannel[];
  leads: Lead[];
  sourceDate: string;
  channelId: string;
  newChannelName: string;
  newChannelType: "SMS" | "ADS" | "REBATE";
  addingChannel: boolean;
  importRows: ImportCustomerRow[];
  devices: Array<{ id: string; code: string }>;
  attributionOwners?: Array<{ id: string; name: string }>;
  defaultAttributionOwnerId?: string;
  allowMemberChannelCreation: boolean;
  busy: string;
  recognizedPhoneCount: number;
  onSourceDate: (value: string) => void;
  onChannelId: (value: string) => void;
  onNewChannelName: (value: string) => void;
  onNewChannelType: (value: "SMS" | "ADS" | "REBATE") => void;
  onAddingChannel: (value: boolean) => void;
  onImportRows: (rows: ImportCustomerRow[]) => void;
  onCreateChannel: () => void;
  onConfirmImport: () => void;
  onClearImportRows: () => void;
  onAddImportRow: (attributionOwnerId?: string) => void;
  batchSummaries: ImportBatchSummary[];
  selectedBatchId: string;
  onViewBatch: (batchId: string) => void;
  onCloseBatch: () => void;
}) {
  const selectedBatch = batchSummaries.find((batch) => batch.id === selectedBatchId);
  const selectedChannel = channels.find((channel) => channel.id === channelId);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteErrors, setPasteErrors] = useState<string[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [fileImporting, setFileImporting] = useState(false);
  const [channelPickerOpen, setChannelPickerOpen] = useState(false);
  const [importAttributionOwnerId, setImportAttributionOwnerId] = useState(defaultAttributionOwnerId);
  const excelFileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setImportAttributionOwnerId(defaultAttributionOwnerId);
  }, [defaultAttributionOwnerId]);

  function updateDefaultAttributionOwner(nextOwnerId: string) {
    setImportAttributionOwnerId(nextOwnerId);
    onImportRows(importRows.map((row) => (
      !row.phone.trim()
        ? { ...row, attributionOwnerId: nextOwnerId }
        : row
    )));
  }

  function applyExcelPaste() {
    const parsed = parseCustomerImportClipboard(pasteText, devices, (index) => `paste-${Date.now()}-${index}`);
    setPasteErrors(parsed.errors);
    if (!parsed.rows.length) return;
    const nonEmptyRows = importRows.filter((row) => [row.phone, row.customerName, row.customerEmail, row.lossAmount, row.customerPlatform, row.notes].some((value) => value.trim()));
    onImportRows([...nonEmptyRows, ...parsed.rows.map((row) => ({ ...row, attributionOwnerId: importAttributionOwnerId }))]);
    setPasteOpen(false);
    setPasteText("");
  }
  async function loadExcelFile(file: File) {
    setFileImporting(true);
    setFileErrors([]);
    const parsed = await parseCustomerImportFile(file, devices, (index) => `file-${Date.now()}-${index}`);
    setFileErrors(parsed.errors);
    if (parsed.rows.length) {
      const nonEmptyRows = importRows.filter((row) => [row.phone, row.customerName, row.customerEmail, row.lossAmount, row.customerPlatform, row.notes].some((value) => value.trim()));
      onImportRows([...nonEmptyRows, ...parsed.rows.map((row) => ({ ...row, attributionOwnerId: importAttributionOwnerId }))]);
    }
    setFileImporting(false);
  }
  function updateImportRow(id: string, change: Partial<ImportCustomerRow>) {
    onImportRows(importRows.map((item) => item.id === id ? { ...item, ...change } : item));
  }
  return <section className="member-panel member-import-workspace">
    <div className="member-panel-title member-import-page-heading"><div><p>客户管理 / 号码导入</p><h3>号码导入</h3><span>通过 Excel 或粘贴方式批量导入客户号码，系统会自动查重并记录结果。</span></div><div className="member-import-heading-actions"><strong>已填写 {recognizedPhoneCount} 位</strong><button type="button" className="member-primary member-import-submit" onClick={onConfirmImport} disabled={!recognizedPhoneCount || busy === "import" || fileImporting}><FileArrowUp size={17} weight="bold" />{busy === "import" ? "导入中…" : "确认导入"}</button></div></div>
    <div className="member-import member-import-redesign">
      <section className="member-import-step member-import-source-card" aria-label="选择导入来源">
        <div className="member-import-step-heading"><span>1</span><div><strong>选择来源</strong><small>确认本次导入的日期、渠道和粉的归属。</small></div></div>
        <div className="member-import-source-settings">
          <label><span>导入日期</span><input type="date" value={sourceDate} onChange={(event) => onSourceDate(event.target.value)} /></label>
          <div className="member-import-source-field"><span>来源渠道</span><span className="member-channel-select"><span className="member-channel-picker"><button type="button" className="member-channel-picker-trigger" aria-haspopup="listbox" aria-expanded={channelPickerOpen} aria-controls="entry-channel-picker-options" onClick={() => setChannelPickerOpen((open) => !open)} onKeyDown={(event) => { if (event.key === "Escape") setChannelPickerOpen(false); }}><span><small>{selectedChannel ? channelTypeLabel(selectedChannel.channelType ?? "SMS") : "来源渠道"}</small><strong>{selectedChannel?.name ?? "请选择渠道"}</strong></span><CaretDown size={16} weight="bold" /></button>{channelPickerOpen ? <span id="entry-channel-picker-options" role="listbox" className="member-channel-picker-options">{channels.map((channel) => <button key={channel.id} type="button" role="option" aria-selected={channel.id === channelId} className="member-channel-picker-option" onClick={() => { onChannelId(channel.id); setChannelPickerOpen(false); }}><span className="member-channel-picker-type">{channelTypeLabel(channel.channelType ?? "SMS")}</span><strong>{channel.name}</strong>{channel.id === channelId ? <Check size={16} weight="bold" /> : null}</button>)}{!channels.length ? <span className="member-channel-picker-empty">暂无可选渠道</span> : null}</span> : null}</span>{allowMemberChannelCreation ? <button type="button" className="member-channel-add-button" onClick={() => { onAddingChannel(true); onNewChannelName(""); }}><Plus size={14} />新增渠道</button> : null}</span></div>
          <label className="member-import-default-owner"><span>粉的归属（默认）</span><select aria-label="默认粉的归属" value={importAttributionOwnerId} onChange={(event) => updateDefaultAttributionOwner(event.target.value)}>{attributionOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select><small>下方每一行仍可单独修改。</small></label>
        </div>
        <p className="member-import-toolbar-note">{selectedChannel?.channelType === "ADS" ? "共享投流批次请使用相同渠道和日期导入。" : "这里只导入要继续跟进的有效客户；设备号会在待回复时再选择。"}</p>
      </section>
      <section className="member-import-step member-import-customer-step" aria-label="导入客户">
        <div className="member-import-step-heading"><span>2</span><div><strong>导入客户</strong><small>选择录入方式，确认后会在下方先生成可编辑预览。</small></div></div>
        <input ref={excelFileInputRef} className="sr-only" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void loadExcelFile(file); }} />
        <div className="member-import-methods" aria-label="导入方式"><button type="button" className="member-import-method member-import-file-method" onClick={() => excelFileInputRef.current?.click()} disabled={busy === "import" || fileImporting}><FileArrowUp size={26} weight="duotone" /><span><strong>{fileImporting ? "读取文件中…" : "上传 Excel 文件"}</strong><small>支持 .xlsx / .csv，单个文件不超过 10MB</small></span></button><button type="button" className="member-import-method" onClick={() => { setPasteOpen(true); setPasteErrors([]); }} disabled={busy === "import" || fileImporting}><ClipboardText size={26} weight="duotone" /><span><strong>从 Excel 粘贴</strong><small>复制 Excel 内容后，直接粘贴到表格中</small></span></button></div>
      {fileErrors.length ? <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{fileErrors.map((error) => <p key={error}>{error}</p>)}</div> : null}
      <div className="member-phone-paste">
            <span className="member-phone-paste-heading"><span>客户资料预览</span><span className="member-import-preview-actions"><button type="button" className="member-secondary member-import-add-row-button" onClick={() => onAddImportRow(importAttributionOwnerId)} disabled={busy === "import" || fileImporting}><Plus size={15} />新增一行</button>{recognizedPhoneCount ? <button type="button" className="member-import-clear-button" onClick={onClearImportRows} disabled={busy === "import" || fileImporting}>清空本次录入</button> : null}</span></span>
            <div className="member-import-customer-list" aria-label="客户资料录入表">
              <div className="member-import-table-head" aria-hidden="true"><span>客户编号 *</span><span>客户姓名</span><span>邮箱</span><span>金额（美元）</span><span>客户平台</span><span>粉的归属</span><span>操作</span></div>
              {importRows.map((row, index) => <section className="member-import-customer-row" key={row.id} aria-label={`第 ${index + 1} 位客户资料`}>
                <label><span className="member-import-cell-label">客户编号 *</span><input aria-label={`${row.id} 客户编号`} value={row.phone} onChange={(event) => updateImportRow(row.id, { phone: event.target.value })} placeholder="输入六码编号" inputMode="numeric" /></label>
                <label><span className="member-import-cell-label">客户姓名</span><input aria-label={`${row.id} 客户姓名`} value={row.customerName} onChange={(event) => updateImportRow(row.id, { customerName: event.target.value })} placeholder="可稍后填" /></label>
                <label><span className="member-import-cell-label">邮箱</span><input aria-label={`${row.id} 邮箱`} type="text" inputMode="email" value={row.customerEmail} onChange={(event) => updateImportRow(row.id, { customerEmail: event.target.value })} placeholder="name@example.com" /></label>
                <label><span className="member-import-cell-label">金额（美元）</span><input aria-label={`${row.id} 客户金额`} type="number" min="0" step="0.01" value={row.lossAmount} onChange={(event) => updateImportRow(row.id, { lossAmount: event.target.value })} placeholder="可稍后填" /></label>
                <label><span className="member-import-cell-label">客户平台</span><input aria-label={`${row.id} 客户平台`} value={row.customerPlatform} onChange={(event) => updateImportRow(row.id, { customerPlatform: event.target.value })} placeholder="如 MT5、Web" /></label>
                <label><span className="member-import-cell-label">粉的归属</span><select aria-label={`${row.id} 粉的归属`} value={row.attributionOwnerId || importAttributionOwnerId} onChange={(event) => updateImportRow(row.id, { attributionOwnerId: event.target.value })}>{attributionOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
                <button type="button" className="member-secondary small member-import-row-delete" onClick={() => onImportRows(importRows.length === 1 ? importRows : importRows.filter((item) => item.id !== row.id))} disabled={busy === "import"}>删除</button>
              </section>)}
            </div>
            <small>“粉的归属”决定这位客户后续业绩归属到哪条业务／代理线；实际录入人仍是当前登录账号。设备号会在“待回复”里，实际联系客户时再选择。</small>
      </div>
      </section>
    </div>
    {addingChannel ? <div className="member-channel-dialog-backdrop" role="dialog" aria-modal="true" aria-label="新增来源渠道">
      <div className="member-channel-dialog-card">
        <div className="member-channel-dialog-heading"><div><span>来源设置</span><h3>新增来源渠道</h3><p>创建后会自动选中这个渠道；渠道价格仍由资源部统一维护。</p></div><button type="button" className="member-channel-dialog-close" onClick={() => { onAddingChannel(false); onNewChannelName(""); }} disabled={busy === "create-channel"}>关闭</button></div>
        <div className="member-channel-dialog-fields">
          <label><span>渠道类型</span><select aria-label="新渠道类型" value={newChannelType} onChange={(event) => onNewChannelType(event.target.value as "SMS" | "ADS" | "REBATE")}><option value="SMS">短信粉</option><option value="ADS">投流粉</option><option value="REBATE">底料返点</option></select></label>
          <label><span>具体渠道名称</span><input aria-label="新渠道名称" value={newChannelName} onChange={(event) => onNewChannelName(event.target.value)} placeholder="例如：美国短信 A / TikTok 广告 8 月" autoFocus onKeyDown={(event) => { if (event.key === "Enter" && newChannelName.trim()) onCreateChannel(); }} /></label>
        </div>
        <div className="member-channel-dialog-actions"><button type="button" className="member-secondary" onClick={() => { onAddingChannel(false); onNewChannelName(""); }} disabled={busy === "create-channel"}>取消</button><button type="button" className="member-primary" onClick={onCreateChannel} disabled={!newChannelName.trim() || busy === "create-channel"}><Plus size={16} />{busy === "create-channel" ? "创建中…" : "创建渠道"}</button></div>
      </div>
    </div> : null}
    <section className="member-import-history" aria-label="最近导入批次">
      <div className="member-import-history-title"><div><strong>最近导入批次</strong><span>按批次查看导入结果，不在这里堆全部历史客户</span></div><span>{batchSummaries.length} 个批次</span></div>
      <div className="member-table-wrap"><table className="member-table">
        <thead><tr><th>导入日期</th><th>来源渠道</th><th>当日添加数据</th><th>有效数据</th><th>撞粉</th><th>低金额</th><th>无 WS 号码</th><th>查看</th></tr></thead>
        <tbody>{batchSummaries.slice(0, 10).map((batch) => <tr key={batch.id}>
          <td>{batch.sourceDate}</td><td>{batch.channelName}</td><td>{batch.total}</td><td>{batch.valid}</td><td>{batch.collision}</td><td>{batch.lowAmount}</td><td>{batch.noWs}</td>
          <td><button type="button" className="inline-flex items-center gap-1" onClick={() => onViewBatch(batch.id)}><Eye size={15} />查看号码</button></td>
        </tr>)}{!batchSummaries.length ? <tr><td colSpan={8}>还没有导入批次，请先在上方粘贴并导入号码。</td></tr> : null}</tbody>
      </table></div>
    </section>
    {selectedBatch ? <section className="member-import-batch-detail">
      <div className="member-import-history-title"><div><strong>本批号码</strong><span>{selectedBatch.sourceDate} · {selectedBatch.channelName} · 共 {selectedBatch.total} 个</span></div><button type="button" className="member-secondary" onClick={onCloseBatch}>收起</button></div>
      <div className="member-table-wrap"><table className="member-table">
        <thead><tr><th>手机号</th><th>客户姓名</th><th>数据归类</th><th>当前状态</th><th>备注</th></tr></thead>
        <tbody>{leads.slice(0, 50).map((lead) => <tr key={lead.id} data-invalid={lead.invalid || undefined}>
          <td className="member-phone">{lead.phone}</td><td>{lead.customerName ?? "未填写姓名"}</td><td>{categoryLabel(lead.receptionCategory)}</td><td><EntryWorkflowStatus lead={lead} /></td><td>{lead.notes ?? "—"}</td>
        </tr>)}{!leads.length ? <tr><td colSpan={5}>这个批次暂无号码。</td></tr> : null}</tbody>
      </table></div>
      {leads.length > 50 ? <p className="member-import-batch-note">当前仅展示前 50 个号码。需要继续处理或搜索历史号码，请在本工作台的“接粉处理”中筛选。</p> : null}
    </section> : null}
    {pasteOpen ? <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label="从 Excel 粘贴客户资料"><div className="mx-auto my-8 max-w-2xl rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h3 className="text-xl font-bold text-slate-950">从 Excel 粘贴客户资料</h3><p className="mt-1 text-sm text-slate-600">可直接复制“被骗金额、被骗平台、邮箱、客户名字、WhatsApp”五列；WhatsApp 会自动取后六位作为客户编号。设备号不会从这里导入，实际联系客户时再到“待回复”选择。</p></div><button type="button" onClick={() => setPasteOpen(false)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100">关闭</button></div><textarea autoFocus value={pasteText} onChange={(event) => setPasteText(event.target.value)} rows={10} placeholder={"被骗金额（美元）\t被骗平台\t邮箱\t客户名字\tWhatsApp\n50000\tPfalz Finanz AG\tdieter-hellmann@t-online.de\tDieter Hellmann\t491713035238"} className="mt-5 w-full rounded-xl border border-slate-300 p-3 font-mono text-sm" />{pasteErrors.length ? <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{pasteErrors.map((error) => <p key={error}>{error}</p>)}</div> : null}<div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setPasteOpen(false)} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600">取消</button><button type="button" onClick={applyExcelPaste} disabled={!pasteText.trim()} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">载入表格预览</button></div></div></div> : null}
  </section>;
}

export function EntryReplyPanel({
  leads, devices, deviceDrafts, onDeviceDraft, onDeviceSave, onProfileFieldSave, onViewProfile, onDelete, onVoidErroneousEntry,
  context, notes, empty, actionDisabled, onAction,
  selectedIds, onToggleSelected, onToggleSelectAll, onBulkConfirmReply,
}: SharedRowProps & {
  leads: Lead[];
  devices: Array<{ id: string; code: string }>;
  deviceDrafts: Record<string, string>;
  onDeviceDraft: (lead: Lead, value: string) => void;
  onDeviceSave: (lead: Lead, value: string) => void;
  onProfileFieldSave: (lead: Lead, field: "customerName" | "customerEmail" | "lossAmount" | "customerPlatform" | "notes", value: string) => void;
  onViewProfile: (lead: Lead) => void;
  onDelete: (lead: Lead) => void;
  onVoidErroneousEntry: (lead: Lead) => void;
  selectedIds: Set<string>;
  onToggleSelected: (leadId: string) => void;
  onToggleSelectAll: () => void;
  onBulkConfirmReply: () => void;
}) {
  const selectableLeads = leads.filter((lead) => !actionDisabled(lead));
  const allSelected = selectableLeads.length > 0 && selectableLeads.every((lead) => selectedIds.has(lead.id));
  const selectedCount = leads.filter((lead) => selectedIds.has(lead.id)).length;
  return <section className="member-panel">
    <div className="member-panel-title"><div><p>第 2 步</p><h3>联系与回复</h3></div><span>这里只保留真正需要跟进的客户。撞粉、低金额、无 WS 号码请回“号码导入”下方单独登记数字，不会进入客户流程。</span></div>
    {leads.length ? <div className="member-bulk-bar">
      <label className="member-bulk-select-all"><input type="checkbox" checked={allSelected} onChange={onToggleSelectAll} aria-label="全选本页待回复号码" />全选本页</label>
      <span className="member-bulk-count">{selectedCount ? `已选 ${selectedCount} 位` : "先勾选号码，再批量处理"}</span>
      <button type="button" className="member-primary member-bulk-confirm-button" disabled={!selectedCount} onClick={onBulkConfirmReply}><ChatCircleDots size={16} weight="duotone" />批量确认已回复{selectedCount ? `（${selectedCount}）` : ""}</button>
    </div> : null}
    <div className="member-table-wrap"><table className="member-table member-reply-table">
      <colgroup>
        <col className="member-reply-select-column" />
        <col className="member-reply-phone-column" />
        <col className="member-reply-profile-column" />
        <col className="member-reply-status-column" />
        <col className="member-reply-actions-column" />
        <col className="member-reply-source-column" />
      </colgroup>
      <thead><tr><th aria-hidden="true" /><th>手机号</th><th>客户资料</th><th>当前状态</th><th>本次处理</th><th>来源</th></tr></thead>
      <tbody>{leads.map((lead) => <tr key={lead.id} data-reception-tone={receptionRowTone(lead)}>
          <td className="member-reply-select-cell"><input type="checkbox" checked={selectedIds.has(lead.id)} onChange={() => onToggleSelected(lead.id)} disabled={actionDisabled(lead)} aria-label={`勾选 ${lead.phone}`} /></td>
          <td className="member-phone">{lead.phone}{lead.isHistoricalRecord ? <small className="mt-1 block font-semibold text-amber-700">历史补录</small> : null}</td>
          <td><CustomerProfileEditor lead={lead} disabled={actionDisabled(lead)} onSave={onProfileFieldSave} /></td>
          <td><EntryWorkflowStatus lead={lead} /></td>
          <td className="member-reply-actions-cell"><div className="member-actions member-reply-actions-layout member-reply-compact-actions"><div className="member-reply-profile-actions"><button type="button" className="member-secondary small" title="查看完整客户资料" onClick={() => onViewProfile(lead)}>详情</button>{lead.followUpCount === 0 ? <button type="button" className="member-text-action danger" title="删除错误导入" onClick={() => onDelete(lead)} disabled={actionDisabled(lead)}>误录</button> : <button type="button" className="member-text-action danger" title="标记为误录" onClick={() => onVoidErroneousEntry(lead)} disabled={actionDisabled(lead)}>误录</button>}</div><div className="member-reply-processing-actions"><label className="member-contact-device"><span className="member-contact-device-prefix">接粉设备号</span><input aria-label={`${lead.phone} 接粉设备号`} title="接粉设备号" list={`reception-device-options-${lead.id}`} value={deviceDrafts[lead.id] ?? lead.device?.code ?? ""} onChange={(event) => { const value = event.target.value; onDeviceDraft(lead, value); if (devices.some((device) => device.code === value.trim())) onDeviceSave(lead, value); }} onBlur={(event) => onDeviceSave(lead, event.target.value)} placeholder="设备号" disabled={actionDisabled(lead)} /><datalist id={`reception-device-options-${lead.id}`}>{devices.map((device) => <option key={device.id} value={device.code} />)}</datalist></label><button type="button" className="member-reply-followup-button" onClick={() => onAction(lead, "followUp")} disabled={actionDisabled(lead)}><PhoneCall size={15} weight="duotone" />回访 {lead.followUpCount} +1</button><button type="button" className="member-primary member-reply-confirm-button" onClick={() => onAction(lead, "reply")} disabled={actionDisabled(lead)}><ChatCircleDots size={16} weight="duotone" />确认已回复</button></div></div></td>
          <td>{context(lead)}</td>
        </tr>)}{!leads.length ? <tr><td colSpan={6}>{empty("没有待回复客户")}</td></tr> : null}</tbody>
    </table></div>
  </section>;
}

function CustomerProfileEditor({ lead, disabled, onSave }: { lead: Lead; disabled: boolean; onSave: (lead: Lead, field: "customerName" | "customerEmail" | "lossAmount" | "customerPlatform" | "notes", value: string) => void }) {
  type FieldName = "customerName" | "customerEmail" | "lossAmount" | "customerPlatform" | "notes";
  type Field = { label: string; value: string; inputValue?: string; empty: string; type?: "number" };
  const [editing, setEditing] = useState<FieldName | null>(null);
  const [draft, setDraft] = useState("");
  const fields: Record<FieldName, Field> = {
    customerName: { label: "姓名", value: lead.customerName ?? "", empty: "未填" },
    customerEmail: { label: "邮箱", value: lead.customerEmail ?? "", empty: "未填" },
    lossAmount: { label: "金额", value: lead.lossAmountCents === null ? "" : `$${(lead.lossAmountCents / 100).toFixed(2)}`, inputValue: lead.lossAmountCents === null ? "" : String(lead.lossAmountCents / 100), empty: "未填", type: "number" },
    customerPlatform: { label: "平台", value: lead.customerPlatform ?? "", empty: "未填" },
    notes: { label: "客户情况", value: lead.notes ?? "", empty: "未填" },
  } as const;
  function field(fieldName: FieldName) {
    const item = fields[fieldName];
    const isEditing = editing === fieldName;
    return <span className="member-reply-profile-field" data-profile-field={fieldName}>{isEditing ? <input autoFocus type={item.type ?? "text"} min={item.type === "number" ? "0" : undefined} step={item.type === "number" ? "0.01" : undefined} aria-label={`${lead.phone} ${item.label}`} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => { onSave(lead, fieldName, draft); setEditing(null); }} onKeyDown={(event) => { if (event.key === "Escape") setEditing(null); if (event.key === "Enter") event.currentTarget.blur(); }} disabled={disabled} /> : <button type="button" title={`点击编辑${item.label}`} disabled={disabled} onClick={() => { setDraft(item.inputValue ?? item.value); setEditing(fieldName); }}><small>{item.label}</small><strong data-empty={!item.value || undefined}>{item.value || item.empty}</strong></button>}</span>;
  }
  return <div className="member-reply-profile-quick member-reply-profile-list" aria-label={`${lead.phone} 客户资料`}>
    {field("customerName")}
    {field("customerEmail")}
    {field("lossAmount")}
    {field("customerPlatform")}
    {field("notes")}
  </div>;
}

function categoryLabel(category: Lead["receptionCategory"]) {
  if (category === "INVALID") return "已作废";
  if (category === "LOW_AMOUNT") return "低金额";
  if (category === "NO_WS") return "无 WS 号码";
  return "—";
}

function receptionRowTone(lead: Lead) {
  if (lead.receptionCategory === "INVALID" || lead.receptionCategory === "LOW_AMOUNT" || lead.receptionCategory === "NO_WS" || lead.invalid) return "muted";
  if (lead.groupStatus === "JOINED") return "joined";
  if (lead.repliedOn) return "replied";
  return undefined;
}

const invalidCategoryLabel: Record<"LOW_AMOUNT" | "NO_WS" | "INVALID", string> = {
  LOW_AMOUNT: "低金额",
  NO_WS: "无 WS 号码",
  INVALID: "已作废",
};

/**
 * 无效库把“已确认不能继续处理”的客户与导入时的撞粉记录分开列出。
 * 撞粉不创建第二个客户，因此不能恢复；恢复按钮只针对本次被手动归类的客户。
 */
export function EntryInvalidLibrary({
  leads,
  exceptions,
  category,
  onCategory,
  onRestore,
  deviceDrafts,
  onDeviceDraft,
  onDeviceSave,
  onAction,
  onEditProfile,
  onDelete,
  actionDisabled,
  empty,
}: {
  leads: Lead[];
  exceptions: Exception[];
  category: "all" | "LOW_AMOUNT" | "NO_WS" | "DUPLICATE";
  onCategory: (value: "all" | "LOW_AMOUNT" | "NO_WS" | "DUPLICATE") => void;
  onRestore: (lead: Lead) => void;
  deviceDrafts: Record<string, string>;
  onDeviceDraft: (lead: Lead, value: string) => void;
  onDeviceSave: (lead: Lead, value: string) => void;
  onAction: (lead: Lead, action: ReceptionLeadAction) => void;
  onEditProfile: (lead: Lead) => void;
  onDelete: (lead: Lead) => void;
  actionDisabled: (lead: Lead) => boolean;
  empty: (text: string) => ReactNode;
}) {
  const invalidLeads = leads.filter((lead) => lead.invalid || ["LOW_AMOUNT", "NO_WS", "INVALID"].includes(lead.receptionCategory));
  const duplicates = exceptions.filter((item) => item.kind === "DUPLICATE_IN_PASTE" || item.kind === "COLLISION");
  const lowAmount = invalidLeads.filter((lead) => lead.receptionCategory === "LOW_AMOUNT");
  const noWs = invalidLeads.filter((lead) => lead.receptionCategory === "NO_WS");
  const shownLeads = category === "DUPLICATE" ? [] : category === "all" ? invalidLeads : invalidLeads.filter((lead) => lead.receptionCategory === category);
  const shownDuplicates = category === "all" || category === "DUPLICATE" ? duplicates : [];
  const total = invalidLeads.length + duplicates.length;

  return <section className="member-panel">
    <div className="member-panel-title"><div><p>扣粉数据</p><h3>扣粉统计</h3></div><span>扣粉客户不会回到待回复或计入业绩；可补记已回复、已拉群，炒群员会看到“扣粉统计转入”标识。</span></div>
    <div className="member-subtabs" aria-label="扣粉统计分类">
      <button type="button" data-active={category === "all" || undefined} onClick={() => onCategory("all")}>全部 {total}</button>
      <button type="button" data-active={category === "DUPLICATE" || undefined} onClick={() => onCategory("DUPLICATE")}>撞粉 {duplicates.length}</button>
      <button type="button" data-active={category === "LOW_AMOUNT" || undefined} onClick={() => onCategory("LOW_AMOUNT")}>低金额 {lowAmount.length}</button>
      <button type="button" data-active={category === "NO_WS" || undefined} onClick={() => onCategory("NO_WS")}>无 WS 号码 {noWs.length}</button>
    </div>
    {shownLeads.length ? <div className="member-table-wrap"><table className="member-table"><thead><tr><th>手机号</th><th>无效类型</th><th>归类说明</th><th>来源</th><th>当前记录</th><th>操作</th></tr></thead><tbody>{shownLeads.map((lead) => <tr key={lead.id} data-invalid>
      <td className="member-phone">{lead.phone}</td><td><strong>{invalidCategoryLabel[lead.receptionCategory === "LOW_AMOUNT" || lead.receptionCategory === "NO_WS" ? lead.receptionCategory : "INVALID"]}</strong></td>
      <td>{lead.receptionCategory === "LOW_AMOUNT" && lead.lossAmountCents !== null ? `$${(lead.lossAmountCents / 100).toFixed(2)}` : lead.invalidReason ?? "—"}</td>
      <td>{lead.batch.sourceDate}<small className="block">{lead.batch.channel.name}</small></td><td>{lead.groupStatus === "JOINED" ? "已拉群 · 炒群可见" : lead.repliedOn ? "已回复 · 待拉群" : "未回复"}</td>
      <td className="member-actions">{!lead.repliedOn ? <><input aria-label={`${lead.phone} 扣粉统计设备号`} value={deviceDrafts[lead.id] ?? lead.device?.code ?? ""} onChange={(event) => onDeviceDraft(lead, event.target.value)} onBlur={(event) => onDeviceSave(lead, event.target.value)} placeholder="接粉设备号" /><button type="button" className="member-primary small" onClick={() => onAction(lead, "reply")} disabled={actionDisabled(lead)}>标记已回复</button></> : lead.groupStatus === "NOT_JOINED" ? <button type="button" className="member-primary small" onClick={() => onAction(lead, "joinGroup")} disabled={actionDisabled(lead)}>确认已拉群</button> : <span className="text-xs font-semibold text-emerald-700">已交给炒群</span>}<button type="button" className="member-secondary small" onClick={() => onEditProfile(lead)} disabled={actionDisabled(lead)}>编辑资料</button>{!lead.repliedOn && lead.followUpCount === 0 && lead.groupStatus === "NOT_JOINED" && !lead.expertIntroducedOn && !lead.registeredOn && !lead.customerOrder ? <button type="button" className="member-text-action danger" onClick={() => onDelete(lead)} disabled={actionDisabled(lead)}>删除错误导入</button> : null}<button type="button" className="member-secondary small" onClick={() => onRestore(lead)} disabled={actionDisabled(lead)}>恢复有效</button></td>
    </tr>)}</tbody></table></div> : null}
    {shownDuplicates.length ? <div className="member-table-wrap"><table className="member-table"><thead><tr><th>手机号</th><th>撞粉类型</th><th>来源</th><th>发现时间</th><th>处理说明</th></tr></thead><tbody>{shownDuplicates.map((item) => <tr key={item.id} data-invalid>
      <td className="member-phone">{item.phone}</td><td><strong>{item.kind === "COLLISION" ? "系统撞粉（已在库）" : "本次撞粉（重复粘贴）"}</strong></td>
      <td>{item.batch ? <>{item.batch.sourceDate}<small className="block">{item.batch.channel.name}</small></> : "号码导入"}</td><td>{item.occurredOn}</td><td>{item.reason ?? "本次号码未导入；原有客户不会受影响"}<small className="block">不创建第二个客户，不计入有效数据。</small></td>
    </tr>)}</tbody></table></div> : null}
    {!shownLeads.length && !shownDuplicates.length ? empty("这个分类暂时没有扣粉数据") : null}
  </section>;
}
