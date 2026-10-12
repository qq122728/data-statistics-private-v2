# 资源参谋

独立 Telegram 查询机器人。只回应唯一绑定群中的人类成员 @ 提问；允许完整号码、金额与 Excel 发到该群。群成员因此拥有该资源查询范围的读取权限。

## 运行

- 开发：`npx tsx scripts/resource-bot.ts`。默认配置目录 `storage/resource-bot`，被 Git 忽略。不要用演示数据库开启正式群回复。
- 构建独立运行包：`node scripts/build-resource-bot.mjs`，产物位于 `outputs/resource-bot/runtime`。
- 独立生产目录 `/opt/data-statistics-resource-bot/current`，不依赖网站发布目录。安装此目录的锁定依赖 `npm ci --ignore-scripts`，生成或复制**相同 Prisma 版本、相同生产 schema、相同操作系统**的 `.prisma/client`。不要复制 Mac 引擎到 Linux。
- 用本目录 systemd 模板运行。环境文件 `/etc/data-statistics/resource-bot.env` 为 0600，包含专用只读 `DATABASE_URL`、`DEEPSEEK_API_KEY`、可选 `DEEPSEEK_MODEL` 和 `RESOURCE_BOT_DIR`。
- 数据库角色仅可 SELECT：Channel、TeamGroup、CustomerSheetRow、ResourceBuyerPhone、ResourceBuyerSpend、TrafficBuyer、ResourceBuyerMaterial。不得授予用户账号表和写权限。设置默认事务只读及查询超时。
- 配置 `config.json` 含 token、botId、username、name、唯一 chatId/chatTitle、enabled、activatedAt 毫秒、revision UUID、updatedBy。密钥文件和运行目录分别 0600/0700；不可加入 Git 或日志。
- `enabled=false` 暂停；每次变更需更新 revision。启用时 activatedAt 设置当前毫秒数，历史命令不会补发。停用服务可用 `systemctl stop data-statistics-resource-bot`。
- 服务只写自己的配置、偏移量和状态目录。已有网站、旧机器人和业务数据不需要重启或更改。

## 查询与统计

- “本月德国投手效果，按开单成本排序”：按号码导入日期筛选，转化和业务金额为其累计数据；费用按登记日期。
- “FB-M 本月开单号码，导出 Excel”：按实际开单日期筛选，含没有投手归属的业务号码，金额累计。
- “查询 12345678 的首充和续充”：单号码累计详情。号码不发送给语言模型。
- “下一页”“导出 Excel”：只延续同群、同成员、同配置的最近查询，10 分钟有效。
- 模型只输出严格验证的筛选 JSON；无 SQL、数据库工具或写工具；返回数据由固定查询、共享网页统计函数和固定模板生成。业务数据不发给模型。
- 同名渠道不同编号需指定编号末五位。同号跨组且未指定小组不归给投手。缺失国家、投手、费用显示未知；不同币种分开。
- 开单率＝开单/匹配，单粉成本＝消耗/导入，有效粉成本＝消耗/有效，开单成本＝消耗/开单。分母为零不算成本；不同币种不能混排成本。
- 5 条/页，Excel 最多 5000 条；超限要求收窄条件，不偷偷截断。
- 请求上限每人每分钟 5 次、每群每分钟 20 次。偏移量先保存再处理；服务异常时不会自动重发文件，用户可重新查询。

## 验证

`npx vitest run tests/unit/resource-bot.test.ts`（仓库默认测试配置会初始化专用测试库）。测试覆盖跨组重号、日期口径、费用币种、Excel 文本号码、群限制、配置变更、上下文隔离及限频。

Token 绑定 API 在 `/api/resource/bot-settings`，仅总公司管理员可调用。独立服务使用的目录必须与网页 API 的 `RESOURCE_BOT_DIR` 相同才可用网页控制；尚未接入网页时通过服务配置控制，不能把本地配置状态当作线上状态。
