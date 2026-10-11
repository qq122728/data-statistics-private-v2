---
name: customer-order-lookup
description: Use when the boss asks in Telegram about a customer number, intake or order date, individual opened orders, or a channel's order breakdown.
---

# 号码与渠道查询

真实号码和日期只用 `query_customer_orders` 查询，禁止根据汇总数或聊天记忆推断。工具只读，已经限定在获授权的老板群和私聊；不要把查询结果转发到其他聊天。

- 问「某号码什么时候接粉、什么时候开单、来自哪个渠道」：`view=phone, phone=完整号码或至少 6 位尾号`。同尾号有多条时先报小组和渠道，让老板缩小范围。
- 问「本月/上月/某天某组开单的每个号码」：`view=orders, group=...`，按开单日期筛选。指定月份用 `period=custom, from=YYYY-MM-01, to=YYYY-MM-月末`，不要把旧粉的接粉日期误当开单日期。
- 问「FB-M 的开单号码」：在上述查询加 `channel=FB-M`。问整个 FB 渠道族，用 `channel=FB`，会包含 FB-M、FB-Q 等子渠道。
- 问「渠道细分」：`view=channels`，按具体渠道、小组和接粉月份展示开单量与首充；追问名单时再用 `view=orders` 和同样条件。
- 结果有多页时，按 `page=2,3...` 继续取；不要声称第一页就是全部号码。
- 数据库只保存 6 位的号码要称为「尾号」，不能补出不存在的前几位。号码跟踪记录用真实接粉日期与首充/开单日期，旧业务账用来源批次接粉日期与订单开单日期。
- 若老板问「渠道粉量、回复率、进群率、净业绩」等汇总指标，仍用 `query_business_report`；逐号结果与汇总口径不同，不要把旧粉在本月开单说成本月新粉转化。

回答用简短中文，逐号列出「号码｜小组｜渠道｜接粉日期 → 开单日期｜首充」。查询不到时明确说没有找到，不能猜。
