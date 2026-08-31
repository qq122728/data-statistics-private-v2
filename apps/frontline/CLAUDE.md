@AGENTS.md

# 设计约定

这些是产品经理明确要求的、贯穿全站的规则。新加页面/组件时要遵守，不用每次都问。

## 表格

- **表头文字一律居中**（`app/globals.css` 的 `.grid-table thead th`），不管这一列的内容是左对齐的文字还是右对齐的数字（`.num`）。所有表格共用 `.grid-table` 这一个 class，改一处即可全站生效——新表格只要用这个 class 就自动满足，不用逐个加 `textAlign: "center"`。
- 表格必须设置 `table-layout: fixed`（已经是 `.grid-table` 的默认值），配合这一点：给每一列 `<th>` 用**显式 `width`**，不要用 `minWidth`——`minWidth` 在 `table-layout: fixed` 下不生效，会导致列宽分配错乱（某些列被挤得很窄、某些列过宽）。
- `.grid-table td` 用 `vertical-align: top`（`th` 保持 `middle`），避免同一行里不同列内容高度不一致时基线对不齐。
- 长文本字段（比如客户备注）要能自动换行，不要用 `white-space: nowrap` + 省略号截断把内容藏起来；参考 `components/TabFollowUp.tsx` 里 `Cell` 组件的 `wrap` 参数。

## 数据可视化（对比类表格、漏斗、看板）

- **数字/百分比要跟表头文字居中对齐**，不要用 `.num` 默认的右对齐——右对齐是给操作类表格里单纯的计数列用的（比如客户列表里的"回访次数"），但凡是给人拿来**对比、分析**的数据（渠道对比、漏斗转化率、排行榜这类），每一列都应该是"表头在上、数字在下"视觉对齐成一条竖线，扫一眼就能比出高低，不要错位。给这类 `<td>` 显式加 `textAlign: "center"`，不要依赖 `.num`。参考 `components/MyPerformance.tsx` 的"分渠道"表格。
