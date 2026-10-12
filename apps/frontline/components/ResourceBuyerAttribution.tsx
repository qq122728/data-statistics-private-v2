"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestJson } from "@/lib/backend";
import { COUNTRIES, countryName } from "../../../packages/resource-buyer/options";
import { type EffectRow } from "./resource-buyer-format";
import { ResourceBuyerEffects } from "./ResourceBuyerEffects";
import { ResourceMonthInput } from "./ResourceMonthInput";
import { normalizeResourceMonth } from "./resource-buyer-groups";
import type { SpendEntry } from "./ResourceBuyerSpend";
import styles from "./ResourceBuyerAttribution.module.css";

type Channel = { id: string; name: string; channelType: string; groups: Array<{ id: string; name: string }> };
type Metrics = { valid: boolean; replied: boolean; joined: boolean; expert: boolean; registered: boolean; opened: boolean; firstCents: number; rechargeCents: number; withdrawalCents: number; legacyCents: number; netCents: number; intakeOn: string; openedOn: string };
export type Material = { id: string; channelId: string; buyerId: string; buyer: { name: string }; name: string; url: string | null; active: boolean; fileKey?: string | null; fileName?: string | null; fileMime?: string | null; fileBytes?: number | null };
type Detail = { country: string; id: string; phone: string; sourceDate: string; buyer: string; materialId: string | null; material: string; materialUrl: string; channel: string; channelId: string; groupName: string; status: "matched" | "pending" | "ambiguous"; metrics: Metrics | null };
export type BuyerPayload = { channels: Channel[]; buyers: Array<{ id: string; channelId: string; name: string }>; materials: Material[]; materialSummary: EffectRow[]; summary: EffectRow[]; spends: SpendEntry[]; details: Detail[]; detailTotal: number; detailPage: number; detailPages: number };
type Preview = { counts: Record<string, number>; invalid: string[]; invalidCount: number; duplicateCount: number; skippedHeaders: number; total: number; rows: Array<{ phone: string; status: string; existingBuyer: string | null }> };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dollars = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const percent = (part: number, whole: number) => whole ? `${(part / whole * 100).toFixed(1)}%` : "—";
const statuses: Record<string, string> = { matched: "已匹配客户", pending: "尚未出现在客户进度表", ambiguous: "跨小组重号", already: "已导入同一投手", resolve: "补全国家、小组或素材", conflict: "归属冲突" };

export function ResourceBuyerAttribution({ smsOnly = false, readOnly = false, onOpenLibrary, initialMaterialId = "", initialMonth = "", active = true, mode = "all", onOpenNumbers }: { smsOnly?: boolean; mode?: "all" | "effects" | "numbers"; onOpenNumbers?: () => void; readOnly?: boolean; onOpenLibrary?: () => void; initialMaterialId?: string; initialMonth?: string; active?: boolean }) {
  const statusLabels = smsOnly ? { ...statuses, already: "已导入同一供粉方", resolve: "补全国家或小组" } : statuses;
  const [month, setMonth] = useState(() => normalizeResourceMonth(initialMonth) || today().slice(0, 7));
  const [country, setCountry] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [detailCountry, setDetailCountry] = useState<string | null>(null);
  const [filterChannel, setFilterChannel] = useState("");
  const [payload, setPayload] = useState<BuyerPayload | null>(null);
  const [channelId, setChannelId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [buyer, setBuyer] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [sourceDate, setSourceDate] = useState(today);
  const [numbers, setNumbers] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedBuyer, setSelectedBuyer] = useState("");
  const [selectedMaterial, setSelectedMaterial] = useState(initialMaterialId);
  const [detailPage, setDetailPage] = useState(1);
  const detailRef = useRef<HTMLElement>(null);
  const scrolled = useRef(false);
  const loadSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
    const query = new URLSearchParams({ month });
    if (filterCountry) query.set("country", filterCountry);
    if (detailCountry !== null) query.set("detailCountry", detailCountry || "unknown");
    if (filterChannel) query.set("channelId", filterChannel);
    if (selectedBuyer) query.set("detailBuyerId", selectedBuyer);
    if (selectedMaterial) query.set("detailMaterialId", selectedMaterial);
    query.set("detailPage", String(detailPage));
    const next = await requestJson<BuyerPayload>(`/api/resource/buyer-phones?${query}`);
    if (sequence !== loadSequence.current) return;
    setPayload(next);
    setChannelId(current => current && next.channels.some(item => item.id === current) ? current : next.channels[0]?.id ?? "");
    setMaterialId(current => current && next.materials.some(item => item.id === current && item.active) ? current : "");
    } catch (caught) {
      if (sequence !== loadSequence.current) return;
      setPayload(null);
      throw caught;
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [month, filterChannel, filterCountry, detailCountry, selectedBuyer, selectedMaterial, detailPage]);
  useEffect(() => { if (active) void load().catch(caught => setError(caught instanceof Error ? caught.message : "无法读取投手数据")); }, [load, active]);
  useEffect(() => {
    if (!active) return;
    setDetailCountry(null); setFilterCountry(""); setFilterChannel("");
    setSelectedMaterial(initialMaterialId); setSelectedBuyer(""); setDetailPage(1);
    if (normalizeResourceMonth(initialMonth)) setMonth(normalizeResourceMonth(initialMonth)!);
    scrolled.current = false;
  }, [active, initialMaterialId, initialMonth]);
  useEffect(() => {
    if (active && initialMaterialId && selectedMaterial === initialMaterialId && payload && !scrolled.current) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); scrolled.current = true;
    }
  }, [active, initialMaterialId, selectedMaterial, payload]);
  useEffect(() => { if (active && mode === "numbers" && (selectedBuyer || selectedMaterial)) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [active, mode, selectedBuyer, selectedMaterial]);
  const channel = useMemo(() => payload?.channels.find(item => item.id === channelId), [payload, channelId]);
  const formData = (action: string) => { const data = new FormData(); data.set("action", action); data.set("channelId", channelId); data.set("groupId", groupId); data.set("buyer", buyer.trim()); data.set("materialId", materialId); data.set("sourceDate", sourceDate); data.set("country", country); if (file) data.set("file", file); else data.set("numbers", numbers); return data; };
  async function run(action: "preview" | "commit") {
    setBusy(true); setError(""); setNotice("");
    try {
      if (action === "preview") setPreview(await requestJson<Preview>("/api/resource/buyer-phones", { method: "POST", body: formData(action) }));
      else {
        const result = await requestJson<{ saved: number; skipped: number; resolved: number; pending: number }>("/api/resource/buyer-phones", { method: "POST", body: formData(action) });
        setNotice(`已保存 ${result.saved} 个号码，补全 ${result.resolved} 个号码的${smsOnly ? "国家或小组" : "国家、小组或素材"}信息；其中 ${result.pending} 个尚未进入客户进度表，之后会自动匹配。`);
        setPreview(null); setNumbers(""); setFile(null); setMonth(sourceDate.slice(0, 7)); await load();
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "操作未完成"); }
    finally { setBusy(false); }
  }
  const canCommit = Boolean(preview && !preview.invalidCount && !preview.counts.conflict && !preview.counts.ambiguous && ((preview.counts.matched ?? 0) + (preview.counts.pending ?? 0) + (preview.counts.resolve ?? 0) > 0));
  const filteredDetails = payload?.details ?? [];
  const buyerMaterials = payload?.materials.filter(item => item.channelId === channelId && item.buyer.name === buyer.trim()) ?? [];
  return <div className={`${styles.stack} ${mode === "effects" ? styles.effectsStack : ""}`}>
    <section hidden={mode === "effects"} className={styles.intro}><div><h2>{mode === "numbers" ? "号码库" : smsOnly ? "短信粉效果" : "投手效果"}</h2><p>{readOnly ? "总公司可查看投流与短信两个渠道类型的号码和效果；各资源负责人在自己的账号中导入。" : smsOnly ? "选用系统现有短信渠道，登记一批号码的供粉方。客户进群、开单和金额从客户进度表自动读取。" : "选用系统现有渠道，登记一批号码的投手或供粉方。客户进群、开单和金额从客户进度表自动读取。"}</p></div><button type="button" onClick={() => void load().catch(caught => setError(String(caught)))}>刷新数据</button></section>
    {!readOnly ? <section hidden={mode === "effects"} className={styles.card}><header><div><h3>导入号码</h3><p>每批先预览，再确认保存。完整号码按“渠道＋号码”检查重复，不会覆盖已有归属人。</p></div></header>
      <div className={styles.formGrid}>
        <label>现有渠道<select value={channelId} onChange={event => { setChannelId(event.target.value); setGroupId(""); setMaterialId(""); setPreview(null); }}><option value="">请选择渠道</option>{payload?.channels.map(item => <option key={item.id} value={item.id}>{item.name} · {item.channelType === "ADS" ? "投流" : "短信"}{payload.channels.filter(other => other.name === item.name).length > 1 ? ` · ${item.id.slice(-5)}` : ""}</option>)}</select></label>
        <label>对应小组<select value={groupId} onChange={event => { setGroupId(event.target.value); setPreview(null); }}><option value="">不限小组</option>{channel?.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label>{channel?.channelType === "SMS" ? "供粉方／负责人" : "投手"}<input value={buyer} maxLength={100} list="resource-buyers" placeholder={channel?.channelType === "SMS" ? "例如短信供应商或负责人" : "例如 QQ、阳仔"} onChange={event => { setBuyer(event.target.value); setMaterialId(""); setPreview(null); }} /><datalist id="resource-buyers">{payload?.buyers.filter(item => item.channelId === channelId).map(item => <option key={item.id} value={item.name} />)}</datalist></label>
        <label>号码国家<select value={country} onChange={event => { setCountry(event.target.value); setPreview(null); }}><option value="">请选择国家</option>{COUNTRIES.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
        <label>批次日期<input type="date" value={sourceDate} onChange={event => { setSourceDate(event.target.value); setPreview(null); }} /></label>
      </div>
      {channel?.channelType === "ADS" ? <div className={styles.materialImport}><label>本批使用的素材<select value={materialId} onChange={event => { setMaterialId(event.target.value); setPreview(null); }}><option value="">未指定素材</option>{buyerMaterials.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><span>选择该投手已有的素材；新素材可在左侧“素材库”创建。</span>{onOpenLibrary ? <button type="button" onClick={onOpenLibrary}>打开素材库</button> : null}</div> : null}
      <div className={styles.inputGrid}><label>粘贴号码，一行一个<textarea value={numbers} disabled={!!file} placeholder={"91098668\n96519961\n91265932"} onChange={event => { setNumbers(event.target.value); setPreview(null); }} /></label><div className={styles.fileBox}><label>或上传文件<input type="file" accept=".xlsx,.csv,.txt" onChange={event => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} /></label><p>支持 Excel、CSV、TXT；读取第一列号码，自动跳过 ID、号码等表头。{smsOnly ? "供粉方" : "投手"}以页面填写为准。一次最多 2,000 个号码、2 MB。带空格、+ 或短横线的号码会规范化，必须保留完整 6–20 位数字。</p>{file ? <button type="button" onClick={() => { setFile(null); setPreview(null); }}>移除文件</button> : null}</div></div>
      <p className={styles.importHint}>{!preview ? `第 1 步：填写渠道、${smsOnly ? "供粉方" : "投手"}和国家、选择文件，再点“检查号码”；检查通过后才能确认导入。` : canCommit ? `检查通过，可导入 ${(preview.counts.matched ?? 0) + (preview.counts.pending ?? 0) + (preview.counts.resolve ?? 0)} 个号码。请核对预览后点击“确认导入”。` : preview.invalidCount || preview.counts.conflict || preview.counts.ambiguous ? "暂时不能导入，请处理下方标出的格式错误或归属冲突，然后重新检查。" : "这些号码已全部导入，无需重复保存。"}</p>
      <div className={styles.actions}><button type="button" disabled={busy || !country || !channelId || !buyer.trim() || (!numbers.trim() && !file)} onClick={() => void run("preview")}>{busy ? "处理中…" : "检查号码"}</button><button type="button" className={styles.primary} disabled={busy || !canCommit} onClick={() => void run("commit")}>确认导入</button></div>
      {preview ? <div className={styles.preview}><strong>导入预览 · {preview.total} 个不同号码{materialId ? ` · 素材：${buyerMaterials.find(item => item.id === materialId)?.name ?? ""}` : ""}</strong><div className={styles.chips}>{Object.entries(preview.counts).map(([status, count]) => <span key={status} data-danger={status === "conflict" || status === "ambiguous"}>{statusLabels[status]} {count}</span>)}<span>已跳过表头 {preview.skippedHeaders ?? 0} 行</span><span>文件内重复（自动去重）{preview.duplicateCount}</span><span data-danger={preview.invalidCount > 0}>格式错误 {preview.invalidCount}</span></div>{preview.invalidCount ? <p className={styles.error}>格式错误示例：{preview.invalid.join("、")}</p> : null}{(preview.counts.conflict || preview.counts.ambiguous) ? <p className={styles.error}>有号码的{smsOnly ? "国家或供粉方" : "国家、投手或素材"}归属冲突，或在多个小组出现。请核实来源和国家，必要时选定小组后重新预览。</p> : null}<div className={styles.previewList}>{preview.rows.slice(0, 20).map(row => <div key={row.phone}><code>{row.phone}</code><span>{statusLabels[row.status]}{row.existingBuyer ? ` · ${row.existingBuyer}` : ""}</span></div>)}</div></div> : null}
      {notice ? <p role="status" className={styles.success}>{notice}</p> : null}
    </section> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {mode !== "numbers" ? <ResourceBuyerEffects smsOnly={smsOnly} payload={payload} loading={loading} onRefresh={() => void load().catch(caught => setError(String(caught)))} filters={<>
      <label>月份<ResourceMonthInput value={month} onChange={value => { setMonth(value); setDetailPage(1); }} /></label>
      <label>渠道<select value={filterChannel} onChange={event => { setFilterChannel(event.target.value); setSelectedBuyer(""); setSelectedMaterial(""); setDetailCountry(null); setDetailPage(1); }}><option value="">全部授权渠道</option>{payload?.channels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>效果国家<select value={filterCountry} onChange={event => { setFilterCountry(event.target.value); setDetailCountry(null); setSelectedBuyer(""); setSelectedMaterial(""); setDetailPage(1); }}><option value="">全部国家</option><option value="unknown">未标注国家</option>{COUNTRIES.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
    </>} onNumbers={(row, material, country) => { setSelectedBuyer(row.buyerId); setSelectedMaterial(material ? row.materialId || "" : ""); setDetailCountry(country); setFilterChannel(row.channelId); setDetailPage(1); onOpenNumbers?.(); detailRef.current?.scrollIntoView({ behavior: "smooth" }); }} /> : <section className={styles.card}><header className={styles.reportHeader}><h3>号码筛选</h3><div className={styles.filters}>
      <label>月份<ResourceMonthInput value={month} onChange={value => { setMonth(value); setDetailPage(1); }} /></label>
      <label>渠道<select value={filterChannel} onChange={event => { setFilterChannel(event.target.value); setSelectedBuyer(""); setSelectedMaterial(""); setDetailCountry(null); setDetailPage(1); }}><option value="">全部授权渠道</option>{payload?.channels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>效果国家<select value={filterCountry} onChange={event => { setFilterCountry(event.target.value); setDetailCountry(null); setSelectedBuyer(""); setSelectedMaterial(""); setDetailPage(1); }}><option value="">全部国家</option><option value="unknown">未标注国家</option>{COUNTRIES.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
    </div></header></section>}
    <section hidden={mode === "effects"} ref={detailRef} className={styles.card}><header className={styles.reportHeader}><div><h3>号码明细{detailCountry !== null ? ` · ${countryName(detailCountry)}` : filterCountry ? ` · ${countryName(filterCountry === "unknown" ? "" : filterCountry)}` : ""}{selectedMaterial ? ` · ${payload?.materials.find(item => item.id === selectedMaterial)?.name ?? ""}` : selectedBuyer ? ` · ${payload?.buyers.find(item => item.id === selectedBuyer)?.name ?? ""}` : ""}</h3><p>共 {payload?.detailTotal ?? 0} 个号码，每页 50 条；仅有渠道权限的资源部和总公司管理员可查看。</p></div>{selectedBuyer || selectedMaterial ? <button type="button" onClick={() => { setSelectedBuyer(""); setSelectedMaterial(""); setDetailCountry(null); setDetailPage(1); }}>显示全部号码</button> : null}</header><div className={styles.tableWrap}><table><thead><tr><th>完整号码</th><th>国家</th><th>渠道</th><th>{smsOnly ? "供粉方" : "投手"}</th>{!smsOnly ? <th>素材</th> : null}<th>批次日期</th><th>小组</th><th>匹配情况</th><th>接粉日期</th><th>开单日期</th><th>首充</th><th>续充</th></tr></thead><tbody>{filteredDetails.map(row => <tr key={row.id}><td><strong>{row.phone}</strong></td><td>{countryName(row.country)}</td><td>{row.channel}</td><td>{row.buyer}</td>{!smsOnly ? <td>{row.material || "—"}</td> : null}<td>{row.sourceDate}</td><td>{row.groupName || "—"}</td><td>{statusLabels[row.status]}</td><td>{row.metrics?.intakeOn || "—"}</td><td>{row.metrics?.openedOn || "—"}</td><td>{dollars(row.metrics?.firstCents ?? 0)}</td><td>{dollars(row.metrics?.rechargeCents ?? 0)}</td></tr>)}{!filteredDetails.length ? <tr><td colSpan={smsOnly ? 11 : 12} className={styles.empty}>暂无号码明细</td></tr> : null}</tbody></table></div><div className={styles.pager}><span>第 {payload?.detailPage ?? 1} / {payload?.detailPages ?? 1} 页</span><button type="button" disabled={detailPage <= 1} onClick={() => setDetailPage(current => current - 1)}>上一页</button><button type="button" disabled={detailPage >= (payload?.detailPages ?? 1)} onClick={() => setDetailPage(current => current + 1)}>下一页</button></div></section>
  </div>;
}
