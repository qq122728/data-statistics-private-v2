import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Podium, RoleRankingTable, sortRankingRows, type Row, type Metric } from "../../packages/reporting/LeaderboardRanking";

const row = (id: string, values: Partial<Row> = {}): Row => ({ id, name: id, groupName: "测试组", joined: 0, orders: 0, netCents: 0, ...values });
const podium = (rows: Row[], metric: Metric = "orders") => renderToStaticMarkup(createElement(Podium, { title: "小组榜", note: "说明", rows, metric }));
const table = (rows: Row[]) => renderToStaticMarkup(createElement(RoleRankingTable, { title: "岗位榜", note: "说明", rows, metric: "joined" }));

describe("两端共享的排名展示", () => {
  it.each([[], [row("一组")], [row("一组"), row("二组"), row("三组")]].map(rows => ({ rows })))("空榜或全零榜不产生前三名", ({ rows }) => {
    for (const metric of ["orders", "netCents"] as const) {
      const html = podium(rows, metric);
      expect(html).toContain("暂无可比较数据，暂不排名");
      expect(html).not.toContain("第1名");
    }
  });
  it("正负净业绩合计为零仍有真实可比较成绩", () => {
    const html = podium([row("亏损组", { netCents: -100 }), row("盈利组", { netCents: 100 })], "netCents");
    expect(html).not.toContain("暂不排名");
    expect(html).toContain("$1.00");
    expect(html).toContain("-$1.00");
  });
  it("按所选指标排序，不改输入数组，同分按名字和标识稳定排列", () => {
    const rows = [row("b", { name: "同名", orders: 2, joined: 20 }), row("a", { name: "同名", orders: 2 }), row("c", { name: "同名", orders: 3 })];
    expect(sortRankingRows(rows, "orders").map(r => r.id)).toEqual(["c", "a", "b"]);
    expect(sortRankingRows(rows, "joined").map(r => r.id)).toEqual(["b", "a", "c"]);
    expect(rows.map(r => r.id)).toEqual(["b", "a", "c"]);
  });
  it("少于三组时只展示已有名字，不把缺位伪造成人员", () => {
    const html = podium([row("一组", { orders: 1 })]);
    expect(html).toContain("一组");
    expect(html.match(/暂无数据/g)).toHaveLength(2);
  });
  it("少于三个样本或平均值不大于零时不给红色预警", () => {
    for (const rows of [[row("a", { joined: 0 }), row("b", { joined: 10 })], [row("a"), row("b"), row("c")]]) {
      const html = table(rows);
      expect(html).toContain("样本不足");
      expect(html).not.toContain('data-tone="bad"');
    }
  });
  it("50%和80%的边界使用一致预警规则", () => {
    const html = table([row("红", { joined: 4 }), row("黄", { joined: 5 }), row("正常边界", { joined: 8 }), row("高", { joined: 23 })]);
    expect(html.match(/data-tone="bad"/g)).toHaveLength(1);
    expect(html.match(/data-tone="warn"/g)).toHaveLength(1);
    expect(html.match(/data-tone="ok"/g)).toHaveLength(2);
  });
});
