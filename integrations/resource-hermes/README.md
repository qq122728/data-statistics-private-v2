# 资源参谋 Hermes Agent

真正使用已安装的 Hermes `run_agent.AIAgent`，独立用户、人格和会话。既有 Telegram worker 保留唯一群授权、限频、分页和 Excel 发送；不运行第二个 Telegram gateway。

## 人格与短信

`SOUL.md` 定义务实、用大白话、以实际证据为准的资源分析同事。投流分析投手、国家、渠道、素材和成本；短信分析供应方、国家、渠道、批次和后续转化，不要求素材。当前业务库没有的发送、送达、点击指标不能推算，导入号码不等于发送量。缺少费用或归属时不能给出虚假的成本排名。

`INSTRUCTIONS.md` 定义工具口径、缺失数据处理和群内输出规则。修改人格文件后重启独立 `hermes-resource` 服务即可。

## 部署结构

- Hermes 代码和 Python 环境：`/opt/hermes-boss-agent`，只复用安装，不修改已有机器人的配置或服务。
- 新 OS 用户：`hermes-resource`，HOME `/var/lib/hermes-resource`；HERMES_HOME 是其 `.hermes` 子目录。
- HOME 内安装 SOUL.md、INSTRUCTIONS.md、config.yaml；插件安装在 `plugins/resource-reports`。
- `server.py` 安装到 `/opt/data-statistics-resource-hermes`，服务模板为 `hermes-resource.service`。仅监听本机 4188。
- `/etc/data-statistics/hermes-resource.env` 由 root 保管，0600：`RESOURCE_HERMES_TOKEN`、`DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`。不含 Telegram token 或数据库凭据。
- Telegram worker 增加 EnvironmentFile `/etc/data-statistics/resource-hermes-query.env`，其中 `RESOURCE_HERMES_ENABLED=1` 和相同随机连接密钥。其查询服务仅监听本机 4187。
- 新服务不依赖网站发布目录，也不重启旧 Hermes 服务。worker 的停止超时设为170秒，确保正在处理的回答可结束。

## 数据与工具边界

模型只能使用 `query_resource_report`、`describe_resource_scope` 两个工具，启动时核对实际工具列表。数据库仍为专用只读角色。每次对话获得短期 runId，工具还需连接密钥及有效群配置；不能脱离正在运行的对话查询。

Hermes 接收实际查询的分页结果（包含完整号码与金额）用于回答。Excel 由 Node 中经过校验的查询结果生成，由现有 worker 发送到原绑定群；模型不能指定文件路径或发送目的地。最多8次工具调用、2份文件。正常“下一页/导出 Excel”快捷操作仍走已验证的固定处理。

会话按群、成员、配置版本隔离，保存于私有 resource_sessions 目录；一小时后不再续用，一天后在后续请求中清理。模型没有终端、改数据、配置、记忆写入或跨群发送工具。诊断仅保存异常类型和堆栈位置，不记录密钥和用户数据。

## 回退

停止 resource bot，移除其 Hermes 环境文件 drop-in，恢复先前 worker 发布目录，再启动 resource bot；停止 `hermes-resource`。业务网站和数据库无需回退。
