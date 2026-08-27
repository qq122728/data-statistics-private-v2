# OPS-02：孤儿进程停止与发布目录保留手册

## 目的和边界

本手册处理两件事：安全停止 TCP 3001 上不受管理的旧 Next.js 进程；把发布目录控制在最近 5 至 10 版。脚本默认只检查和预览，只有输入固定确认词才会停止进程或删除目录。

不要把数据库备份、日志、仓库或当前发布目录交给清理脚本。清理范围固定为 `/opt/data-statistics/releases` 的直接子目录。

## 2026-08-25 生产只读核查记录

- 正式服务 `data-statistics.service` 正常运行 Next.js 16.3.2，监听 `127.0.0.1:3000`，工作目录由 `/opt/data-statistics/app` 指向 `/opt/data-statistics/releases/20260824T231144Z-auth-8a47af0`。
- TCP 3001 由 PID 103160 的 Next.js 15.5.23 监听，工作目录为旧发布 `20260819-customer-situation-layout`，PPID 为 1。
- 该进程位于 `session-798.scope`；systemd 将该登录会话标记为 `abandoned`。启动时间为 2026-08-19 10:51 UTC，来源是一次人工 3001 冒烟启动，不是正式服务。
- 检查时 TCP 3001 没有已建立连接。Nginx 生效配置只代理 `127.0.0.1:3000`，未引用 3001。
- `data-statistics` 没有用户 crontab，也没有可用的用户 systemd 管理器；系统服务、定时器、cron 和 Nginx 配置中未找到依赖 3001 的启动或健康检查。
- `/opt/data-statistics/releases` 有 40 个实际目录，共约 56 GiB；另有一个历史软链接。当前发布由 `/opt/data-statistics/app` 保护。
- 启动记录曾把敏感数据库配置以内联环境变量传给进程。本文不记录其值；执行 OPS-02 后应按凭据管理流程轮换该数据库密码，并确保以后只通过受限的 `EnvironmentFile` 传入，不能写进命令行或工单。

一次检查只能证明检查时没有流量。正式停止前，负责人仍须结合监控窗口再次确认；若出现连接或配置引用，停止脚本会拒绝执行。

## 审批前只读检查

从已经审核并部署到运维工具目录的仓库版本执行：

```bash
sudo bash scripts/ops/inspect-runtime-processes.sh 3001
sudo bash scripts/ops/stop-orphan-next.sh \
  --expected-pid APPROVED_PID \
  --expected-release APPROVED_RELEASE \
  --expected-starttime APPROVED_STARTTIME_TICKS
```

第二条不带确认词时只验证，不会发信号。负责人要保存输出，并确认：

1. 3001 只有一个监听者，用户为 `data-statistics`。
2. 工作目录是旧发布，不是 `/opt/data-statistics/app` 当前目标。
3. 进程身份参数与检查输出完全一致，且 cgroup 是唯一的 `session-*.scope`，其 systemd `SubState` 为 `abandoned`；任何 `.service` 或其他 `.scope` 都会被拒绝。
4. 3001 没有连接，Nginx 不引用 3001。
5. 检查输出中的 systemd、系统 cron、用户 crontab 和 lingering 结果没有启动入口；业务负责人确认监控、健康检查和临时任务均不需要 3001。

## 经审批后停止旧进程

```bash
sudo bash scripts/ops/stop-orphan-next.sh \
  --expected-pid APPROVED_PID \
  --expected-release APPROVED_RELEASE \
  --expected-starttime APPROVED_STARTTIME_TICKS \
  --confirm OPS-02-STOP-3001
```

脚本会在发送信号前重新核对 PID、Linux 进程启动时间、工作目录、命令、监听端口、cgroup 和 abandoned session，防止 PID 被复用后误杀。它只发送 `SIGTERM`，最多等 30 秒，不会自动发送 `SIGKILL`。进程退出后，只有同一 abandoned session 仍然存在，且成功读取 `cgroup.procs` 明确证明已经没有任何进程时，才会调用 `loginctl terminate-session` 清理遗留登录记录。文件缺失、不可读、读取失败或仍有进程时都会拒绝清理会话，避免影响其他命令。

随后验证：

```bash
sudo ss -lntp 'sport = :3001'
sudo systemctl is-active data-statistics.service
curl --fail --silent --show-error http://127.0.0.1:3000/login >/dev/null
```

在计划维护窗口重启服务器，再次执行以上三项，确认 3001 不会复活。重启是验收动作，不由本分支自动执行。

如果停止后才确认 3001 有真实依赖，不要用 `nohup` 恢复孤儿进程。先暂停发布，由开发和运维补充一个经过审核的专用 systemd 单元及明确健康检查，再恢复依赖。

## 发布目录预览和清理

先指定一个已经验证过的回滚版本，再预览。示例中的版本名必须替换为当次确认的版本：

```bash
sudo bash scripts/ops/prune-releases.sh --keep 8 --rollback-release VERIFIED_ROLLBACK_RELEASE
```

脚本始终保护：

- `/opt/data-statistics/app` 指向的当前发布；
- `--rollback-release` 明确指定的回滚发布；
- `/opt/data-statistics` 下其他软链接引用的发布（即使软链接指向发布内的子目录）；
- 仍被运行中进程用作工作目录的发布（即使进程位于发布内的子目录）；
- 按修改时间排序的最近 5 至 10 个发布。

两人复核预览清单后才执行。脚本使用固定锁 `/run/lock/data-statistics-release.lock`；所有部署和回滚必须通过下文的同一把锁执行。脚本还会记录每个候选目录的设备号和 inode，并在删除前重复检查当前软链接、回滚版本、其他软链接、运行中进程和目录身份；任一状态改变就立即停止：

```bash
sudo bash scripts/ops/prune-releases.sh \
  --keep 8 \
  --rollback-release VERIFIED_ROLLBACK_RELEASE \
  --apply \
  --confirm OPS-02-PRUNE-RELEASES
```

删除不可直接撤销。执行前保存预览输出和 Git 提交号；误删只能从相同提交重新构建发布目录，不应从当前目录复制 `node_modules` 冒充旧版本。

## 回滚验证

清理前必须验证指定回滚发布可以启动。真正回滚时，以原子方式更新 `app` 软链接，然后仅重启正式服务：

```bash
sudo bash scripts/ops/with-release-lock.sh bash -c '\
  ln -sfn /opt/data-statistics/releases/VERIFIED_ROLLBACK_RELEASE /opt/data-statistics/app.next && \
  mv -Tf /opt/data-statistics/app.next /opt/data-statistics/app && \
  systemctl restart data-statistics.service'
sudo systemctl is-active data-statistics.service
curl --fail --silent --show-error http://127.0.0.1:3000/login >/dev/null
```

回滚版本若包含不兼容数据库迁移，不能只切软链接；应按对应发布的数据库回滚或前向修复方案处理。

## 每次发布后的自动清理

先连续观察数次人工执行。确认清单稳定后，部署流水线应在新版本健康检查通过且回滚版本确定之后调用同一脚本。创建发布目录、切换 `app` 软链接和重启服务的整个部署命令必须由 `scripts/ops/with-release-lock.sh` 包裹；不能只锁其中一步。清理脚本会自行获取同一把锁，因此不要再从包装脚本内调用它。流水线必须传入 `--rollback-release`，不得用模糊匹配或自行拼接 `rm -rf`。任何锁冲突或校验失败都应中止清理，但不能影响当前正式服务。

仓库提供固定的发布后入口，部署流水线不得直接调用破坏性清理命令。先在
流水线中预览；人工观察期结束并完成双人审批后，再启用带确认词的调用：

先把 `prune-releases.sh` 安装为 root:root `0755` 的
`/usr/local/sbin/prune-data-statistics-releases`。生产 apply 模式只会执行这个
固定路径，并会拒绝属主或权限不符的文件；不能用环境变量换成部署账号可写脚本。

```bash
sudo bash scripts/ops/post-deploy-release-cleanup.sh \
  --keep 8 --rollback-release VERIFIED_ROLLBACK_RELEASE

sudo bash scripts/ops/post-deploy-release-cleanup.sh \
  --keep 8 --rollback-release VERIFIED_ROLLBACK_RELEASE \
  --apply --confirm OPS-02-POST-DEPLOY
```

入口会在清理前强制确认正式 service 为 active、MainPID 确实从当前发布运行、
登录页健康、3001 已关闭，并再次要求一个不同于当前版本的有效回滚目录。
任何一项失败都不会删除目录。生产部署系统位于仓库之外，因此必须在变更记录中
保存它调用这个固定入口的配置截图或脱敏日志；只把脚本合入仓库不等于已经接线。

锁只能约束遵守流程的命令。取得 root 权限后绕过包装脚本直接改目录，仍可能制造竞态，因此运维权限和发布流程必须同时受控。

`with-release-lock.sh` 不会自行提权，但会执行传入的命令；不得把它作为“任意参数均可”的 sudoers 白名单。受限部署账号应只获准执行经过审核的固定部署入口，由该入口在内部调用包装脚本。
