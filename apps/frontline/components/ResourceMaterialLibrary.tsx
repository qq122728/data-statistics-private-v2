"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/backend";
import type { BuyerPayload, Material } from "./ResourceBuyerAttribution";
import { countryName } from "../../../packages/resource-buyer/options";
import styles from "./ResourceMaterialLibrary.module.css";

const accept = ".mp4,.mov,.webm,.jpg,.jpeg,.png,.webp,.gif";
const sizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const money = (cents = 0) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(cents / 100);
const fileUrl = (item: Material) => `/api/resource/materials/${encodeURIComponent(item.id)}/file?v=${encodeURIComponent(item.fileKey ?? "")}`;
const monthNow = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,"0")}`; };

function upload(url: string, method: "POST" | "PUT", body: FormData, onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open(method, url); xhr.timeout = 180000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => { let payload: { error?: string } = {}; try { payload = JSON.parse(xhr.responseText); } catch { /* Non-JSON proxy errors. */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(payload.error || (xhr.status === 413 ? "上传文件太大，请压缩后重试" : "保存失败，请稍后重试")));
    };
    xhr.onerror = () => reject(new Error("网络连接中断，请刷新素材库确认保存结果"));
    xhr.ontimeout = () => reject(new Error("上传超时，请刷新素材库确认保存结果"));
    xhr.send(body);
  });
}

export function ResourceMaterialLibrary({ readOnly = false, onViewNumbers }: { readOnly?: boolean; onViewNumbers: (id: string, month: string) => void }) {
  const [payload, setPayload] = useState<BuyerPayload | null>(null);
  const [month, setMonth] = useState(monthNow);
  const [channel, setChannel] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [kind, setKind] = useState("");
  const [editing, setEditing] = useState<Material | "new" | null>(null);
  const [preview, setPreview] = useState<Material | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [loading, setLoading] = useState(true);
  const loadSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try { const data = await requestJson<BuyerPayload>(`/api/resource/buyer-phones?month=${month}`); if (sequence === loadSequence.current) { setPayload(data); setError(""); } }
    catch (caught) { if (sequence === loadSequence.current) setError((caught as Error).message); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [month]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, []);
  const channels = payload?.channels.filter(item => item.channelType === "ADS") ?? [];
  const materials = (payload?.materials ?? []).filter(item => channels.some(c => c.id === item.channelId));
  const filtered = materials.filter(item => (!channel || item.channelId === channel) && (!status || (status === "active") === item.active) && (!kind || (kind === "link" ? !item.fileKey : item.fileMime?.startsWith(`${kind}/`))) && `${item.name} ${item.buyer.name}`.toLowerCase().includes(search.trim().toLowerCase()));
  async function toggle(item: Material) {
    setBusyId(item.id); setError("");
    try {
      await requestJson("/api/resource/buyer-phones", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ materialId: item.id, active: !item.active }) });
      setNotice(item.active ? "素材已停用，已关联号码和历史效果仍然保留。" : "素材已启用，可以在导入号码时选择。"); await load();
    } catch (caught) { setError((caught as Error).message); } finally { setBusyId(""); }
  }
  return <div className={styles.page}>
    <section className={styles.heading}><div><span className={styles.eyebrow}>投流资源</span><h2>素材库</h2><p>保存视频、图片和链接，追踪每个素材带来的客户与开单效果。</p></div><div className={styles.actions}><button onClick={() => void load()} disabled={loading}>刷新</button>{!readOnly ? <button className={styles.primary} disabled={!channels.length} onClick={() => setEditing("new")}>＋ 新建素材</button> : null}</div></section>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}{notice ? <p role="status" className={styles.notice}>{notice}</p> : null}
    <section className={styles.toolbar}>
      <label>搜索素材或投手<input placeholder="输入素材名称、投手姓名" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label>渠道<select value={channel} onChange={event => setChannel(event.target.value)}><option value="">全部投流渠道</option>{channels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>类型<select value={kind} onChange={event => setKind(event.target.value)}><option value="">全部类型</option><option value="video">视频</option><option value="image">图片</option><option value="link">链接／名称</option></select></label>
      <label>状态<select value={status} onChange={event => setStatus(event.target.value)}><option value="active">使用中</option><option value="inactive">已停用</option><option value="">全部状态</option></select></label>
      <label>效果统计月份<input type="month" value={month} onChange={event => { if(event.target.value) setMonth(event.target.value); }} /></label>
    </section>
    <div className={styles.resultLine}><strong>{loading ? "正在读取…" : `${filtered.length} 个素材`}</strong><span>按所选月份导入的号码统计，后续转化持续累计。开单率＝开单人数 ÷ 已匹配人数。</span></div>
    <div className={styles.grid}>{filtered.map(item => {
      const countryRows = payload?.materialSummary.filter(row => row.materialId === item.id) ?? [];
      const metrics = countryRows.reduce((total,row) => ({ imported:total.imported+row.imported, matched:total.matched+row.matched, opened:total.opened+row.opened, firstCents:total.firstCents+row.firstCents, rechargeCents:total.rechargeCents+row.rechargeCents, netCents:total.netCents+row.netCents }), {imported:0,matched:0,opened:0,firstCents:0,rechargeCents:0,netCents:0});
      return <article key={item.id} className={styles.card}>
        <button className={styles.cover} onClick={() => setPreview(item)} aria-label={`预览 ${item.name}`}>
          {item.fileMime?.startsWith("image/") ? <img loading="lazy" src={fileUrl(item)} alt={item.name} /> : <div><span className={styles.coverIcon}>{item.fileMime?.startsWith("video/") ? "▶" : "↗"}</span><strong>{item.fileMime?.startsWith("video/") ? "点击播放视频" : item.url ? "查看素材链接" : "查看素材资料"}</strong><small>{item.fileBytes ? sizeLabel(item.fileBytes) : "名称与链接素材"}</small></div>}
          <span className={styles.badge}>{item.active ? "使用中" : "已停用"}</span>
        </button>
        <div className={styles.cardBody}><h3>{item.name}</h3><p>{item.buyer.name} · {channels.find(c => c.id === item.channelId)?.name}</p>
          <p>国家：{countryRows.length ? countryRows.map(row=>countryName(row.country)).join("、") : "暂无号码"}</p><dl className={styles.metrics}><div><dt>导入 / 匹配</dt><dd>{metrics?.imported ?? 0} / {metrics?.matched ?? 0}</dd></div><div><dt>开单人数</dt><dd>{metrics?.opened ?? 0}</dd></div><div><dt>开单率</dt><dd>{metrics?.matched ? `${(metrics.opened/metrics.matched*100).toFixed(1)}%` : "—"}</dd></div><div><dt>首充</dt><dd>{money(metrics?.firstCents)}</dd></div><div><dt>续充</dt><dd>{money(metrics?.rechargeCents)}</dd></div><div><dt>净业绩</dt><dd>{money(metrics?.netCents)}</dd></div></dl>
          <div className={styles.cardActions}><button disabled={loading} onClick={() => onViewNumbers(item.id, month)}>号码与详细效果</button>{!readOnly ? <><button onClick={() => setEditing(item)}>编辑</button><button disabled={busyId === item.id} onClick={() => void toggle(item)}>{item.active ? "停用" : "启用"}</button></> : null}</div>
        </div>
      </article>;
    })}</div>
    {!loading && !filtered.length ? <div className={styles.empty}>当前条件下没有素材。{!readOnly ? "点击“新建素材”，上传第一条视频或图片。" : "负责人创建素材后会显示在这里。"}</div> : null}
    {editing && payload ? <MaterialEditor material={editing === "new" ? null : editing} payload={payload} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); setNotice("素材已保存。导入号码时选择对应投手和素材即可。"); await load(); }} /> : null}
    {preview ? <PreviewDialog material={preview} onClose={() => setPreview(null)} /> : null}
  </div>;
}

function PreviewDialog({ material, onClose }: { material: Material; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mediaError, setMediaError] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={styles.dialog} aria-label={`预览 ${material.name}`} onCancel={onClose}><div className={styles.dialogHeader}><div><h3>{material.name}</h3><p>{material.buyer.name}{material.fileName ? ` · ${material.fileName}` : ""}</p></div><button onClick={onClose}>关闭</button></div>
    {material.fileMime?.startsWith("video/") ? <video className={styles.video} src={fileUrl(material)} controls playsInline preload="metadata" onError={() => setMediaError(true)} /> : material.fileMime?.startsWith("image/") ? <img className={styles.image} src={fileUrl(material)} alt={material.name} onError={() => setMediaError(true)} /> : <p className={styles.empty}>此素材通过名称和链接管理。</p>}
    {mediaError ? <p className={styles.error}>浏览器无法预览此文件，可下载后查看；MP4（H.264）通常兼容性最好。</p> : null}
    <div className={styles.actions}>{material.url ? <a href={material.url} target="_blank" rel="noopener noreferrer">打开素材链接 ↗</a> : null}{material.fileKey ? <a href={`${fileUrl(material)}&download=1`} download>下载原文件</a> : null}</div>
  </dialog>;
}

function MaterialEditor({ material, payload, onClose, onSaved }: { material: Material | null; payload: BuyerPayload; onClose: () => void; onSaved: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const channels = payload.channels.filter(item => item.channelType === "ADS");
  const [channelId, setChannelId] = useState(material?.channelId ?? channels[0]?.id ?? "");
  const [buyer, setBuyer] = useState(material?.buyer.name ?? "");
  const [name, setName] = useState(material?.name ?? "");
  const [url, setUrl] = useState(material?.url ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [localUrl, setLocalUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { if (!file) { setLocalUrl(""); return; } const value = URL.createObjectURL(file); setLocalUrl(value); return () => URL.revokeObjectURL(value); }, [file]);
  function choose(value: File | null) {
    setError("");
    if (value) {
      const image = /\.(jpe?g|png|webp|gif)$/i.test(value.name);
      if (!/\.(mp4|mov|webm|jpe?g|png|webp|gif)$/i.test(value.name) || value.size > (image ? 10 : 50)*1024*1024 || !value.size) {
        setError("请选择有效的视频（最大 50 MB）或图片（最大 10 MB），格式见下方提示。"); setFile(null); if (fileInput.current) fileInput.current.value = ""; return;
      }
      if (!name.trim()) setName(value.name.replace(/\.[^.]+$/, "").slice(0,100));
    }
    setFile(value);
  }
  async function save() {
    setBusy(true); setProgress(0); setError("");
    try {
      if (material) {
        await requestJson("/api/resource/buyer-phones", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ materialId: material.id, name: name.trim(), url: url.trim() }) });
        if (file) { const form = new FormData(); form.set("file", file); await upload(`/api/resource/materials/${material.id}/file`, "PUT", form, setProgress); }
      } else {
        const form = new FormData(); form.set("channelId", channelId); form.set("buyer", buyer.trim()); form.set("name", name.trim()); form.set("url", url.trim()); if (file) form.set("file", file);
        await upload("/api/resource/materials", "POST", form, setProgress);
      }
      await onSaved();
    } catch (caught) { setError(`${material ? "名称和链接若已保存会保留。" : ""}${(caught as Error).message}`); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className={styles.dialog} aria-label={material ? "编辑素材" : "新建素材"} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}><div className={styles.dialogHeader}><div><h3>{material ? "编辑素材" : "新建素材"}</h3><p>每条素材对应一个投手，可同时保存链接和一个视频或图片。</p></div><button type="button" disabled={busy} onClick={onClose}>关闭</button></div>
      <fieldset disabled={busy} className={styles.fields}><label>所属渠道<select value={channelId} disabled={!!material} onChange={event => { setChannelId(event.target.value); setBuyer(""); }} required>{channels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>投手<input value={buyer} disabled={!!material} maxLength={100} list="library-buyers" placeholder="例如 QQ、阳仔" onChange={event => setBuyer(event.target.value)} required /><datalist id="library-buyers">{payload.buyers.filter(item => item.channelId === channelId).map(item => <option key={item.id} value={item.name} />)}</datalist></label><label className={styles.wide}>素材名称<input value={name} maxLength={100} placeholder="例如：QQ－产品介绍视频 A" onChange={event => setName(event.target.value)} required /></label><label className={styles.wide}>素材链接（选填）<input type="url" value={url} maxLength={2048} placeholder="https://..." onChange={event => setUrl(event.target.value)} /></label>
      <div className={`${styles.uploadBox} ${styles.wide}`}><label>{material?.fileKey ? "替换文件（不选择则保留原文件）" : "上传视频或图片（选填）"}<input ref={fileInput} type="file" accept={accept} onChange={event => choose(event.target.files?.[0] ?? null)} /></label><p>视频：MP4、MOV、WebM，最大 50 MB。图片：JPG、PNG、WebP、GIF，最大 10 MB。推荐 MP4 视频；不同广告内容建议新建素材，便于比较效果。</p>{file ? <div><strong>{file.name} · {sizeLabel(file.size)}</strong><button type="button" onClick={() => { setFile(null); if(fileInput.current) fileInput.current.value = ""; }}>移除本次选择</button>{localUrl && /\.(jpe?g|png|webp|gif)$/i.test(file.name) ? <img className={styles.localPreview} src={localUrl} alt="待上传图片预览" /> : localUrl ? <video className={styles.localPreview} src={localUrl} controls preload="metadata" /> : null}</div> : material?.fileName ? <p>当前文件：{material.fileName}</p> : null}</div></fieldset>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}{busy ? <div role="status" className={styles.progress}><progress value={progress} max={100} />{progress < 100 ? `上传中 ${progress}%` : "上传完成，正在保存…"}</div> : null}
      <div className={styles.actions}><button type="button" disabled={busy} onClick={onClose}>取消</button><button className={styles.primary} disabled={busy || !channelId || !buyer.trim() || !name.trim()}>{busy ? "保存中…" : "保存素材"}</button></div>
    </form>
  </dialog>;
}
