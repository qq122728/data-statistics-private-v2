"use client";

import { useCallback, useEffect, useState } from "react";
import { requestJson } from "@/lib/backend";

type Position = "RECEPTION";
type Values = {
  version: number;
  dispatchCount: number;
  effectiveCount: number;
  replyCount: number;
  joinCount: number;
  operatorReceivedCount: number;
  normalLeaveCount: number;
  abnormalLeaveCount: number;
  currentInGroupCount: number;
  expertIntroCount: number;
  expertReceivedCount: number;
  expertContactedCount: number;
  registrationCount: number;
  orderCount: number;
  cryptoInitialDepositCents: number;
  bankInitialDepositCents: number;
  cryptoRechargeCents: number;
  bankRechargeCents: number;
  withdrawalCents: number;
  changeReason: string | null;
};
type Entry = {
  id: string;
  businessDate: string;
  position: Position;
  owner: { name: string };
  group: { name: string };
  channel: { name: string };
  sourceReception: { name: string } | null;
  sourceGroupOperator: { name: string } | null;
  currentRevision: Values;
};

function summary(entry: Entry) {
  const v = entry.currentRevision;
  return `下发 ${v.dispatchCount} · 有效 ${v.effectiveCount} · 回复 ${v.replyCount} · 进群 ${v.joinCount}`;
}

export function RealResourceDailyStatReview() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setEntries(
        (await requestJson<{ entries: Entry[] }>("/api/resource/daily-stats"))
          .entries,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "员工每日数据读取失败",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function approve(entry: Entry) {
    setBusyId(entry.id);
    setError("");
    setNotice("");
    try {
      await requestJson("/api/resource/daily-stats", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entryId: entry.id,
          action: "APPROVE",
        }),
      });
      setNotice(`${entry.owner.name} 的数据已确认并正式进入统计。`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "处理失败");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2 className="card-title">接粉每日数据核对</h2>
          <p className="card-note">
            员工保存后会直接出现在这里。确认无误后计入正式统计；发现错误请线下联系员工修改，再刷新查看最新版。
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="badge" data-tone={entries.length ? "warn" : "ok"}>
            待核对 {entries.length}
          </span>
          <button
            className="btn"
            data-size="sm"
            disabled={loading}
            onClick={() => void load()}
          >
            刷新
          </button>
        </div>
      </div>
      {error ? (
        <div className="notice" data-tone="bad" style={{ margin: 12 }}>
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="notice" data-tone="ok" style={{ margin: 12 }}>
          {notice}
        </div>
      ) : null}
      <div className="table-scroll">
        <table
          className="grid-table"
          data-sticky-edges="true"
          style={{ minWidth: entries.length ? 960 : "100%" }}
        >
          <colgroup>
            <col style={{ width: "17%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "31%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "19%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>日期 / 小组 / 员工</th>
              <th>岗位 / 渠道来源</th>
              <th>员工填写数据</th>
              <th>更正原因</th>
              <th>核对操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} style={{ padding: 40, textAlign: "center" }}>
                  正在读取员工保存的数据…
                </td>
              </tr>
            ) : null}
            {!loading && !entries.length ? (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    padding: 42,
                    textAlign: "center",
                    color: "var(--ink-3)",
                  }}
                >
                  暂无待核对的接粉每日数据
                </td>
              </tr>
            ) : null}
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>
                  <strong>{entry.businessDate}</strong>
                  <div className="muted">
                    {entry.group.name} · {entry.owner.name}
                  </div>
                </td>
                <td>
                  <span className="badge">接粉</span> {entry.channel.name}
                </td>
                <td>{summary(entry)}</td>
                <td>
                  {entry.currentRevision.version > 1 ? (
                    <>
                      <span className="badge" data-tone="warn">
                        纠错提交 · 第 {entry.currentRevision.version} 版
                      </span>
                      <div style={{ marginTop: 5 }}>
                        {entry.currentRevision.changeReason || (
                          <span className="muted">未填写更正说明</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <span className="muted">首次填写</span>
                  )}
                </td>
                <td><button className="btn" data-size="sm" data-variant="primary" data-confirm-action="接粉数据无误" disabled={Boolean(busyId)} onClick={() => void approve(entry)}>确认无误</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
