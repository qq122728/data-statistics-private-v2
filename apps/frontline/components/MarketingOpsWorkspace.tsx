"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { requestJson } from "@/lib/backend";
import styles from "./MarketingOpsWorkspace.module.css";

type Entity = { id: string; channelId: string; name: string; active: boolean; [key: string]: unknown };
type DailyEntry = { id: string; businessDate: string; attributionId: string; spendCents: number; sentCount: number; deliveredCount: number; fansCount: number; validFansCount: number; conversionCount: number; note?: string | null; attribution: Entity & { sourceType: "ADS" | "SMS"; trafficBuyer?: Entity | null; creativeAsset?: Entity | null; smsVendor?: Entity | null } };
type Ranking = { id: string; name: string; channelId: string; spendCents: number; sentCount: number; deliveredCount: number; fansCount: number; validFansCount: number; conversionCount: number; validRate: number; deliveryRate: number };
type OpsData = {
  canWrite: boolean;
  channels: Array<{ id: string; name: string; channelType: string }>;
  buyers: Entity[]; adAccounts: Entity[]; campaigns: Entity[]; creatives: Entity[]; vendors: Entity[]; smsBatches: Entity[]; attributions: Entity[];
  entries: DailyEntry[];
  dashboard: { totals: Record<string, number>; creativeRanking: Ranking[]; vendorRanking: Ranking[] };
};
type View = "overview" | "catalog" | "daily" | "creatives" | "vendors";
type CatalogKind = "buyer" | "adAccount" | "campaign" | "creative" | "vendor" | "smsBatch" | "attribution";

const date = new Date();
const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const firstDate = `${localDate.slice(0, 8)}01`;
const number = (value: number) => new Intl.NumberFormat("zh-CN").format(value || 0);
const amount = (cents: number) => new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format((cents || 0) / 100);
const percent = (value: number) => `${((value || 0) * 100).toFixed(1)}%`;
const channelName = (data: OpsData | null, id: string) => data?.channels.find((item) => item.id === id)?.name ?? "未命名渠道";

export function MarketingOpsWorkspace() {
  const [view, setView] = useState<View>("overview");
  const [catalogKind, setCatalogKind] = useState<CatalogKind>("buyer");
  const [data, setData] = useState<OpsData | null>(null);
  const [from, setFrom] = useState(firstDate);
  const [to, setTo] = useState(localDate);
  const [channelId, setChannelId] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ from, to });
      if (channelId) query.set("channelId", channelId);
      setData(await requestJson<OpsData>(`/api/marketing-ops?${query}`));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "运营数据读取失败"); }
    finally { setLoading(false); }
  }, [channelId, from, to]);
  useEffect(() => {
    let cancelled = false;
    void requestJson("/api/auth/me")
      .then(() => { if (!cancelled) setAuthReady(true); })
      .catch(() => { window.location.assign("/login?next=/marketing-ops"); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { if (authReady) void load(); }, [authReady, load]);

  async function submit(kind: "create" | "daily" | "import", event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      let body: Record<string, unknown>;
      if (kind === "create") body = catalogPayload(catalogKind, form);
      else if (kind === "daily") body = dailyPayload(form);
      else body = { kind: "dailyImport", rows: parseImport(String(form.get("csv") ?? "")) };
      await requestJson("/api/marketing-ops", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      formElement.reset();
      setNotice(kind === "import" ? "导入完成：同一天、同一归因会被安全覆盖，不会重复累计。" : "已保存。数据会马上出现在对应排行榜和总览中。");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); }
    finally { setSaving(false); }
  }

  async function setActive(kind: CatalogKind, item: Entity) {
    setSaving(true); setError("");
    try {
      await requestJson("/api/marketing-ops", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, id: item.id, active: !item.active }) });
      setNotice(`${item.name} 已${item.active ? "停用" : "启用"}`); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "状态更新失败"); }
    finally { setSaving(false); }
  }

  const visible = useMemo(() => ({
    buyers: filterChannel(data?.buyers ?? [], channelId), adAccounts: filterChannel(data?.adAccounts ?? [], channelId), campaigns: filterChannel(data?.campaigns ?? [], channelId), creatives: filterChannel(data?.creatives ?? [], channelId), vendors: filterChannel(data?.vendors ?? [], channelId), smsBatches: filterChannel(data?.smsBatches ?? [], channelId), attributions: filterChannel(data?.attributions ?? [], channelId),
  }), [channelId, data]);

  return <main className={styles.page}>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>投流与短信粉运营账</p><h1>把花了多少钱、来了多少粉、哪一路质量好，放到一张清楚的账上。</h1><p>这套页面独立于原有日报和客户归属：它只做运营建档、每日录入与质量分析，不会改动现有业务数据。</p></div>
      <a href="/" className={styles.back}>返回主工作台</a>
    </header>
    <nav className={styles.tabs} aria-label="运营账页面">
      {([ ["overview", "资源总览"], ["catalog", "建档"], ["daily", "每日录入 / 导入"], ["creatives", "素材质量榜"], ["vendors", "粉商质量榜"] ] as const).map(([key, label]) => <button key={key} type="button" data-active={view === key} onClick={() => setView(key)}>{label}</button>)}
    </nav>
    <section className={styles.filters}>
      <label><span>开始日期</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label><span>结束日期</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <label><span>渠道范围</span><select value={channelId} onChange={(event) => setChannelId(event.target.value)}><option value="">全部已授权渠道</option>{(data?.channels ?? []).map((channel) => <option key={channel.id} value={channel.id}>{channel.name} · {channel.channelType === "ADS" ? "投流" : channel.channelType === "SMS" ? "短信" : "其他"}</option>)}</select></label>
      <button type="button" className={styles.secondary} onClick={() => void load()} disabled={loading}>刷新</button>
    </section>
    {error ? <p className={styles.error}>{error}</p> : null}{notice ? <p className={styles.notice}>{notice}</p> : null}
    {loading ? <section className={styles.empty}>正在读取运营账…</section> : null}
    {!loading && !data ? <section className={styles.empty}>暂时没有可读取的数据。</section> : null}
    {!loading && data && view === "overview" ? <Overview data={data} /> : null}
    {!loading && data && view === "catalog" ? <Catalog canWrite={data.canWrite} kind={catalogKind} setKind={setCatalogKind} channelId={channelId} data={data} visible={visible} saving={saving} onSubmit={(event) => void submit("create", event)} onToggle={(kind, item) => void setActive(kind, item)} /> : null}
    {!loading && data && view === "daily" ? <Daily canWrite={data.canWrite} attributions={visible.attributions} entries={data.entries.filter((entry) => !channelId || entry.attribution.channelId === channelId)} saving={saving} onDaily={(event) => void submit("daily", event)} onImport={(event) => void submit("import", event)} /> : null}
    {!loading && data && view === "creatives" ? <Ranking title="素材质量榜" note="按有效粉率排序；同率时有效粉数量更多的排在前面。" rows={data.dashboard.creativeRanking.filter((item) => !channelId || item.channelId === channelId)} data={data} type="creative" /> : null}
    {!loading && data && view === "vendors" ? <Ranking title="粉商质量榜" note="按有效粉率排序，同时展示送达率，便于区分发送问题和粉质问题。" rows={data.dashboard.vendorRanking.filter((item) => !channelId || item.channelId === channelId)} data={data} type="vendor" /> : null}
  </main>;
}

function Overview({ data }: { data: OpsData }) {
  const totals = data.dashboard.totals;
  const validRate = totals.fansCount ? totals.validFansCount / totals.fansCount : 0;
  const deliveryRate = totals.sentCount ? totals.deliveredCount / totals.sentCount : 0;
  return <><section className={styles.cards}>
    <Metric label="投放 / 发送成本" value={amount(totals.spendCents)} help="所有日报中填入的成本" />
    <Metric label="总粉数" value={number(totals.fansCount)} help={`有效粉 ${number(totals.validFansCount)}`} />
    <Metric label="有效粉率" value={percent(validRate)} help="有效粉 ÷ 总粉数" />
    <Metric label="短信送达率" value={percent(deliveryRate)} help="送达数 ÷ 发送数" />
    <Metric label="后续转化" value={number(totals.conversionCount)} help="日报中登记的转化数" />
  </section><section className={styles.split}><Ranking title="本周期素材领先" note="前 5 名" rows={data.dashboard.creativeRanking.slice(0, 5)} data={data} type="creative" compact /><Ranking title="本周期粉商领先" note="前 5 名" rows={data.dashboard.vendorRanking.slice(0, 5)} data={data} type="vendor" compact /></section></>;
}

function Metric({ label, value, help }: { label: string; value: string; help: string }) { return <article className={styles.metric}><span>{label}</span><strong>{value}</strong><small>{help}</small></article>; }

function Catalog({ canWrite, kind, setKind, channelId, data, visible, saving, onSubmit, onToggle }: { canWrite: boolean; kind: CatalogKind; setKind: (value: CatalogKind) => void; channelId: string; data: OpsData; visible: Record<string, Entity[]>; saving: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onToggle: (kind: CatalogKind, item: Entity) => void }) {
  const rows = ({ buyer: visible.buyers, adAccount: visible.adAccounts, campaign: visible.campaigns, creative: visible.creatives, vendor: visible.vendors, smsBatch: visible.smsBatches, attribution: visible.attributions })[kind];
  return <section className={styles.section}><header><div><h2>基础建档</h2><p>先按“投手 → 账户 → 计划 → 素材”或“粉商 → 短信批次”建好，再创建归因。归因才是日报里可选的一行。</p></div>{!canWrite ? <span className={styles.readonly}>财务账号为只读</span> : null}</header>
    <div className={styles.kindTabs}>{([ ["buyer", "投手"], ["adAccount", "广告账户"], ["campaign", "广告计划"], ["creative", "素材"], ["vendor", "短信粉商"], ["smsBatch", "短信批次"], ["attribution", "来源归因"] ] as const).map(([key, label]) => <button type="button" key={key} data-active={kind === key} onClick={() => setKind(key)}>{label}</button>)}</div>
    {canWrite ? <CatalogForm kind={kind} channelId={channelId} data={data} visible={visible} saving={saving} onSubmit={onSubmit} /> : null}
    <EntityTable kind={kind} rows={rows} data={data} canWrite={canWrite} saving={saving} onToggle={onToggle} />
  </section>;
}

function CatalogForm({ kind, channelId, data, visible, saving, onSubmit }: { kind: CatalogKind; channelId: string; data: OpsData; visible: Record<string, Entity[]>; saving: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const channelOptions = channelId ? data.channels.filter((item) => item.id === channelId) : data.channels;
  return <form className={styles.form} onSubmit={onSubmit}>
    <label><span>归属渠道</span><select name="channelId" defaultValue={channelId} required><option value="" disabled>请选择渠道</option>{channelOptions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    <label><span>{kind === "attribution" ? "归因名称" : "名称"}</span><input name="name" maxLength={100} required placeholder={kind === "creative" ? "例如：律师口播 10 秒版" : "请输入名称"} /></label>
    {kind === "buyer" ? <label><span>员工编号（选填）</span><input name="employeeCode" maxLength={50} /></label> : null}
    {kind === "adAccount" ? <><label><span>投放平台</span><input name="platform" required placeholder="例如：Meta / Google" /></label><Select label="所属投手（选填）" name="buyerId" rows={visible.buyers} /></> : null}
    {kind === "campaign" ? <Select label="所属广告账户" name="adAccountId" rows={visible.adAccounts} required /> : null}
    {kind === "creative" ? <Select label="所属广告计划" name="campaignId" rows={visible.campaigns} required /> : null}
    {kind === "vendor" ? <label><span>联系人（选填）</span><input name="contactName" maxLength={100} /></label> : null}
    {kind === "smsBatch" ? <><Select label="所属粉商" name="vendorId" rows={visible.vendors} required /><label><span>发送日期（选填）</span><input name="sentOn" type="date" /></label></> : null}
    {["adAccount", "campaign", "creative", "smsBatch"].includes(kind) ? <label><span>外部编号（选填）</span><input name="externalCode" maxLength={100} /></label> : null}
    {kind === "attribution" ? <><label><span>来源类型</span><select name="sourceType" defaultValue="ADS"><option value="ADS">投流</option><option value="SMS">短信粉</option></select></label><Select label="投手（投流选填）" name="trafficBuyerId" rows={visible.buyers} /><Select label="广告账户（投流选填）" name="adAccountId" rows={visible.adAccounts} /><Select label="广告计划（投流选填）" name="adCampaignId" rows={visible.campaigns} /><Select label="素材（投流必填）" name="creativeAssetId" rows={visible.creatives} /><Select label="粉商（短信选填）" name="smsVendorId" rows={visible.vendors} /><Select label="短信批次（短信必填）" name="smsBatchId" rows={visible.smsBatches} /></> : null}
    <button className={styles.primary} disabled={saving}>{saving ? "保存中…" : "保存建档"}</button>
  </form>;
}

function Select({ label, name, rows, required = false }: { label: string; name: string; rows: Entity[]; required?: boolean }) { return <label><span>{label}</span><select name={name} required={required} defaultValue=""><option value="">{required ? "请选择" : "不关联"}</option>{rows.filter((row) => row.active).map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label>; }

function EntityTable({ kind, rows, data, canWrite, saving, onToggle }: { kind: CatalogKind; rows: Entity[]; data: OpsData; canWrite: boolean; saving: boolean; onToggle: (kind: CatalogKind, item: Entity) => void }) {
  return <div className={styles.tableWrap}><table><thead><tr><th>名称</th><th>渠道</th><th>关联信息</th><th>状态</th>{canWrite ? <th>操作</th> : null}</tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong>{typeof row.externalCode === "string" && row.externalCode ? <small>外部编号：{row.externalCode}</small> : null}</td><td>{channelName(data, row.channelId)}</td><td>{entityDetail(kind, row, data)}</td><td><span className={row.active ? styles.active : styles.inactive}>{row.active ? "启用" : "停用"}</span></td>{canWrite ? <td><button className={styles.linkButton} disabled={saving} onClick={() => onToggle(kind, row)}>{row.active ? "停用" : "启用"}</button></td> : null}</tr>)}{!rows.length ? <tr><td colSpan={canWrite ? 5 : 4} className={styles.noRows}>还没有记录。先用上面的表单建第一条。</td></tr> : null}</tbody></table></div>;
}

function entityDetail(kind: CatalogKind, row: Entity, data: OpsData) {
  const lookups: Record<string, Entity[]> = { buyer: [], adAccount: data.buyers, campaign: data.adAccounts, creative: data.campaigns, vendor: [], smsBatch: data.vendors, attribution: [] };
  if (kind === "adAccount") return row.buyerId ? data.buyers.find((item) => item.id === row.buyerId)?.name ?? "投手已移除" : "未关联投手";
  if (kind === "campaign") return data.adAccounts.find((item) => item.id === row.adAccountId)?.name ?? "广告账户已移除";
  if (kind === "creative") return data.campaigns.find((item) => item.id === row.campaignId)?.name ?? "广告计划已移除";
  if (kind === "smsBatch") return data.vendors.find((item) => item.id === row.vendorId)?.name ?? "粉商已移除";
  if (kind === "attribution") return row.sourceType === "ADS" ? `投流 · ${data.creatives.find((item) => item.id === row.creativeAssetId)?.name ?? "未关联素材"}` : `短信 · ${data.smsBatches.find((item) => item.id === row.smsBatchId)?.name ?? "未关联批次"}`;
  return typeof row.contactName === "string" ? row.contactName || "—" : "—";
}

function Daily({ canWrite, attributions, entries, saving, onDaily, onImport }: { canWrite: boolean; attributions: Entity[]; entries: DailyEntry[]; saving: boolean; onDaily: (event: FormEvent<HTMLFormElement>) => void; onImport: (event: FormEvent<HTMLFormElement>) => void }) {
  return <section className={styles.section}><header><div><h2>每日录入 / 导入</h2><p>同一天、同一个来源归因只保留一行。再次保存会更新这一行，所以不用担心重复累计。</p></div></header>{canWrite ? <div className={styles.dailyForms}><form className={styles.form} onSubmit={onDaily}><label><span>业务日期</span><input type="date" name="businessDate" defaultValue={localDate} required /></label><Select label="来源归因" name="attributionId" rows={attributions} required /><NumberFields /><label className={styles.wide}><span>备注（选填）</span><input name="note" maxLength={300} /></label><button className={styles.primary} disabled={saving}>{saving ? "保存中…" : "保存日报"}</button></form><form className={styles.import} onSubmit={onImport}><h3>批量导入</h3><p>每行 9 列，用英文逗号分开：日期、归因 ID、成本（美分）、发送、送达、总粉、有效粉、转化、备注。首行可不写标题。</p><textarea name="csv" required placeholder={`2026-10-01,归因ID,12500,1000,950,45,30,4,首日\n2026-10-02,归因ID,13800,1200,1130,51,35,5,`} /><button className={styles.secondary} disabled={saving}>导入并覆盖同日记录</button></form></div> : <p className={styles.readonly}>财务账号只能看，不能录入或导入。</p>}<EntryTable entries={entries} /></section>;
}

function NumberFields() { return <><label><span>成本（美分）</span><input name="spendCents" type="number" min="0" defaultValue="0" required /></label><label><span>发送数</span><input name="sentCount" type="number" min="0" defaultValue="0" required /></label><label><span>送达数</span><input name="deliveredCount" type="number" min="0" defaultValue="0" required /></label><label><span>总粉数</span><input name="fansCount" type="number" min="0" defaultValue="0" required /></label><label><span>有效粉数</span><input name="validFansCount" type="number" min="0" defaultValue="0" required /></label><label><span>转化数</span><input name="conversionCount" type="number" min="0" defaultValue="0" required /></label></>; }

function EntryTable({ entries }: { entries: DailyEntry[] }) { return <div className={styles.tableWrap}><table><thead><tr><th>日期</th><th>来源归因</th><th>类型</th><th>成本</th><th>发送/送达</th><th>总粉</th><th>有效粉</th><th>有效率</th><th>转化</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{entry.businessDate}</td><td><strong>{entry.attribution.name}</strong></td><td>{entry.attribution.sourceType === "ADS" ? "投流" : "短信"}</td><td>{amount(entry.spendCents)}</td><td>{number(entry.sentCount)} / {number(entry.deliveredCount)}</td><td>{number(entry.fansCount)}</td><td>{number(entry.validFansCount)}</td><td>{percent(entry.fansCount ? entry.validFansCount / entry.fansCount : 0)}</td><td>{number(entry.conversionCount)}</td></tr>)}{!entries.length ? <tr><td className={styles.noRows} colSpan={9}>当前日期和渠道范围没有日报。</td></tr> : null}</tbody></table></div>; }

function Ranking({ title, note, rows, data, type, compact = false }: { title: string; note: string; rows: Ranking[]; data: OpsData; type: "creative" | "vendor"; compact?: boolean }) { return <section className={styles.section}><header><div><h2>{title}</h2><p>{note}</p></div></header><div className={styles.tableWrap}><table><thead><tr><th>排名</th><th>{type === "creative" ? "素材" : "粉商"}</th><th>渠道</th><th>总粉</th><th>有效粉</th><th>有效粉率</th>{type === "vendor" ? <th>送达率</th> : null}<th>成本</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id}><td><span className={styles.rank}>{index + 1}</span></td><td><strong>{row.name}</strong></td><td>{channelName(data, row.channelId)}</td><td>{number(row.fansCount)}</td><td>{number(row.validFansCount)}</td><td><strong>{percent(row.validRate)}</strong></td>{type === "vendor" ? <td>{percent(row.deliveryRate)}</td> : null}<td>{amount(row.spendCents)}</td></tr>)}{!rows.length ? <tr><td colSpan={type === "vendor" ? 8 : 7} className={styles.noRows}>还没有足够的日报数据，先建档并录入一天数据。</td></tr> : null}</tbody></table></div>{compact ? <button className={styles.linkButton} onClick={() => { window.location.assign(type === "creative" ? "/marketing-ops#creatives" : "/marketing-ops#vendors"); }}>查看完整榜单</button> : null}</section>; }

function catalogPayload(kind: CatalogKind, form: FormData) {
  const value = (key: string) => String(form.get(key) ?? "").trim();
  const optional = (key: string) => value(key) || undefined;
  const base = { kind, channelId: value("channelId"), name: value("name") };
  if (kind === "buyer") return { ...base, employeeCode: optional("employeeCode") };
  if (kind === "adAccount") return { ...base, platform: value("platform"), externalCode: optional("externalCode"), buyerId: optional("buyerId") };
  if (kind === "campaign") return { ...base, adAccountId: value("adAccountId"), externalCode: optional("externalCode") };
  if (kind === "creative") return { ...base, campaignId: value("campaignId"), externalCode: optional("externalCode") };
  if (kind === "vendor") return { ...base, contactName: optional("contactName") };
  if (kind === "smsBatch") return { ...base, vendorId: value("vendorId"), sentOn: optional("sentOn"), externalCode: optional("externalCode") };
  return { ...base, sourceType: value("sourceType"), trafficBuyerId: optional("trafficBuyerId"), adAccountId: optional("adAccountId"), adCampaignId: optional("adCampaignId"), creativeAssetId: optional("creativeAssetId"), smsVendorId: optional("smsVendorId"), smsBatchId: optional("smsBatchId") };
}

function dailyPayload(form: FormData) { const value = (key: string) => String(form.get(key) ?? "").trim(); const count = (key: string) => Number(value(key) || 0); return { kind: "daily", businessDate: value("businessDate"), attributionId: value("attributionId"), spendCents: count("spendCents"), sentCount: count("sentCount"), deliveredCount: count("deliveredCount"), fansCount: count("fansCount"), validFansCount: count("validFansCount"), conversionCount: count("conversionCount"), note: value("note") || undefined }; }

function parseImport(raw: string) { const rows = raw.trim().split(/\r?\n/).filter(Boolean); const parsed = rows.map((line) => line.split(",").map((cell) => cell.trim())); if (parsed[0]?.[0]?.includes("日期")) parsed.shift(); return parsed.map((cells, index) => { if (cells.length < 8) throw new Error(`第 ${index + 1} 行列数不够，请按提示填写 9 列`); const [businessDate, attributionId, spendCents, sentCount, deliveredCount, fansCount, validFansCount, conversionCount, note = ""] = cells; return { businessDate, attributionId, spendCents: Number(spendCents || 0), sentCount: Number(sentCount || 0), deliveredCount: Number(deliveredCount || 0), fansCount: Number(fansCount || 0), validFansCount: Number(validFansCount || 0), conversionCount: Number(conversionCount || 0), note: note || undefined }; }); }
function filterChannel(rows: Entity[], channelId: string) { return channelId ? rows.filter((row) => row.channelId === channelId) : rows; }
