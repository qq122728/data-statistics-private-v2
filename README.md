# 数据统计后台

这是一个按客户号码跟踪接粉、进群、推专家、注册、开单与资金进度，并汇总团队数据的系统。默认使用 SQLite，适合先在单机上演示和使用。

> 当前业务规则只看 [`docs/business/current-business-rules.md`](docs/business/current-business-rules.md)。旧计划和旧测试报告只是历史记录。

## 1. 安装

先安装 Node.js 20.9 或更高版本，然后在项目目录运行：

```bash
npm install
cp .env.example .env
```

`.env` 默认内容是：

```dotenv
DATABASE_URL="file:./dev.db"
```

大白话：这行告诉程序把数据库放在 `prisma/dev.db` 这个文件里。

## 2. 本机建库和演示账号

第一次运行时依次执行：

```bash
npm run db:migrate
npm run db:seed
```

注意：`npm run db:seed` 会清空本机 SQLite 业务数据，只重新建立部门、小组和初始账号，不会生成业绩演示数据。它被代码强制限制为本机 SQLite，不能在 PostgreSQL 或生产数据库执行。已有正式数据时不要运行它。

本机如需清理模拟数据，必须明确确认后运行：`CONFIRM_LOCAL_SIMULATION_CLEAR=YES node scripts/clear-local-simulation-data.mjs`。这也只会操作 `prisma/dev.db`，不会连接线上数据库。

## 3. 一条命令启动

```bash
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。第一次启动前仍需先完成上面的安装和建库步骤。

停止服务：回到正在运行程序的终端，按 `Control + C`。

重新启动：再次运行 `npm run dev`，然后刷新浏览器即可。数据库保存在 `prisma/dev.db`，正常停止和重启不会清空数据。

## 4. 仅本机可用的初始账号

下面账号只用于本机开发、自动化测试或演示。生产环境不会通过种子创建这些账号，也绝不能使用这些密码。

| 账号 | 初始密码 | 角色 | 能看到的范围 |
| --- | --- | --- | --- |
| `admin` | `Admin@56790` | 管理员 | 所有小组，并可进入管理员中心 |
| `resource` | `Resource@56790` | 资源部管理员 | 仅明确授权渠道的数据（只读） |
| `lead` | `Lead@56790` | 组长 | 自己小组的数据和组员管理 |
| `reception` | `Reception@56790` | 接粉 | 自己负责的客户和录入数据 |
| `operator` | `Operator@56790` | 炒群 | 分配给自己的客户和录入数据 |
| `expert` | `Expert@56790` | 专家 | 分配给自己的客户和录入数据 |

首次登录后请立即在管理员中心更换这些初始密码。界面金额统一以美元显示，数据库内部以美分保存。

## 5. 当前主要区域

- 当日数据：组员手填添加、撞粉、低金额、无号码、人工无效和回复。
- 财务数据：组员填写公司最终认账的首充、续充和出金，系统计算净业绩。
- 客户进度：按号码记录接粉、进群、推专家、注册、开单、退群和客户资金跟踪。
- 数据汇总：按公司、部门、小组、渠道、组员和日期查看日报、月报、排名与预警。
- 组织与账号：由相应范围的管理人员维护公司、部门、小组、人员、岗位和设备。

进群、退群、推专家、注册和开单数量不能直接填写，必须由客户号码的阶段和真实发生日期自动生成。

2026 年 9 月开始采用新的号码跟踪周期：进群日期早于 2026-09-01 的真实号码已匿名封存，只保留历史统计底账；9 月 1 日及以后进群的号码继续跟踪。八月汇总不得因清号发生变化；同一真实号码在 9 月发生新阶段时建立新记录。客户进度默认显示全部日期，日期筛选由用户主动选择。

## 6. 渠道怎样维护

渠道由总公司管理员或有对应授权的资源部账号维护。普通组员不能自行新建渠道；缺少渠道时联系管理人员处理。

资源部只能看到账号明确绑定的渠道 ID。员工每日数据保存后直接进入统计，不需要资源部确认；旧版“发送资源部审核”“待确认日报”“确认后入账”流程已经停止使用。

## 7. 管理员怎样重置成员密码

进入“管理员中心 → 成员管理”，找到成员并点击“编辑”，再点击“重置密码”。输入至少 12 位的新临时密码并确认。

系统不会显示旧密码。重置成功后，该成员原来的登录会失效，只能使用新临时密码重新登录，并必须先修改密码才能进入业务页面。请通过安全方式单独把临时密码告诉本人。

登录失败限制保存在数据库：同一账号连续输错 8 次，或同一来源 IP 在 10 分钟内失败 20 次，会锁定 15 分钟。重新启动服务不会清除锁定；如确需人工处理，应先确认不是攻击或多人共用出口造成，再由技术人员检查数据库记录，不能通过反复重启绕过。

## 8. 新入职和离职人员

- 新入职：在成员管理中添加账号，选择角色和所属小组。
- 调组或升为组长：编辑成员，修改角色或所属小组。
- 离职：停用账号，不要删除历史数据。以后需要恢复时可以重新启用。
- 系统会阻止停用最后一个管理员，也不允许管理员直接停用自己。

## 9. 备份 SQLite

先停止网页服务，再复制数据库文件：

```bash
cp prisma/dev.db prisma/dev-backup-2026-08-11.db
```

把备份文件名中的日期改成备份当天即可。恢复时先停止服务，再把选中的备份复制回 `prisma/dev.db`。恢复会覆盖当前数据，动手前建议再备份一次。

### 9.1 升级前检查重复手机号

先停止网页服务，再执行 `npm run db:migrate`。该命令默认使用本机的 `prisma/dev.db`，不会采用终端里普通的 `DATABASE_URL`，并且会先做只读检查，再执行 SQLite 数据库升级。检查不会修改客户资料。

也可以只运行检查：

```bash
npm run db:audit:lead-phone-duplicates
```

这条独立检查命令也默认检查 `prisma/dev.db`，不要求在终端里另外设置 `DATABASE_URL`。如果技术人员确实需要检查另一个已经存在的 SQLite 文件，必须同时明确填写文件地址和确认开关：

```bash
SQLITE_DATABASE_URL="file:/绝对路径/现有数据库.db" CONFIRM_SQLITE_DATABASE_PATH=YES npm run db:audit:lead-phone-duplicates
```

自定义文件不存在时命令会停止，不会按错误路径偷偷创建一个新数据库。SQLite 命令也会拒绝 PostgreSQL 地址；PostgreSQL 结构更新仍使用 `npm run db:migrate:postgres`。

如果看到 `LEAD_PHONE_DUPLICATES_FOUND`，升级会主动停止。大白话：旧数据里有同一个手机号的多份客户档案，系统不知道哪一份才应该保留，所以不会擅自删除或合并。

此时不要直接删除数据库记录，也不要反复强行执行迁移。安全处理顺序是：

1. 停止网页服务，并按上面的步骤完整备份数据库。
2. 根据命令列出的脱敏手机号、客户 ID、批次 ID 和负责人 ID，逐条核对客户姓名、跟进阶段、日期、订单和操作记录。完整手机号不会写进终端错误日志。
3. 由业务负责人明确指定每个手机号最终保留哪一份客户档案。
4. 由技术人员把另一份档案中的非空资料和关联记录迁入保留档案；核对完整后，才删除多余档案。
5. 再运行只读检查；确认通过后，重新执行 `npm run db:migrate`。

不要让脚本自动选择“最新一条”或“最早一条”。两份档案可能属于不同员工和批次，自动选择会造成客户归属或历史业绩丢失。

## 10. 改用 PostgreSQL

网站只使用低权限运行账号的 `DATABASE_URL`。迁移账号单独使用 `MIGRATION_DATABASE_URL`，不得放进网站的 systemd 环境文件。例如：

```dotenv
DATABASE_URL="postgresql://data_statistics_runtime:运行账号密码@数据库地址:5432/data_statistics?schema=public"
MIGRATION_DATABASE_URL="postgresql://data_statistics_migrator:迁移账号密码@数据库地址:5432/data_statistics?schema=public"
```

项目已经把 SQLite 和 PostgreSQL 的结构文件分开：本机 SQLite 是 `prisma/schema.prisma`，生产 PostgreSQL 是 `prisma/postgres/schema.prisma`。不要为了上线去修改 SQLite 那份结构文件，也不要把包含真实密码的 `.env` 提交到 Git。

首次拆分账号必须由 DBA 按 [`ops/database/db-01/README.md`](ops/database/db-01/README.md) 演练、上线和验证。之后生产部署和每次 PostgreSQL 升级都只执行下面这一条：

```bash
npm run deploy:postgres
```

它会固定按“生成 PostgreSQL Prisma Client → 执行 PostgreSQL 迁移 → 生产构建”的顺序运行。大白话：这样网页编译时用的一定是 PostgreSQL 版数据库客户端，不会误拿本机 SQLite 版来上线。

## 11. 验证

```bash
npm run test
npm run test:e2e
npm run build
```

这三条命令分别检查业务逻辑、浏览器里的完整流程和生产构建。

## 11.1 生产环境首次账号与默认密码轮换

生产环境不要运行 `db:seed`。首次管理员账号应通过受控的部署流程创建，并使用独立随机密码。

生产 PostgreSQL 的完整上线命令只能使用 `npm run deploy:postgres`；不要单独运行 `npm run build`，否则可能沿用之前生成的 SQLite Prisma Client。本机的 `npm run db:migrate` 默认只操作 `prisma/dev.db`。只有技术人员同时设置专用 `SQLITE_DATABASE_URL` 和确认开关时，才会改为其他已存在的 SQLite 文件。

如果线上曾使用过旧版初始化账号，请在服务器创建一个权限为 `600` 的 JSON 文件，为这些账号分配一次性临时密码，例如 `/etc/data-statistics/rotate-passwords.json`：

```json
{
  "admin": "至少12位的临时管理员密码",
  "resource": "至少12位的临时资源账号密码"
}
```

先备份数据库，再执行：

```bash
CONFIRM_INITIAL_PASSWORD_ROTATION=YES INITIAL_ACCOUNT_PASSWORD_FILE=/etc/data-statistics/rotate-passwords.json npm run security:rotate-initial-passwords
```

这会更新所列账号的临时密码，设置“下次登录必须修改密码”，并使其全部旧登录失效；不会输出新密码。完成后应安全删除该 JSON 文件。

## 12. 老板群每日备份与 DeepSeek 简报

生产服务器复制 `.env.production.example` 中的相关项目到安全环境变量，再填写：

- `DEEPSEEK_API_KEY`：DeepSeek API Key。只放服务器，不要发到聊天或提交 Git。
- `TELEGRAM_BOT_TOKEN`：在 BotFather 创建机器人的 Token。
- `TELEGRAM_BOSS_CHAT_ID`：唯一接收日报和备份的老板群 ID。
- `BACKUP_ENCRYPTION_PASSWORD`：备份加密密码，必须单独离线保存。
- `DAILY_JOB_SECRET`：至少 32 位随机字符串，用来防止别人调用日报接口。

先做一次不发电报的预演：

```bash
BOSS_REPORT_DRY_RUN=true npm run boss:brief
```

正式手动执行一次“加密备份 + 老板简报”：

```bash
npm run boss:daily
```

小组业务日报不自动推送。组长完成当天数据后，在组长工作台手动生成日报，再选择下载 Excel 或推送到 Telegram。内部定时任务不会发送小组日报，即使服务器残留旧的自动推送环境变量也不会恢复发送。

下面的定时任务只用于加密备份、人员生命周期和地区老板简报，不会自动发送各小组的文字与 Excel 日报：

```cron
CRON_TZ=UTC
*/5 * * * * cd /部署目录 && /usr/bin/npm run boss:brief >> /部署目录/logs/boss-brief.log 2>&1
```

大白话：这个后台任务不会替组长发送小组日报。地区老板简报仍按配置执行：经营简报只统计当天真实发生的数据和资金；专家简报展示当下每位专家（也包含兼任专家的组长）手上的客户阶段和 48 小时超时提醒。再把不含手机号和客户姓名的经营汇总交给 DeepSeek 写分析。DeepSeek 即使断线，真实数字仍照常发送。
