"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { requestJson } from "@/lib/backend";

type ChannelType = "SMS" | "ADS" | "REBATE";
type Channel = {
  id: string;
  name: string;
  active: boolean;
  channelType: ChannelType;
  createdAt: string;
  creator: { name: string } | null;
  groupCount: number;
  batchCount: number;
};
type Operation = { kind: "create" } | { kind: "edit" | "toggle"; channel: Channel };

const typeLabel: Record<ChannelType, string> = { SMS: "短信粉", ADS: "投流粉", REBATE: "底料返点" };

export function RealChannelSettings() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [operation, setOperation] = useState<Operation | null>(null);
  const [name, setName] = useState("");
  const [channelType, setChannelType] = useState<ChannelType>("SMS");
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const payload = await requestJson<{ channels: Channel[] }>("/api/admin/channels");
      setChannels(payload.channels);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "渠道读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => channels.filter((channel) => (
    channel.name.toLowerCase().includes(search.trim().toLowerCase())
    && (!status || String(channel.active) === status)
  )), [channels, search, status]);

  function open(next: Operation) {
    setOperation(next);
    setName(next.kind === "create" ? "" : next.channel.name);
    setChannelType(next.kind === "create" ? "SMS" : next.channel.channelType);
    setReason("");
    setPassword("");
    setError("");
    setSuccess("");
  }

  function close() {
    if (saving) return;
    setOperation(null);
    setPassword("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!operation) return;
    setSaving(true);
    setError("");
    try {
      const credentials = { highRiskReason: reason.trim(), currentPassword: password };
      if (operation.kind === "create") {
        await requestJson("/api/admin/channels", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ global: true, name: name.trim(), channelType, ...credentials }),
        });
        setSuccess(`第 1 步完成：渠道“${name.trim()}”已添加并同步到全部小组。现在可到“全局人事”创建资源部账号，并绑定这一种渠道类型。`);
      } else if (operation.kind === "edit") {
        await requestJson("/api/admin/channels", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ global: true, id: operation.channel.id, name: name.trim(), ...credentials }),
        });
        setSuccess(`渠道“${operation.channel.name}”已更新`);
      } else {
        await requestJson("/api/admin/channels", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ global: true, id: operation.channel.id, active: !operation.channel.active, ...credentials }),
        });
        setSuccess(`渠道“${operation.channel.name}”已${operation.channel.active ? "停用" : "启用"}`);
      }
      setOperation(null);
      setPassword("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "渠道操作失败");
    } finally {
      setSaving(false);
    }
  }

  const dialogTitle = operation?.kind === "create" ? "添加全局渠道"
    : operation?.kind === "edit" ? "编辑全局渠道"
      : operation?.channel.active ? "确认停用渠道" : "确认重新启用渠道";

  return <div style={{ display: "grid", gap: 16 }}>
    <section className="card">
      <div className="card-head">
        <div><h2 className="card-title">第 1 步：先创建资源渠道</h2><p className="card-note">渠道创建成功后，再到“全局人事”创建资源部账号并绑定渠道。账号不能无渠道存在，也不能混合投流和短信类型。</p></div>
        <button type="button" className="btn" data-variant="primary" onClick={() => open({ kind: "create" })}>＋ 添加渠道</button>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "0 16px 16px" }}>
        <input className="field" aria-label="搜索渠道" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索渠道名称" style={{ minWidth: 240 }} />
        <select className="field" aria-label="渠道状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="true">启用</option><option value="false">停用</option></select>
        <button type="button" className="btn" onClick={() => void load()}>刷新</button>
      </div>
      {success ? <div className="notice" data-tone="ok" style={{ margin: "0 16px 14px" }}>{success}</div> : null}
      {error && !operation ? <div className="notice" data-tone="bad" style={{ margin: "0 16px 14px" }}>{error}</div> : null}
      <div className="table-scroll"><table className="grid-table" data-sticky-edges="true" style={{ minWidth: 980 }}><thead><tr><th>渠道名称</th><th>类型</th><th>使用范围</th><th>创建人</th><th>创建时间</th><th>历史批次</th><th>状态</th><th>操作</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={8} style={{ padding: 40, textAlign: "center" }}>正在读取渠道…</td></tr> : null}
        {!loading && !filtered.length ? <tr><td colSpan={8} style={{ padding: 40, textAlign: "center", color: "var(--ink-3)" }}>没有符合条件的渠道</td></tr> : null}
        {filtered.map((channel) => <tr key={channel.id}><td><strong>{channel.name}</strong></td><td><span className="badge" data-tone="mute">{typeLabel[channel.channelType]}</span></td><td>全部公司 / {channel.groupCount} 个小组</td><td>{channel.creator?.name ?? "系统"}</td><td>{new Intl.DateTimeFormat("zh-CN").format(new Date(channel.createdAt))}</td><td className="num">{channel.batchCount}</td><td><span className="badge" data-tone={channel.active ? "ok" : "mute"}>{channel.active ? "启用" : "停用"}</span></td><td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><button type="button" className="btn" data-size="sm" onClick={() => open({ kind: "edit", channel })}>编辑</button><button type="button" className="btn" data-size="sm" onClick={() => open({ kind: "toggle", channel })}>{channel.active ? "停用" : "启用"}</button></div></td></tr>)}
      </tbody></table></div>
    </section>

    {operation ? <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }} style={{ position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", padding: 20, background: "rgba(15,23,42,.34)" }}><section role="dialog" aria-modal="true" aria-label={dialogTitle} className="card" style={{ width: "min(560px, 100%)", padding: 20 }}><div className="card-head" style={{ padding: 0, marginBottom: 16 }}><div><h2 className="card-title">{dialogTitle}</h2><p className="card-note">总公司介入渠道管理属于高风险操作，需要说明原因并验证当前密码。</p></div></div><form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
      {operation.kind !== "toggle" ? <><label><span className="label">渠道名称</span><input className="field" value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} style={{ width: "100%" }} /></label><label><span className="label">渠道类型</span><select className="field" value={channelType} disabled={operation.kind === "edit"} onChange={(event) => setChannelType(event.target.value as ChannelType)} style={{ width: "100%" }}><option value="SMS">短信粉</option><option value="ADS">投流粉</option><option value="REBATE">底料返点</option></select>{operation.kind === "edit" ? <small className="muted">已有历史数据的渠道不能改类型，需要时请新建渠道。</small> : null}</label></> : <div className="notice" data-tone={operation.channel.active ? "bad" : "ok"}>确认{operation.channel.active ? "停用" : "重新启用"}“{operation.channel.name}”？历史数据不会删除。</div>}
      <label><span className="label">介入原因</span><textarea className="field" value={reason} onChange={(event) => setReason(event.target.value)} required minLength={4} maxLength={500} rows={3} placeholder="至少4个字，例如：资源部负责人休假，总公司临时代办" style={{ width: "100%" }} /></label>
      <label><span className="label">当前管理员密码</span><input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" style={{ width: "100%" }} /></label>
      {error ? <div className="notice" data-tone="bad">{error}</div> : null}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="btn" disabled={saving} onClick={close}>取消</button><button type="submit" className="btn" data-variant="primary" disabled={saving}>{saving ? "处理中…" : "确认并执行"}</button></div>
    </form></section></div> : null}
  </div>;
}
