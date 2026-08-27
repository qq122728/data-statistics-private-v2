# PostgreSQL 迁移安全手册

## 不可变规则

`prisma/postgres/migrations` 中已合并、已执行的 `migration.sql` 永远不得修改、删除或改名，空格、注释和末尾空行也算文件内容。要修正数据库结构，必须新建一个时间戳更大的迁移。

`checksums.json` 保存全部 PostgreSQL 迁移的 SHA-256。新建迁移时，将新文件的校验值添加到 manifest，然后执行：

```bash
npm run db:migrate:postgres:verify
MIGRATION_DIFF_BASE=origin/main npm run db:migrate:postgres:check-diff
```

CI 同时将 PR 与可信的基准提交比较：允许添加新迁移，但已存在的迁移即使连同 manifest 一起改了也会失败。

## 已知的基线校验差异

2026-08 生产盘点发现 `20260818150000_postgres_baseline` 的 Prisma 已执行记录与仓库文件校验值不同。人工比对确认唯一差异是末尾换行，没有 SQL 语义或数据库结构差异。当前仓库文件的固定 SHA-256 是 `6ad455cc70177da92a7175d90b4c17711a96d248f3872ca741ed0a5326e097c2`。

这是历史异常记录，不是修改旧迁移或直接改生产 `_prisma_migrations` 的授权。发布前应将生产 `prisma migrate status` 结果保存到受限制的变更记录中，不要在工单或仓库中记录连接串和密码。

当生产恰好完成当前 20 个迁移后，按
`ops/database/db-01/README.md` 的“导出受保护的生产迁移证据”步骤，在数据库
服务器本机运行 root-owned 导出器。它会先验证名称、状态和 checksum，再原子生成
DR-01 使用的 `root:root 0600` ledger；它不接收或输出连接串/密码，也不代替
DBA 建立独立的 baseline checksum 批准。

## 发布和超时

网站运行账号放在 `DATABASE_URL`，迁移专用账号单独放在仅部署账号可读的
`MIGRATION_DATABASE_URL`，然后执行：

```bash
npm run db:migrate:postgres
```

脚本先验证所有校验值，然后默认设置 `lock_timeout=10000ms` 和 `statement_timeout=600000ms`。如经预演确认确有需要，可用 `MIGRATION_LOCK_TIMEOUT_MS` 和 `MIGRATION_STATEMENT_TIMEOUT_MS` 调整，范围为 1 至 3,600,000 毫秒。超时或 Prisma 返回失败时，脚本立即停止，不继续构建和发布。

## 大表变更

新建大表索引前必须评估锁表时间、磁盘空间、写入增量和 PostgreSQL 版本。对仍在接受写入的大表，优先评估 `CREATE INDEX CONCURRENTLY`；该命令不能放在事务块中，而且失败后可能留下 `INVALID` 索引，因此必须在隔离的同版本 PostgreSQL 先预演，并准备检查和删除无效索引的独立修复步骤。

## 失败处理

1. 任何校验、连接、锁等待或 SQL 失败都停止发布，不凭猜测使用 `migrate resolve` 强行标记成功。
2. 保存不含 SQL 参数、密码或连接串的错误记录，检查 `_prisma_migrations` 状态。
3. 事务内失败由 PostgreSQL 回滚；非事务 DDL 或部分成功的变更必须先评估实际状态，再通过新的前向修复迁移处理。
4. 只在已验证的恢复手册要求下执行数据库恢复；不通过改旧 SQL “回滚”。
5. 重试前在隔离环境从空库重放全部迁移，确认失败原因已解决。

如果 Prisma 留下失败记录，DBA 必须先把数据库实际结构、失败迁移日志和
`_prisma_migrations` 状态逐项核对，并留存审批记录。只有确认该迁移已完整回滚、数据库中
没有它的残留结构时，才可执行：

```bash
DATABASE_URL="$MIGRATION_DATABASE_URL" \
  ./node_modules/.bin/prisma migrate resolve --rolled-back <migration_name> \
  --schema prisma/postgres/schema.prisma
```

这里假定 `MIGRATION_DATABASE_URL` 已从 root/部署账号专用的受限环境文件载入；不要把连接串
直接写进命令、工单或报告。

只有确认数据库结构已由受控人工修复完整实现、并与迁移 SQL 完全一致时，才可在双人复核后
使用 `migrate resolve --applied <migration_name>`。两种 resolve 都不能绕过 checksum 校验，
执行后必须再次从备份副本和空库重放、运行 `prisma migrate status`，再恢复发布。若无法证明
实际状态，保持停止并走新迁移或恢复流程。

大白话：旧迁移就像已签字的合同，一个空格也不能改；写错了就加一份新的更正文件。
