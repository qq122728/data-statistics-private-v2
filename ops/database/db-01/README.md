# DB-01：生产数据库账号最小权限操作手册

本目录把“改数据库结构的钥匙”和“网站日常读写的钥匙”分开。网站只使用 `data_statistics_runtime`，发布迁移只使用 `data_statistics_migrator`。

## 安全边界

- 所有命令必须在数据库服务器本机由 PostgreSQL 管理员执行，不在命令行传连接串或密码。
- 执行前完成并验证备份；先在隔离恢复环境完整演练一次。
- 不把真实输出中的角色、对象清单贴入公开工单；绝不记录连接串或密码。
- 每一步失败立即停止。没有完成运行账号健康检查，不得执行 `03-finalize-cutover.sql`。

## 0. 只读盘点

以 `postgres` 系统账号连接 `data_statistics`，只执行以下元数据查询：

```sql
SELECT current_database(), current_user;
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole
FROM pg_roles
WHERE rolname IN ('data_statistics', 'data_statistics_runtime', 'data_statistics_migrator');
SELECT granted.rolname AS granted_role, member_role.rolname AS member_role
FROM pg_auth_members m
JOIN pg_roles granted ON granted.oid = m.roleid
JOIN pg_roles member_role ON member_role.oid = m.member
WHERE member_role.rolname IN ('data_statistics', 'data_statistics_runtime', 'data_statistics_migrator')
   OR granted.rolname IN ('data_statistics', 'data_statistics_runtime', 'data_statistics_migrator');
SELECT count(*) AS successful_migrations
FROM public._prisma_migrations
WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
SELECT n.nspname, c.relkind, pg_get_userbyid(c.relowner) AS owner, count(*)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S')
GROUP BY n.nspname, c.relkind, pg_get_userbyid(c.relowner);
```

当前 `main` 的预期迁移数是 39，最新迁移是
`20260830022000_backfill_legacy_account_structure`，角色继承查询预期为空。数量不一致、
存在未解释的角色继承，或当前 owner 不是预期旧账号时，停止并由 DBA
查明原因，不能硬跑脚本。

## 1. 创建角色并安全设置密码

```bash
sudo -u postgres psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname data_statistics --file ops/database/db-01/01-create-roles.sql
sudo -u postgres psql --no-psqlrc --dbname data_statistics
```

在交互式 `psql` 内执行；密码由密码管理器生成并分别保管：

```text
\password data_statistics_runtime
\password data_statistics_migrator
ALTER ROLE data_statistics_runtime LOGIN;
ALTER ROLE data_statistics_migrator LOGIN;
\quit
```

不要使用 `ALTER ROLE ... PASSWORD '明文'`，它容易进入终端历史、审计日志或进程信息。

## 2. 分阶段切换

1. 维护窗口内确认新备份可读。
2. 执行 `02-stage-cutover.sql`：把对象所有权交给迁移账号，给运行账号最小 DML 和序列权限；旧账号暂时保留 DML，网站不中断。
3. 将网站的受保护环境文件中 `DATABASE_URL` 改为运行账号。该文件权限必须是 `600`，且只允许网站运行系统账号读取。
4. 重启网站，检查登录、客户查询、新增、修改和删除等实际业务，再检查错误日志中没有权限拒绝。
5. 部署账号单独注入 `MIGRATION_DATABASE_URL`，执行 `npm run db:migrate:postgres`。网站的 systemd 环境文件不得包含它。
6. 运行本目录验证脚本；全部通过后才执行 `03-finalize-cutover.sql`，关闭旧账号登录并清除旧权限。
7. 再运行一次验证脚本，并重复网站健康检查。

SQL 执行方式：

```bash
sudo -u postgres psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname data_statistics --file ops/database/db-01/02-stage-cutover.sql
sudo -u postgres EXPECTED_MIGRATION_COUNT=39 ops/database/db-01/verify-db-privileges.sh data_statistics --phase stage
sudo -u postgres psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname data_statistics --file ops/database/db-01/03-finalize-cutover.sql
sudo -u postgres EXPECTED_MIGRATION_COUNT=39 ops/database/db-01/verify-db-privileges.sh data_statistics --phase final
```

验证脚本会创建一个随机唯一名的探针表并马上删除，只能在维护窗口运行。它在创建前检查名称冲突，并记录本次对象的 PostgreSQL OID 和 owner；清理前加锁并再次匹配，不会删除同名旧表或后来替换的表。`--phase stage` 验证旧账号过渡期读写，`--phase final` 验证旧账号已不可登录且完全无权。它还验证正常增删改查成功，以及建表、改表、清空表、删表以 SQLSTATE `42501` 被权限系统拒绝；不会读取或输出业务数据。

## 3. 导出受保护的生产迁移证据

完成第 39 个迁移且 `--phase final` 通过后，安装与本次发布完全一致的
导出器和 manifest。安装目标必须由 root 拥有，不得由 `postgres` 或网站账号修改：

```bash
sudo install -D -o root -g root -m 0755 \
  ops/database/db-01/export-production-migration-ledger.py \
  /usr/local/sbin/data-statistics-export-migration-ledger
sudo install -D -o root -g root -m 0644 \
  ops/dr-01/migration-manifest.sha256 \
  /usr/local/share/data-statistics-dr/migration-manifest.sha256
sudo install -d -o root -g root -m 0750 /etc/data-statistics
```

由 DBA 准备一个本次 ledger 审批编号，以及已限制访问的 baseline 换行差异
证据编号。这两个编号不是密码。在数据库服务器本机执行：

```bash
sudo /usr/local/sbin/data-statistics-export-migration-ledger \
  --approval-id replace-with-dba-ledger-approval-id \
  --baseline-evidence-id replace-with-restricted-baseline-evidence-id
```

上面两个 `replace-with-...` 是故意无法通过校验的占位符，必须替换为真实审批编号，
不得原样执行或自己猜一个值。

导出器不接受数据库地址、连接串、用户名或密码；它清空连接环境变量，仅通过
`/var/run/postgresql` 本机 socket，以 `postgres` 系统账号查询固定的
`data_statistics` 数据库。它只在以下条件全部满足时原子写入
`/etc/data-statistics/dr-production-migration-ledger.json`：

- 数据库恰好有 manifest 中的 39 个迁移，全部已完成且未回滚；
- 除 `20260818150000_postgres_baseline` 已知末尾换行差异外，所有 checksum
  与仓库 manifest 精确相同；
- 输出目录由 root 拥有且不可被组/其他用户写入。

文件权限为 `root:root 0600`。默认拒绝覆盖已有 ledger；新发布必须先将旧文件
备份到受限证据库、获得新审批，然后才能显式使用 `--replace-existing`。任何查询、
校验或写入失败都不会留下半个新文件，错误输出也不会复制 `psql` 详情。

这个导出器**不会**创建或修改
`/etc/data-statistics/dr-baseline-checksum-approval.json`。baseline 实际生产 checksum
仍必须由另一名 DBA 从受限证据独立复核和批准，不能让同一个脚本自己证明自己。

## 4. 后续发布

- 网站始终只拿 `.env.production` 中的 `DATABASE_URL`。
- 部署 shell 额外从仅部署账号可读的文件载入 `MIGRATION_DATABASE_URL`。
- `npm run db:migrate:postgres` 会拒绝错误角色、非 PostgreSQL 地址以及两个账号指向不同数据库。
- Prisma 新对象由迁移账号创建，但默认权限不会自动给网站账号。这能防止迁移账本、审计表或运维表被网站意外修改。
- 每个创建或更名业务表的新迁移，都必须在同一个 `migration.sql` 中显式授予业务所需权限。例如：

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."NewBusinessTable"
  TO data_statistics_runtime;
GRANT USAGE, SELECT ON SEQUENCE public."NewBusinessTable_id_seq"
  TO data_statistics_runtime;
```

- 没有自增序列时不写第二条。若某表只需查询或只允许新增，应继续缩小到真正需要的权限，不要照抄全部 CRUD。`public._prisma_migrations` 不得授予网站或旧账号任何访问权。

## 5. 回滚

如果切换运行账号后网站异常，优先把网站连接切回旧账号并重启；在旧账号已被关闭后，才由 DBA 执行：

```bash
sudo -u postgres psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname data_statistics --file ops/database/db-01/04-emergency-rollback.sql
```

这个紧急脚本会临时恢复旧账号的高权限，风险会重新出现。恢复服务后必须记录原因、轮换受影响凭据，并重新完整执行 DB-01。若迁移已经改变数据库结构，不能靠权限回滚代替数据库迁移回滚或备份恢复。
