"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/lib/backend";
import { formatCustomerNumber, formatUsd, type ImportRow } from "@/lib/customer-import";
import { normalizeImportedCustomerNumber, parseImportClipboard } from "@/lib/import-parse";
import { IconCheck, IconPlus, IconUpload } from "./Icons";

const STATUS_META = {
  ok: { tone: "ok" as const, label: "可导入", note: "" },
  dup: { tone: "bad" as const, label: "撞粉", note: "号码已存在，不建档" },
  low: { tone: "warn" as const, label: "低金额", note: "低于 $5,000，不建档" },
  nows: { tone: "warn" as const, label: "无 WhatsApp", note: "缺号码，不建档" },
  incomplete: { tone: "mute" as const, label: "待填写", note: "手机号必填" },
};

function statusOf(phone: string, amountUsd: number | null, seenInBatch: Set<string>): ImportRow["status"] {
  const key = phone.replace(/\s/g, "");
  if (!key) return "incomplete";
  if (seenInBatch.has(key)) return "dup";
  if (amountUsd !== null && amountUsd < 5000) return "low";
  return "ok";
}

/** 手动新增一行之后，整批的"撞粉"判断要重新算一遍——不然新加的行看不出跟同批其它行重号 */
function recomputeStatuses(list: ImportRow[]): ImportRow[] {
  const seen = new Set<string>();
  return list.map((r) => {
    const status = statusOf(r.phone, r.amountUsd, seen);
    const key = r.phone.replace(/\s/g, "");
    if (key) seen.add(key);
    return { ...r, status };
  });
}

export function TabImport({
  onToast,
}: {
  onToast: (msg: string, tone?: "ok" | "warn") => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteErrors, setPasteErrors] = useState<string[]>([]);
  const [options, setOptions] = useState<{
    today: string;
    channels: Array<{ id: string; name: string }>;
    attributionOwners: Array<{ id: string; name: string }>;
    currentUserId: string;
  } | null>(null);
  const [channelId, setChannelId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void requestJson<NonNullable<typeof options>>("/api/reception/import-options")
      .then((payload) => {
        setOptions(payload);
        setChannelId(payload.channels[0]?.id ?? "");
        setOwnerId(payload.currentUserId);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "读取导入选项失败"));
  }, []);

  const okCount = rows.filter((r) => r.status === "ok").length;
  const dupCount = rows.filter((r) => r.status === "dup").length;
  const lowCount = rows.filter((r) => r.status === "low").length;
  const noWsCount = rows.filter((r) => r.status === "nows").length;
  const incompleteCount = rows.filter((r) => r.status === "incomplete").length;

  function applyPaste() {
    const { rows: parsed, errors } = parseImportClipboard(pasteText);
    if (!parsed.length) {
      setPasteErrors(errors.length ? errors : ["没识别到任何一行有效数据，检查一下粘贴的内容"]);
      return;
    }
    const seen = new Set<string>();
    const built: ImportRow[] = parsed.map((p, i) => {
      const status = statusOf(p.phone, p.amountUsd, seen);
      seen.add(p.phone.replace(/\s/g, ""));
      return {
        id: `paste-${i}`, phone: p.phone, name: p.name, email: p.email,
        amountUsd: p.amountUsd, platform: p.platform, status,
      };
    });
    setRows(built);
    setLoaded(true);
    setPasteOpen(false);
    setPasteText("");
    setPasteErrors([]);
    const ok = built.filter((r) => r.status === "ok").length;
    onToast(`已识别 ${built.length} 行，其中 ${ok} 条可导入${errors.length ? `，${errors.length} 行有问题已跳过` : ""}`);
  }

  /** 像Excel一样直接加一行——不用上传/粘贴，逐格手填 */
  function addManualRow() {
    const row: ImportRow = {
      id: `manual-${Date.now()}`, phone: "", name: "", email: "", amountUsd: null, platform: "", status: "incomplete",
    };
    setRows((p) => recomputeStatuses(loaded ? [...p, row] : [row]));
    setLoaded(true);
  }
  function patchManualRow(id: string, patch: Partial<ImportRow>) {
    setRows((p) => recomputeStatuses(p.map((r) => (r.id === id ? { ...r, ...patch } : r))));
  }
  function removeManualRow(id: string) {
    setRows((p) => recomputeStatuses(p.filter((r) => r.id !== id)));
  }

  const Step = ({ n }: { n: number }) => (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 20, height: 20, borderRadius: 999, background: "var(--accent-soft)",
      color: "var(--accent)", fontSize: 12, fontWeight: 700, flexShrink: 0,
    }}>{n}</span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 第一步：来源 */}
      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Step n={1} />选择来源
            </h2>
            <p className="card-note">这批号码归到哪个渠道、哪一天。定了之后这批就一直绑在一起算账。</p>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10, padding: 12 }}>
          <div>
            <label className="label">导入日期</label>
            <input className="field" style={{ width: "100%" }} value={options?.today ?? "读取中…"} readOnly />
          </div>
          <div>
            <label className="label">来源渠道</label>
            <select className="field" style={{ width: "100%" }}
              value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              {!options?.channels.length ? <option value="">暂无可用渠道</option> : null}
              {options?.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">粉的归属</label>
            <select className="field" style={{ width: "100%" }}
              value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              {options?.attributionOwners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* 第二步：上传 / 粘贴 / 手动新增 */}
      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Step n={2} />导入号码
            </h2>
            <p className="card-note">上传 Excel、直接粘贴，或者像 Excel 一样逐行手填。</p>
          </div>
        </div>
        <div style={{ padding: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn" style={{ height: 40, width: 160 }} onClick={() => setPasteOpen(true)}>
            <IconUpload size={17} />
            从 Excel 粘贴
          </button>
          <button className="btn" style={{ height: 40, width: 140 }} onClick={addManualRow}>
            <IconPlus size={14} />新增一行
          </button>
        </div>
      </div>

      {pasteOpen ? (
        <div
          onMouseDown={(e) => e.target === e.currentTarget && setPasteOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 100, background: "rgba(19,24,36,.42)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}
        >
          <div
            role="dialog" aria-modal="true"
            style={{
              width: "100%", maxWidth: 640, background: "var(--surface)",
              border: "1px solid var(--line)", borderRadius: "var(--radius-lg)",
              boxShadow: "0 20px 50px rgba(19,24,36,.22)",
            }}
          >
            <div style={{ padding: "18px 20px 4px" }}>
              <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700 }}>从 Excel 粘贴</h3>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
                直接从 Excel 复制几行选中区域，粘贴进来。第一行可以是列名（比如"客户编号 客户姓名 邮箱 金额"，顺序随意），
                也可以不带列名，按"编号、姓名、（设备号跳过）、金额、平台、备注"的固定顺序识别。只有客户编号是必填的。
              </p>
            </div>
            <div style={{ padding: "12px 20px" }}>
              <textarea
                autoFocus rows={10} value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={"客户编号\t客户姓名\t邮箱\t金额\t平台\n4917 6650 2231\tMichael Braun\tm.braun@web.de\t38000\tMT5"}
                style={{
                  width: "100%", padding: "10px 12px", resize: "vertical",
                  border: "1px solid var(--line-strong)", borderRadius: "var(--radius)",
                  fontSize: 13, fontFamily: "ui-monospace, monospace", outline: "none",
                }}
              />
              {pasteErrors.length ? (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                  {pasteErrors.map((e, i) => (
                    <p key={i} style={{ margin: 0, fontSize: 12.5, color: "var(--bad)" }}>{e}</p>
                  ))}
                </div>
              ) : null}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "13px 20px", borderTop: "1px solid var(--line)" }}>
              <button className="btn" onClick={() => { setPasteOpen(false); setPasteText(""); setPasteErrors([]); }}>取消</button>
              <button className="btn" data-variant="primary" disabled={!pasteText.trim()} onClick={applyPaste}>
                识别并预览
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 第三步：预览 */}
      {loaded ? (
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="card-head">
            <div>
              <h2 className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Step n={3} />核对后导入
              </h2>
              <p className="card-note">标红标黄的不会建客户档案；如需计入当天统计，请到「每日数据填写」单独填写数量。</p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span className="badge" data-tone="ok">可导入 {okCount}</span>
              {dupCount ? <span className="badge" data-tone="bad">撞粉 {dupCount}</span> : null}
              {lowCount ? <span className="badge" data-tone="warn">低金额 {lowCount}</span> : null}
              {noWsCount ? <span className="badge" data-tone="warn">无 WS {noWsCount}</span> : null}
              {incompleteCount ? <span className="badge" data-tone="mute">待填写 {incompleteCount}</span> : null}
            </div>
          </div>

          <div className="table-scroll">
            <table className="grid-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }} className="num">#</th>
                  <th style={{ width: 150 }}>手机号</th>
                  <th style={{ width: 130 }}>客户姓名</th>
                  <th style={{ width: 180 }}>邮箱</th>
                  <th className="num" style={{ width: 100 }}>金额</th>
                  <th style={{ width: 90 }}>平台</th>
                  <th style={{ width: 220 }}>检查结果</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const meta = STATUS_META[r.status];
                  const manual = r.id.startsWith("manual-");
                  const tone = r.status === "dup" ? "bad" : r.status === "ok" || r.status === "incomplete" ? undefined : "warn";
                  if (manual) {
                    return (
                      <tr key={r.id} data-tone={tone}>
                        <td className="num" style={{ color: "var(--ink-3)" }}>{i + 1}</td>
                        <td>
                          <input className="editable-cell" style={{ fontWeight: 600 }} placeholder="必填"
                            value={r.phone} onChange={(e) => patchManualRow(r.id, { phone: e.target.value })}
                            onBlur={(e) => patchManualRow(r.id, { phone: normalizeImportedCustomerNumber(e.target.value) })} />
                        </td>
                        <td>
                          <input className="editable-cell" placeholder="填写"
                            value={r.name} onChange={(e) => patchManualRow(r.id, { name: e.target.value })} />
                        </td>
                        <td>
                          <input className="editable-cell" placeholder="填写"
                            value={r.email} onChange={(e) => patchManualRow(r.id, { email: e.target.value })} />
                        </td>
                        <td className="num">
                          <input className="editable-cell" style={{ textAlign: "right" }} inputMode="numeric" placeholder="填写"
                            value={r.amountUsd ?? ""}
                            onChange={(e) => patchManualRow(r.id, { amountUsd: e.target.value ? Number(e.target.value) : null })} />
                        </td>
                        <td>
                          <input className="editable-cell" placeholder="填写"
                            value={r.platform} onChange={(e) => patchManualRow(r.id, { platform: e.target.value })} />
                        </td>
                        <td>
                          <span className="badge" data-tone={meta.tone}>{meta.label}</span>
                          {meta.note ? (
                            <span style={{ marginLeft: 8, fontSize: 12.5, color: "var(--ink-2)" }}>{meta.note}</span>
                          ) : null}
                          <button
                            onClick={() => removeManualRow(r.id)}
                            style={{
                              all: "unset", cursor: "pointer", marginLeft: 8,
                              fontSize: 12.5, fontWeight: 600, color: "var(--bad)",
                            }}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={r.id} data-tone={tone}>
                      <td className="num" style={{ color: "var(--ink-3)" }}>{i + 1}</td>
                      <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{formatCustomerNumber(r.phone)}</td>
                      <td>{r.name}</td>
                      <td style={{ color: "var(--ink-2)" }}>{r.email || <span className="muted">—</span>}</td>
                      <td className="num">{formatUsd(r.amountUsd)}</td>
                      <td>{r.platform || <span className="muted">—</span>}</td>
                      <td>
                        <span className="badge" data-tone={meta.tone}>{meta.label}</span>
                        {meta.note ? (
                          <span style={{ marginLeft: 8, fontSize: 12.5, color: "var(--ink-2)" }}>{meta.note}</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, padding: 16, borderTop: "1px solid var(--line)" }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)" }}>
              将导入 <strong style={{ color: "var(--ink)" }}>{okCount}</strong> 位客户；
              另有 <strong style={{ color: "var(--ink)" }}>{dupCount + lowCount + noWsCount}</strong> 条不建档；如需计入当天统计，请到「每日数据填写」单独填写。
            </p>
            <button className="btn" data-variant="primary" data-size="lg" data-confirm-action="导入客户号码" data-confirm-description="确认后，本批有效号码会写入客户进度通讯录。" disabled={okCount === 0 || !channelId || !ownerId || busy} onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const okRows = rows.filter((r) => r.status === "ok");
                const result = await requestJson<{ imported: number; duplicateCount: number; lowAmountCount: number }>("/api/leads", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    sourceDate: options?.today,
                    channelId,
                    rows: okRows.map((r) => ({
                      phone: r.phone,
                      customerName: r.name || undefined,
                      customerEmail: r.email || undefined,
                      lossAmountCents: r.amountUsd === null ? null : Math.round(r.amountUsd * 100),
                      customerPlatform: r.platform || undefined,
                      attributionOwnerId: ownerId,
                    })),
                  }),
                });
                onToast(`已真实导入 ${result.imported} 位客户${result.duplicateCount ? `；撞粉 ${result.duplicateCount} 条` : ""}${result.lowAmountCount ? `；低金额 ${result.lowAmountCount} 条` : ""}`);
                setLoaded(false);
                setRows([]);
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "导入失败，请稍后重试");
              } finally {
                setBusy(false);
              }
            }}>
              <IconCheck size={17} />
              {busy ? "正在写入…" : `确认导入 ${okCount} 条`}
            </button>
          </div>
        </div>
      ) : null}
      {error ? <div className="card" role="alert" style={{ padding: 14, color: "var(--bad)", borderColor: "var(--bad-line)" }}>{error}</div> : null}
    </div>
  );
}
