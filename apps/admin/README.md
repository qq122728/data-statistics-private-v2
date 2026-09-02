# 当前管理前端（3002）

`apps/admin` 是当前组长与组织管理前端，主要包含：

- 组长的客户进度、组员和岗位管理
- 小组数据汇总、日报、排名和预警
- 部门、公司、总公司的组织与账号管理

本地启动整套项目请回仓库根目录执行 `npm run dev`。浏览器访问端口 3002，`/api/*` 代理到端口 3003 的权威后端。

当前业务规则见 [`docs/business/current-business-rules.md`](../../docs/business/current-business-rules.md)。旧的资源部“待确认日报”和“渠道审核”界面不属于现行业务，应按 [`docs/business/api-lifecycle.md`](../../docs/business/api-lifecycle.md) 逐步下线。
