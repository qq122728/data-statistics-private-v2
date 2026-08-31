import { money, type SummaryColumn } from "@/lib/mock-data";

const LABEL_COL_WIDTH = 140;
const PERSON_COL_WIDTH = 108;

/** 不适用（该角色列压根没有这项指标）渲染成纯"—"；null 就是不适用，跟"这期间刚好是0"
 *  明确区分开——0还是走 render 正常显示数字。 */
function naCell(value: number | null, render: (v: number) => React.ReactNode): React.ReactNode {
  return value === null ? "—" : render(value);
}

const RATE_STYLE: React.CSSProperties = { color: "var(--ink-3)" };

/** 每一行怎么从一列(SummaryColumn)里取数、怎么显示——顺序是锁定的业务口径，
 *  不能改名字也不能调顺序（需求原话逐字对应）。数据汇总、渠道数据核对两个页面
 *  共用这一份行定义，保证两边表格长得一模一样，只是数据源筛不筛渠道的区别。
 *
 *  "添加数据~回复"只有接粉/总计列适用，"进群~当前在群"接粉/炒群/总计列
 *  适用，"推专家/注册/开单"三种角色列全适用（SummaryColumn 里这三个字段本来就
 *  不会是null），"入金/出金/净业绩"接粉/专家/总计列适用——不适用的格子交给
 *  naCell 统一渲染成"—"，不需要每行各写一遍判断。
 *
 *  回复率/拉群率(=进群率)/退群率(=异常退群率)不跟着各自的数字挤在同一格里，
 *  单独成行放在"开单"后面——业务方明确要求数字和比率分开看。注册率/开单率
 *  不做单独行，注册/开单两行就只显示数字。 */
const ROWS: { label: string; render: (c: SummaryColumn) => React.ReactNode }[] = [
  { label: "添加数据", render: (c) => naCell(c.added, (v) => v) },
  { label: "撞粉", render: (c) => naCell(c.collision, (v) => v) },
  { label: "低金额", render: (c) => naCell(c.lowAmount, (v) => v) },
  { label: "无WS号码", render: (c) => naCell(c.noWs, (v) => v) },
  { label: "有效数据", render: (c) => naCell(c.effective, (v) => <strong>{v}</strong>) },
  { label: "回复", render: (c) => naCell(c.replied, (v) => v) },
  { label: "进群", render: (c) => naCell(c.joined, (v) => v) },
  { label: "正常退群", render: (c) => naCell(c.leftNormal, (v) => v) },
  { label: "异常退群", render: (c) => naCell(c.leftAbnormal, (v) => v) },
  { label: "当前在群", render: (c) => naCell(c.inGroup, (v) => v) },
  { label: "推专家", render: (c) => c.pushed },
  { label: "注册", render: (c) => c.registered },
  { label: "开单", render: (c) => c.ordered },
  { label: "回复率", render: (c) => <span style={RATE_STYLE}>{c.repliedRate}</span> },
  { label: "拉群率", render: (c) => <span style={RATE_STYLE}>{c.joinedRate}</span> },
  { label: "退群率", render: (c) => <span style={RATE_STYLE}>{c.leftAbnormalRate}</span> },
  { label: "入金", render: (c) => naCell(c.depositUsd, (v) => money(v)) },
  { label: "出金", render: (c) => naCell(c.withdrawalUsd, (v) => money(v)) },
  {
    label: "净业绩",
    render: (c) => naCell(c.netUsd, (v) => (
      <span className="tnum" style={{ fontWeight: 700, color: v >= 0 ? "var(--ok)" : "var(--bad)" }}>
        {v >= 0 ? "" : "-"}{money(Math.abs(v))}
      </span>
    )),
  },
];

/** 同一条流水线单元（接粉们+炒群自己）用同一个 unitKey，这里按出现顺序给单元编号，
 *  单元之间用底色轮流+左边框做一点轻量的视觉分组，方便一眼看出"这几列是一伙的"。
 *  总计列、结尾的专家块 unitKey 都是null，不参与这个轮流着色。 */
function computeUnitTint(columns: SummaryColumn[]) {
  const order: string[] = [];
  for (const c of columns) {
    if (c.unitKey !== null && !order.includes(c.unitKey)) order.push(c.unitKey);
  }
  return (c: SummaryColumn) => (c.unitKey !== null && order.indexOf(c.unitKey) % 2 === 1 ? "var(--surface-sunken)" : undefined);
}

function isUnitBoundary(columns: SummaryColumn[], i: number): boolean {
  if (i === 0) return false;
  return columns[i].unitKey !== columns[i - 1].unitKey;
}

/** 指标做行、人做列的宽表——第一列（指标名）横向滚动时吸左，"总计"列高亮，
 *  跟组长手头原来那张Excel台账长得一样，方便对着看不用重新适应。headerRight
 *  给需要在卡片头右侧放按钮/徽章的场景用（比如渠道数据核对每日表的"发送资源部审核"）,
 *  不传就跟以前一样只有标题、没有右侧内容。 */
export function SummaryTable({
  title, note, columns, headerRight,
}: {
  title: string;
  note?: string;
  columns: SummaryColumn[];
  headerRight?: React.ReactNode;
}) {
  const unitTint = computeUnitTint(columns);

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div>
          <h2 className="card-title">{title}</h2>
          {note ? <p className="card-note">{note}</p> : null}
        </div>
        {headerRight}
      </div>
      <div className="table-scroll" style={{ maxHeight: "none" }}>
        <table className="grid-table">
          <thead>
            <tr>
              <th style={{ width: LABEL_COL_WIDTH, position: "sticky", left: 0, zIndex: 4 }}>指标</th>
              {columns.map((c, i) => (
                <th
                  key={c.memberId ?? "total"}
                  style={{
                    width: PERSON_COL_WIDTH,
                    background: c.memberId === null ? "var(--surface-sunken)" : unitTint(c),
                    borderLeft: isUnitBoundary(columns, i) ? "1px solid var(--line-strong)" : undefined,
                  }}
                >
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label}>
                <td
                  style={{
                    fontWeight: 600, color: "var(--ink-2)", whiteSpace: "nowrap",
                    position: "sticky", left: 0, zIndex: 2, background: "var(--surface)",
                  }}
                >
                  {row.label}
                </td>
                {columns.map((c, i) => (
                  <td
                    key={(c.memberId ?? "total") + row.label}
                    className="tnum"
                    style={{
                      textAlign: "center",
                      background: c.memberId === null ? "var(--surface-sunken)" : unitTint(c),
                      fontWeight: c.memberId === null ? 600 : 400,
                      borderLeft: isUnitBoundary(columns, i) ? "1px solid var(--line-strong)" : undefined,
                    }}
                  >
                    {row.render(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
