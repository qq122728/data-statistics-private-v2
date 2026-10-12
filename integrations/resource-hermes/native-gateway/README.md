# 资源参谋：原生 Hermes Gateway

采用与数据分析助手相同的 `/opt/hermes-boss-agent/.venv/bin/hermes gateway run`，独立用户、配置、会话与 Telegram bot。数据分析助手及网站服务均不改动。

## 服务分工

- `hermes-resource`：Hermes 原生电报连接、菜单、对话、会话重置和原生文件发送。
- `data-statistics-resource-bot`：现在仅运行 `bridge.cjs`，监听本机 4187，负责业务只读查询和 Excel；不再轮询 Telegram。
- 旧 `server.py`、`worker.cjs` 保留用于回滚，不在原生模式运行。

工具只有 `describe_resource_scope`、`query_resource_report`、`create_resource_workbook`。查询参数须通过服务校验；数据库启动时验证无写入和提权权限。模型不能指定 SQL、代码、导出内容、任意文件路径或收件人。

`pre_gateway_dispatch` 从真实电报消息保存限时上下文；工具从 Hermes ContextVars 获取用户、聊天、消息和会话 ID，不接受模型传身份。后台再次核对绑定及私聊白名单。报表缓存按原生会话和消息隔离，`/new` 更换原生会话 ID，旧查询条件不会带入。

配置仅启用资源工具集，额外工具会被 `pre_tool_call` 拒绝。私聊和群聊都没有聊天端管理员权限；只开放安全会话指令及业务快捷指令。禁用全局记忆/人格写入；配置、人格、插件在服务内只读挂载。用户操作只读业务，Hermes 自身仍会写对话缓存和会话数据库。

Excel 只由后台从查询结果生成到 `/var/lib/resource-reports`，随机文件名，24 小时后清理。Hermes 只能读取；严格文件发送策略关闭“最近文件自动信任”，不允许读取服务器配置作为附件。

## 菜单

`/new`、`/help`、`/status`、`/stop`、`/effects`、`/sms`、`/orders`、`/next`、`/resource_excel`、`/whoami`。旧 `/export` 作为业务导出的兼容别名由入口转成查询。`/help` 是资源范围帮助；不会把部署、终端或系统管理功能展示为可用功能。

## 上线

先运行单元测试和隔离原生 Agent 检查：真实投流/短信数据、多报表 Excel、原生附件识别、未授权私聊拒绝、群成员查询、会话重置隔离、工具与指令禁止修改。测试不发送电报消息。

构建 `npm run resource-bot:build`，暂存 `bridge.cjs`、本目录配置及服务文件、上级 `INSTRUCTIONS.md` 与 `resource-reports` 插件文件。`deploy.sh <暂存目录> <独立发布名>` 在服务器本地读取原有 token/绑定，备份后停旧轮询、启动只读桥，再启动原生 gateway。失败自动恢复旧版本。上线后核对连接日志、菜单、两个服务状态及原生运行命令。

机器人 token 或绑定在网站修改后，需要重新同步原生服务的受保护环境文件和 allowlist，并重启原生 gateway；业务查询服务每次查询仍会校验最新绑定。不要再次启动旧 Telegram worker，避免两套轮询争抢消息。
