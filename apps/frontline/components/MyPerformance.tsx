"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/lib/backend";
import { FUNNEL_CHIPS, type FunnelRow } from "@/lib/funnel";
import { RealPerformanceFunnel } from "./RealPerformanceFunnel";

type Role = "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
type ApiFunnelRow = {
  added: number; duplicate: number; lowAmount: number; noWs: number; effective: number;
  replied: number; joined: number; leftNormal: number; leftAbnormal: number; pushed: number;
  registered: number; ordered: number; depositCents: number; withdrawalCents: number; netCents: number;
};
type Payload = {
  role: Role;
  today: string;
  timezone: string;
  range: { from: string; to: string };
  funnel: {
    summary: ApiFunnelRow;
    daily: Array<{ date: string; row: ApiFunnelRow }>;
    channels: Array<{ id: string; name: string; row: ApiFunnelRow }>;
    currentInGroup: number;
  };
};

const emptyRow: FunnelRow = {
  added: 0, duplicate: 0, lowAmount: 0, noWs: 0, effective: 0, replied: 0, joined: 0,
  left: 0, leftAbnormal: 0, pushed: 0, registered: 0, ordered: 0,
  depositUsd: 0, withdrawalUsd: 0, netUsd: 0,
};

function toFunnelRow(row: ApiFunnelRow): FunnelRow {
  return {
    added: row.added,
    duplicate: row.duplicate,
    lowAmount: row.lowAmount,
    noWs: row.noWs,
    effective: row.effective,
    replied: row.replied,
    joined: row.joined,
    left: row.leftNormal + row.leftAbnormal,
    leftAbnormal: row.leftAbnormal,
    pushed: row.pushed,
    registered: row.registered,
    ordered: row.ordered,
    depositUsd: row.depositCents / 100,
    withdrawalUsd: row.withdrawalCents / 100,
    netUsd: row.netCents / 100,
  };
}

export function MyPerformance({ role }: { role: Role }) {
  const [data, setData] = useState<Payload | null>(null);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(from?: string, to?: string) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ role });
      if (from && to) {
        params.set("range", "custom");
        params.set("sourceDateFrom", from);
        params.set("sourceDateTo", to);
      } else {
        params.set("range", "month");
      }
      const next = await requestJson<Payload>(`/api/personal-performance?${params.toString()}`);
      setData(next);
      setRangeStart(next.range.from);
      setRangeEnd(next.range.to);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "个人业绩加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setData(null);
    setRangeStart("");
    setRangeEnd("");
    void load();
  }, [role]);

  function changeRange(from: string, to: string) {
    setRangeStart(from);
    setRangeEnd(to);
    if (from && to) void load(from, to);
  }

  const summary = data ? toFunnelRow(data.funnel.summary) : emptyRow;
  const daily = data?.funnel.daily.map((item) => ({ date: item.date, row: toFunnelRow(item.row) })) ?? [];
  const channels = data?.funnel.channels.map((item) => ({ ...item, row: toFunnelRow(item.row) })) ?? [];
  const today = data?.today ?? rangeEnd;
  const monthStart = today ? `${today.slice(0, 7)}-01` : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error ? <div className="card" role="alert" style={{ padding: 14, color: "var(--bad)" }}>{error}</div> : null}
      <RealPerformanceFunnel
        summary={summary}
        daily={daily}
        currentInGroup={data?.funnel.currentInGroup ?? 0}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        monthStart={monthStart}
        monthEnd={today}
        loading={loading}
        onRangeChange={changeRange}
      />

      {channels.length ? (
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="card-head">
            <div>
              <h2 className="card-title">分渠道</h2>
              <p className="card-note">同一套漏斗指标按渠道拆开，看哪个渠道真的值得投</p>
            </div>
            <span className="badge" data-tone="ok">真实数据</span>
          </div>
          <div className="table-scroll" style={{ maxHeight: "none" }}>
            <table className="grid-table">
              <thead>
                <tr>
                  <th style={{ width: 130 }}>渠道</th>
                  {FUNNEL_CHIPS.map((chip) => <th key={chip.key} style={{ width: 92 }}>{chip.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {channels.map(({ id, name, row }) => (
                  <tr key={id}>
                    <td style={{ fontWeight: 600 }}>{name}</td>
                    {FUNNEL_CHIPS.map((chip) => (
                      <td key={chip.key} className="tnum" style={{
                        textAlign: "center",
                        color: chip.tone?.(row) === "ok" ? "var(--ok)" : chip.tone?.(row) === "bad" ? "var(--bad)" : undefined,
                        fontWeight: chip.tone?.(row) ? 700 : 400,
                      }}>
                        {chip.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
