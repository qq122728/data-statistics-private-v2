"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { requestJson } from "@/lib/backend";
import styles from "./ChannelManagementPanel.module.css";

type Channel = {
  id: string;
  name: string;
  active: boolean;
  channelType: "SMS" | "ADS" | "REBATE";
  groupCount: number;
  batchCount: number;
};

export function ChannelManagementPanel({ scope, groupId, onCreated }: {
  scope: "company" | "group";
  groupId?: string | null;
  onCreated?: (message: string) => void;
}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [name, setName] = useState("");
  const [channelType, setChannelType] = useState<Channel["channelType"]>("ADS");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await requestJson<{ channels: Channel[] }>("/api/admin/channels");
      setChannels(result.channels);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "渠道读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (scope === "group" && !groupId) { setError("当前组长没有绑定小组，不能新增渠道"); return; }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const created = await requestJson<{ name: string; groupCount?: number }>("/api/admin/channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(scope === "company" ? { company: true, name, channelType } : { groupId, name, channelType }),
      });
      const message = scope === "company"
        ? `渠道“${created.name}”已添加到本公司 ${created.groupCount ?? 0} 个启用小组`
        : `渠道“${created.name}”已添加到本小组`;
      setName("");
      setNotice(message);
      onCreated?.(message);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "渠道创建失败");
    } finally {
      setBusy(false);
    }
  }

  const typeLabel = (type: Channel["channelType"]) => ({ ADS: "投流粉", SMS: "短信粉", REBATE: "底料返点" })[type];
  return <div className={styles.stack}>
    <section className={styles.intro}><strong>{scope === "company" ? "新增公司渠道" : "新增本组渠道"}</strong><span>{scope === "company" ? "保存一次，自动覆盖本公司当前所有启用小组；不能添加到其他公司。" : "只添加到组长自己负责的小组；不能添加到其他小组。"}</span></section>
    <form className={styles.form} onSubmit={create}>
      <label>渠道名称<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="例如：FB-M" required /></label>
      <label>渠道类型<select value={channelType} onChange={(event) => setChannelType(event.target.value as Channel["channelType"])}><option value="ADS">投流粉</option><option value="SMS">短信粉</option><option value="REBATE">底料返点</option></select></label>
      <button disabled={busy || !name.trim()}>{busy ? "创建中…" : "新增渠道"}</button>
    </form>
    {error ? <div className={styles.error}>{error}</div> : null}
    {notice ? <div className={styles.notice}>{notice}</div> : null}
    <section className={styles.card}><header className={styles.head}><h2>{scope === "company" ? "本公司渠道" : "本组渠道"}</h2><span>{loading ? "读取中…" : `${channels.length} 个`}</span></header><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>渠道</th><th>类型</th><th>覆盖小组</th><th>真实批次</th><th>状态</th></tr></thead><tbody>{channels.map((channel) => <tr key={channel.id}><td><strong>{channel.name}</strong></td><td>{typeLabel(channel.channelType)}</td><td>{channel.groupCount}</td><td>{channel.batchCount}</td><td>{channel.active ? "启用" : "停用"}</td></tr>)}{!loading && !channels.length ? <tr><td className={styles.empty} colSpan={5}>还没有渠道</td></tr> : null}</tbody></table></div></section>
  </div>;
}
