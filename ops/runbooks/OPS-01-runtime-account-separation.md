# OPS-01 网站运行账号隔离手册

## 目标

保留 `data-statistics` 作为部署和备份账号，新建不可登录的
`data-statistics-runtime` 专门运行网站。网站进程只能读取当前发布，不能读取
部署 SSH 私钥或备份，也不能修改仓库和发布内容。

大白话：网站只拿“营业员钥匙”，`data-statistics` 继续保管“部署钥匙”。

## 已知前提

- 服务器上当前服务名为 `data-statistics.service`。
- 当前发布由 `/opt/data-statistics/app` 软链接指向
  `/opt/data-statistics/releases/`。
- 部署仓库、私钥和备份分别位于 `repository`、`.ssh` 和 `backups`。
- 每日备份任务仍使用 `data-statistics`，不改为网站运行账号。

## 变更前检查

1. 确认有当前数据库备份，但不在工单或终端输出中打印密码或连接串。
2. 确认 `systemctl is-active data-statistics.service` 返回 `active`。
3. 确认 `/opt/data-statistics/app` 指向发布目录内的当前版本。
4. 选择业务低峰窗口；重启通常只需数秒，但仍要预留 15 分钟。
5. 将本分支放到服务器的独立审核目录，不覆盖当前发布。

## 执行

在本分支根目录下，以 root 执行：

```bash
APPLY_OPS_01=YES ./ops/scripts/migrate-runtime-account.sh
```

脚本会先检查路径、当前服务和发布软链接，然后：

1. 创建不可登录的运行账号。
2. 建立独立的状态和缓存目录。
3. 将 Next.js 的 `.next/cache` 单独映射到运行账号专用缓存目录，其余发布内容保持只读。
4. 将部署资产保留给 `data-statistics`。
5. 备份旧 systemd 单元，安装强化后的单元并重启。
6. 运行权限、缓存写入、登录页和受保护业务入口验收。

任何权限或 systemd 变更失败时，脚本会自动恢复全部受影响目录的原属主、
属组、权限以及原 systemd 单元，然后重启旧服务。若脚本新建了不可登录的
运行账号或空的状态/缓存目录，它们会保留但不会接管网站，可在复盘后人工删除。

## 验收

```bash
./ops/scripts/verify-runtime-account.sh
```

必须全部显示 `PASS`：

- systemd 使用 `data-statistics-runtime`。
- 运行账号无法读取部署私钥。
- 运行账号无法修改仓库和当前发布。
- 运行账号无法读取备份。
- 运行账号可通过服务的挂载命名空间写入独立 Next.js 缓存，但发布其余部分仍不可写。
- 部署账号仍能更新仓库和创建发布。
- 网站登录页正常响应；排行榜入口正常响应或按预期跳转登录。

另外人工执行一次完整部署和回滚，记录发布目录、开始时间、结束时间和结果。

## 回滚

迁移脚本完成后会保留：

`/etc/systemd/system/data-statistics.service.pre-ops01`

如果后续观察发现问题，执行：

```bash
install -o root -g root -m 0644 \
  /etc/systemd/system/data-statistics.service.pre-ops01 \
  /etc/systemd/system/data-statistics.service
systemctl daemon-reload
systemctl restart data-statistics.service
systemctl is-active data-statistics.service
```

旧账号和旧单元都不会在变更中删除，因此回滚不依赖重建账号。

## 观察和收尾

1. 连续观察服务和错误日志至少 24 小时。
2. 执行一次每日备份任务，确认它仍由部署/备份账号完成。
3. 完成部署和回滚演练后，再删除 `.pre-ops01` 单元备份。
