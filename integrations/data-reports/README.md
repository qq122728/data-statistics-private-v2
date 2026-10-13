# 数据机器人：简报与国家分析

2026-10-13 更新，生产已发送 2026-10-12 新加坡、德国真实预览。

## 文件与部署边界

数据机器人独立报表服务位于 `/opt/data-statistics-reports/current`，不是网页服务。
原部署基线为 `20260920-telegram-rich-table`，这套历史服务的全部依赖不在当前网页源码树。
因此此目录保存经过线上只读核验的完整服务适配文件，避免日后被网页同名文件覆盖。

- `boss-report.ts.template` → 服务 `src/lib/boss-report.ts`：在原事务快照内附加分析，保留原业务汇总、历史接粉人归属。
- `automatic-group-daily-report.ts.template` → 服务同名文件：小组简报和国家分析。
- `boss-text-server.ts.template` → 服务 `scripts/reports/boss-text-server.ts`：`results` 保持只包含真实小组；国家分析放在 `analyses`，资源参谋的时间源不受影响。
- `compact-bot-report.ts` → 服务 `src/lib/compact-bot-report.ts`：纯文本及富表格。
- `packages/customer-sheet/bot-insights.ts` → 服务同路径：事件金额、接粉批次、同龄比较的纯计算。
- `group_daily_report.py` → `/var/lib/hermes-boss/.hermes/scripts/group_daily_report.py`：文件锁、发送前持久化、确认后记账；国家分析必须等其小组均确认发送后才发送。结果不确定不自动重发。

模板中的扩展与原服务接口配套，不可直接覆盖当前网页的报表模块。
资源参谋仍使用独立服务、只读数据库账户、原生 Hermes 三个查询/制表工具。

## 统计口径

- 小组汇总继续使用已有 BossReport；新拆分经生产核对，开单、首充和续充金额与原汇总完全一致。
- 新/老粉开单按接粉月份；本期首充只算一次；续充不重复算开单。
- 续充贡献按首次开单月份，不可确定的单列“其他”，不强行归类。
- 平均首充以本期首充人数为分母；续充人均以本期实际续充人数为分母。
- 开单后30天人均续充以全部成熟开单客户为分母，包含未续充者。
- 能力使用最近14日成熟批次，比较前14日同龄批次。回复/进群锚定接粉，炒群锚定进群，注册/专家开单锚定介绍专家，续充锚定首充。
- 接粉、进群等日期的当日为第1天。30天指标必须满30个完整业务日。
- 转化样本每批至少30；续充每批至少10。异常退群率上升、其他能力指标下降相对10%触发严重预警。
- 专家个人按当前负责人展示，来源混合，仅用作问题定位；不直接作能力排名。
- 同国家按同名业务渠道分开展示，保留每组自己的样本，不把渠道混在一起计算排名。

## 验证与生产回退

- 单元用例：`tests/unit/bot-insights.test.ts`，以及资源参谋原有分析、权限、发送去重测试。
- 调度顺序验证：`python3 tests/integration/data-report-delivery.py`，不发外部消息。
- 生产基于真实数据库生成三组快照，核对金额/开单守恒，验证德国两组及新加坡一组的定时依赖；未授权 HTTP 返回401。
- 实际预览通过现有数据分析机器人发到既有群；回执保存在服务器 staging 的 `manual-delivery.json`，不在 Git 中保存业务数据。
- 数据报告当前版本 `/opt/data-statistics-reports/releases/20261013-compact-daily`；回退备份 `/opt/data-statistics-reports/backups/pre-20261013-compact-daily`。恢复旧 current 链接和备份的 Python 脚本后，只重启 `data-statistics-text-query`。
- 资源参谋当前版本 `/opt/data-statistics-resource-bot/releases/20261013-financial-summary`；备份 `/opt/data-statistics-resource-bot/backups/pre-20261013-financial-summary`。恢复版本链接及 INSTRUCTIONS.md 后，只重启该机器人和查询桥。
- 回退不删除发送记录、不重发已确认或不确定的报告，不修改业务数据库。

以后部署必须先核对当前 release，采用新目录和独立回退备份；不要直接覆盖正在运行的文件。
