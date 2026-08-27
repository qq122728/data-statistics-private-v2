# 数据统计后台

这是一个团队数据录入与来源批次转化报表网页。默认使用 SQLite，适合先在单机上演示和使用。

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
| `resource` | `Resource@56790` | 资源部管理员 | 全部部门的团队表现（只读） |
| `lead` | `Lead@56790` | 组长 | 自己小组的数据和组员管理 |
| `reception` | `Reception@56790` | 接粉 | 自己负责的客户和录入数据 |
| `operator` | `Operator@56790` | 炒群 | 分配给自己的客户和录入数据 |
| `expert` | `Expert@56790` | 专家 | 分配给自己的客户和录入数据 |

首次登录后请立即在管理员中心更换这些初始密码。界面金额统一以美元显示，数据库内部以美分保存。

## 5. 五个主要区域

- 工作台：查看九项总量、五项转化率、发生日趋势、渠道对比、最近录入和数据异常。
- 数据录入：依次填写获粉、回复、拉群与退群、转化与充值。每一类可以单独保存。
- 历史记录：按发生日期、来源日期、渠道和录入人追溯原始记录。
- 转化报表：按小组、成员、渠道和日期查看来源批次的累计或新增量数据。
- 管理员中心：管理成员、小组、渠道、操作日志和系统设置；普通成员看不到这个入口。

## 6. 组员怎样新增共享渠道

进入“数据录入 → 获粉记录”，点击“添加一行”。管理员先选择小组；组员和组长看不到小组选择框，系统会自动使用其所属小组。然后在渠道框输入新名称。

如果同组已经有这个渠道，直接选择原渠道；如果没有，选择“创建渠道：名称”并保存。新渠道会立刻给同组成员使用，也会自动进入工作台和报表。不同小组的同名渠道互不串数据。

管理员可以在“管理员中心 → 系统设置”关闭“允许成员创建组内共享渠道”。关闭后，成员需要联系管理员先创建渠道。

## 7. 管理员怎样重置成员密码

进入“管理员中心 → 成员管理”，找到成员并点击“编辑”，再点击“重置密码”。输入至少 12 位的新临时密码并确认。

系统不会显示旧密码。重置成功后，该成员原来的登录会失效，只能使用新临时密码重新登录，并必须先修改密码才能进入业务页面。请通过安全方式单独把临时密码告诉本人。

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

## 11.1 历史底料渠道一次性回填

旧数据升级后不能只凭渠道名称猜测哪些属于底料。先从管理员渠道列表确认“渠道 ID + 小组 ID”，然后只做预览：

```bash
REBATE_CHANNEL_REFS="渠道ID@小组ID,另一个渠道ID@小组ID" npm run db:backfill:rebate
```

核对预览中的名称和历史批次数量无误后，再明确确认执行：

```bash
REBATE_CHANNEL_REFS="渠道ID@小组ID,另一个渠道ID@小组ID" CONFIRM_BACKUP_TAKEN=YES CONFIRM_REBATE_BACKFILL=YES npm run db:backfill:rebate
```

默认按 30% 返点回填；其他比例可额外设置 `REBATE_RATE_BPS`，例如 `2500` 代表 25%。执行前先备份数据库。

先运行下面这条只读巡检，检查历史批次是否缺少单价、投流凭证或返点比例：

```bash
npm run db:audit:snapshots
```

它不会修改任何数据。旧投流批次若缺“当次产粉数”，系统会明确列为待人工核对，不会用今天剩下的客户数量反推旧账。

## 11.2 生产环境首次账号与默认密码轮换

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

自动发送不再使用一个固定的世界时间。程序每 5 分钟检查一次：每个国家／时区／下班班次，都会在**自己当地的下班后 30 分钟**发送两份简报——国家／小组经营简报和全部专家情况简报。美国东部与西部会分别计算，不会混在一起。

生产服务器可在 `crontab -e` 中加入下面一行（这里只运行简报，不会每 5 分钟重复备份数据库）：

```cron
CRON_TZ=UTC
*/5 * * * * cd /部署目录 && /usr/bin/npm run boss:brief >> /部署目录/logs/boss-brief.log 2>&1
```

大白话：程序会先按每个小组所在地算下班时间，例如德国小组到德国时间 22:30 才发、美国西部小组到美国西部时间 22:30 才发。经营简报只统计当天真实发生的数据和资金；专家简报展示当下每位专家（也包含兼任专家的组长）手上的客户阶段和 48 小时超时提醒。再把不含手机号和客户姓名的经营汇总交给 DeepSeek 写分析。DeepSeek 即使断线，真实数字仍照常发送。
