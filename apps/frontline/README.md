# 当前主前端（3000）

`apps/frontline` 是当前公网主前端，服务以下账号：

- 普通组员与兼任专家
- 资源部
- 财务、人事通知账号
- 部门、公司、总公司管理员

本地启动方法见仓库根目录的 [`README.md`](../../README.md)。这个目录只负责员工入口；`/api/*` 由前端代理到端口 3003 的权威后端。

当前业务规则见 [`docs/business/current-business-rules.md`](../../docs/business/current-business-rules.md)。资源部只看明确授权渠道，不再审核员工日报。
