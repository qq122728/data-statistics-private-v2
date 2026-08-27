# 安全整改生产验收总闸门

本文只编排已经审核的整改，不代替各任务手册，也不授权直接修改生产。
仓库 CI 通过表示“工具和代码可发布”，只有本页的现场证据全部完成，才能表示
“生产已经修好”。

大白话：图纸和零件合格，不等于服务器已经换好锁。每次只换一把锁，确认能开门，
再进行下一项。

## 总体状态

- 代码和运维实现：均已通过独立 PR 审核并合入 `main`；发布时必须记录实际部署的
  `main` 完整 commit SHA，不能只写分支名。
- 生产执行：尚未授权或声明完成。不得把仓库测试结果复制成生产验收结果。
- 当前生产已知旧状态来自 2026-08-25 只读盘点，包括 3001 旧进程、16 个生产迁移、
  `archive_mode=off` 以及尚未安装的 LOG/NET/账号隔离配置；执行前必须重新盘点，
  不能假定 PID、目录、IP 或数据库状态仍未变化。

## 所有窗口共同门槛

每个窗口必须有独立变更单、负责人、复核人、开始/结束时间、回滚负责人和批准的
发布 SHA。缺一项就停止。

1. 在受限证据库创建本次记录；只保存审批编号、时间、SHA、PASS/FAIL、计数、版本、
   哈希和脱敏截图。
2. 不保存连接串、密码、Cookie、Token、手机号、客户姓名、客户编号、SSH 私钥、
   环境变量全文、进程完整命令行或业务日志正文。
3. 变更前验证现有备份可读、正式服务健康、SSH 紧急通道可用；保持一个独立的
   root/运维会话直到回滚窗口结束。
4. 任何脚本报错、状态与审批记录不一致、身份参数变化或验收失败时立即停止。
   不得通过改确认词、删状态文件、放宽权限或手工 `rm -rf` 绕过保护。
5. 每个窗口结束后恢复临时 override，保存脱敏结果，再开始下一个窗口。数据库权限、
   防火墙、日志、内存和 DR 不得塞进同一次重启。

证据记录使用
[`security-remediation-evidence.template.md`](security-remediation-evidence.template.md)。
原始敏感输出只能留在受控系统；公开 PR 和普通工单只写摘要。

发布流水线在构建新发布目录时，把本发布的完整 SHA 写入 `.release-commit`，设为
`0644`；不能在已上线目录内临时补写一个 SHA 冒充发布证据。进入维护窗口后，先安装
root 管理的只读预检并执行 inventory 模式：

```bash
sudo install -o root -g root -m 0755 \
  ops/scripts/security-production-preflight.py \
  /usr/local/sbin/data-statistics-security-preflight
sudo install -o root -g root -m 0755 \
  ops/scripts/sync-data-statistics-cloudflare-ufw.sh \
  /usr/local/sbin/sync-data-statistics-cloudflare-ufw
sudo /usr/local/sbin/data-statistics-security-preflight \
  --expected-sha FULL_40_CHARACTER_MAIN_SHA --inventory
```

inventory 返回当前布尔门槛，不读取业务行，也不输出 IP、路径、连接串、命令错误详情
或日志正文。它只做 systemd/进程/文件权限检查、Cloudflare 官方网段与 UFW 精确规则审计，
以及本机 peer-authenticated PostgreSQL 元数据查询；审计只使用临时目录，不修改防火墙。
完成所有波次后去掉 `--inventory` 再执行；
任一主机门槛未满足会返回非零。但该工具明确不能替代跨团队权限、真实业务、日志
内容、外部告警、Cloudflare 外验、对象锁或恢复演练证据。

## 推荐执行波次

### 波次 1：发布应用代码（SEC-01、AUTH-02、DEP-01、API-02/LOG-02 应用侧）

发布当前审核 SHA，执行生产构建和既有冒烟测试，重点验证登录、权限、服务端组件、
API、同团队/跨团队手机号重复、临时密码改密门禁和旧会话失效。

必须记录：

- 运行进程加载的 Next.js 版本为 `16.3.3`，Node 满足仓库 engines；旧 3001 进程不算
  本项成功，下一波必须单独处理。
- 甲团队只能得到乙团队手机号“已存在”的通用结果，响应和新增安全日志均无乙团队、
  姓名、客户编号或负责人；同团队仍显示必要详情。
- 未登录、普通用户、管理员三种身份结果符合权限设计。
- 6 位、8 位新密码均被拒绝；合成临时账号只能改密或退出，改密后临时密码和旧会话
  均不可继续使用；登录限流仍有效。
- 登录成功、失败、锁定和权限拒绝只生成结构化内部用户/团队编号与结果，不含测试用
  密码、Token、手机号或姓名标记。

失败时回滚应用发布，不回滚或手改已执行迁移；迁移问题按
[`postgresql-migrations.md`](postgresql-migrations.md) 停止并前向修复。

### 波次 2：停止 3001 旧进程并建立发布清理（OPS-02）

严格按
[`ops-02-orphan-process-and-release-retention.md`](ops-02-orphan-process-and-release-retention.md)
重新检查 PID、启动时间、发布目录、连接、Nginx、cron、systemd 和监控依赖，再用固定
确认词停止。旧进程曾通过命令行携带数据库配置，必须在独立凭据轮换单中完成轮换。

必须记录：3001 不再监听；正式 3000 服务健康；重启主机后 3001 不复活；已验证的
回滚版本可用；发布后流水线调用受保护的 `post-deploy-release-cleanup.sh`；预览和首次
apply 均保护当前、回滚、软链接引用和运行中版本，最终保留 5 至 10 版。

### 波次 3：拆分运行账号（OPS-01）

执行 [`OPS-01-runtime-account-separation.md`](../../ops/runbooks/OPS-01-runtime-account-separation.md)。
`verify-runtime-account.sh` 必须全部 PASS，并另外完成一次真实发布/回滚和 24 小时观察。

必须记录：runtime 为不可登录账号；读取部署私钥/备份、写仓库/当前发布均失败；只有
独立缓存/必要状态目录可写；网站健康；部署账号仍可发布和回滚；备份任务仍由部署/
备份账号执行。失败时使用手册保留的 pre-OPS-01 unit 回滚。

### 波次 4：数据库账号与迁移证据（DB-01、DB-02）

按 [`ops/database/db-01/README.md`](../../ops/database/db-01/README.md) 分 stage/final 两段
执行。现场必须先确认当前 `main` 的 20 个迁移均完成；数量不是 20 就停止查因。

必须记录：

- runtime 真实业务 CRUD 成功，`CREATE/ALTER/TRUNCATE/DROP` 均以权限错误失败；旧账号
  最终 NOLOGIN 且无有效权限；migrator 仍能执行发布迁移。
- stage/final verifier 均 PASS，网站在两阶段后都完成登录、查询、新增、修改、删除
  冒烟；网站 unit 只拿 runtime 连接，migrator 连接只在部署流程注入。
- 使用审核的本机 exporter 生成 root:root `0600` 的生产 migration ledger；实际 20 个
  checksum 和唯一 baseline 换行例外有受限记录；另一名 DBA 独立生成 baseline 批准书。

不得在证据中输出连接串、角色密码或业务行。

### 波次 5：请求体、内存与日志（API-02、LOG-02 运维侧）

先在隔离的生产同规格环境按
[`LOAD-ACCEPTANCE.md`](../../ops/api-request-limits/LOAD-ACCEPTANCE.md) 测量边界、并发、RSS、
延迟和重启；只依据可重复峰值与批准余量填写 `MemoryHigh/MemoryMax`，禁止猜数值。
本机无凭据工具只证明 Nginx 精确上限和 `+1` 的 413；合成账号的正常边界写入及数据库
计数不变必须另行人工验证。

随后按
[`LOG-02-security-logging.md`](../../ops/runbooks/LOG-02-security-logging.md) 安装 Nginx、
PostgreSQL、journald、logrotate、容量/抑制 timer 和独立 HTTPS 告警。

必须记录：逐接口 400/413；正常批量不受影响；同一 MainPID/InvocationID、NRestarts
不变且无 OOM/5xx/timeout；Nginx access JSON 无 query/IP/Referer/用户名/UA；受控敏感
标记在新增日志中零命中；PostgreSQL 慢查询/连接审计不记录 bind 值；轮转、容量告警、
suppressed-message 告警均由外部接收端确认。

### 波次 6：源站收口（NET-02）

执行 [`NET-02-origin-lockdown-and-security-headers.md`](../../ops/runbooks/NET-02-origin-lockdown-and-security-headers.md)。
变更前后各执行一次 Certbot dry-run；外部双栈验证机必须使用真实源站 IPv4/IPv6，且
绕过代理直测 80/443。

必须记录：UFW active、默认拒绝入站、IPv6 开启、只有 Cloudflare 官方网段/仍有效紧急
CIDR 可访问 Web；IPv4/IPv6 源站直连均失败；域名登录/API/静态资源正常；real IP、
HSTS、CSP Report-Only、Permissions-Policy 和 Nginx 版本隐藏生效；同步、dead-man、
紧急过期 timer 及 OnFailure 均有外部告警证明；证书续期不受影响。

CSP 强制和更长 HSTS 属观察后的独立变更，不能为赶进度直接开启。

### 波次 7：异地备份与真实恢复（DR-01）

最后按 [`ops/dr-01/README.md`](../../ops/dr-01/README.md) 上线 pgBackRest、独立对象存储、
连续 WAL、五个 timer、告警和隔离恢复。上线前填写实名 primary/secondary/business owner。

必须分别完成一次全量恢复和一次指定时间 PITR，保存 root 保护的 result JSON 与 SHA。
还要证明数据库主机身份不可删除对象、异地保留/加密/版本或对象锁有效、上传失败/
损坏/恢复失败会告警、外部 dead-man 会在漏心跳时告警。记录实测 RPO/RTO；RPO 超过
5 分钟或 RTO 超过 60 分钟必须有明确例外批准，不能把目标值写成实测值。

现有每日加密逻辑备份至少保留到两次 PITR 演练都成功。

## 关闭条件

只有以下条件全部满足，整改总任务才能关闭：

- 所有生产波次有独立审批、双人复核、回滚结果和受限证据编号。
- 当前生产 SHA 与最终审核 `main` 一致，最终 `main` CI 全绿。
- SEC/AUTH/API/DEP 的真实业务验收通过。
- 3001 在重启后仍关闭，发布清理已接入正式流程。
- runtime/deploy、runtime/migrator 两套钥匙均已真实分离。
- LOG/NET 配置已生效且外部告警实际送达。
- 全量恢复和指定时间恢复均真实成功，RPO/RTO 已测量。
- 证据抽查找不到密码、连接串、Token、Cookie、手机号、客户姓名或客户编号。

若没有生产服务器、数据库、Cloudflare/对象存储、外部监控的授权访问和维护窗口，
正确状态是“仓库完成、生产待执行”，不是“已修复完成”。
