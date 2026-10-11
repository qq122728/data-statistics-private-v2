# 电报老板群号码查询集成

本目录保存 Hermes 老板机器人插件的版本化副本，以及逐号查询说明。正式数据来自主项目的只读接口 `/api/integrations/boss-order-query`，使用独立的 `BOSS_ORDER_QUERY_TOKEN` 鉴权，不接受网页登录态，不修改客户或资金记录。

部署时把 `boss-report` 插件复制到 Hermes 的同名插件目录，把 `customer-order-lookup` 放入业务技能目录，并把 `prompt-addendum.md` 的文字追加到 Hermes 系统提示；一般业务汇总继续使用 `query_business_report`。后台和 Hermes 只注入同一枚独立的 `BOSS_ORDER_QUERY_TOKEN`，不要把旧报表服务的整个环境文件覆盖到主项目。

机器人仅在 Hermes 已配置的授权群和私聊响应。每页逐号明细最多 15 条，渠道细分页最多 12 条；需要更多数据时继续查询下一页。旧数据若仅保存 6 位，只显示真实存在的尾号。
