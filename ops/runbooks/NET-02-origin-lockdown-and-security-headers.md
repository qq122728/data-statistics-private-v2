# NET-02 源站限制与安全响应头手册

## 安全边界

本手册只供有服务器权限的运维人员使用。仓库脚本默认是 `--check`，不会修改防火墙；生产变更必须走审批和维护窗口。

大白话：Cloudflare 是前门保安，源站 IP 是后门。本方案只让 Cloudflare 进后门，同时保留 SSH、证书续期、自动告警和有时限的紧急通道。

## 上线前硬门槛

1. Cloudflare 的 A 和 AAAA 记录均为橙色云，并记录真实源站 IPv4、IPv6；验证机必须位于服务器外部且具备双栈网络。
2. `sudo ufw status verbose` 必须显示 `Status: active` 和 `Default: deny (incoming)`；`/etc/default/ufw` 必须是普通文件且 `IPV6=yes`。清点并审批 22 端口来源。
3. 保存 `ufw status numbered`、`nginx -T`、`systemctl status certbot.timer` 的脱敏证据。不得记录 Cookie、密码、令牌或私钥。
4. 在变更前先执行 `sudo certbot renew --dry-run`。失败就停止，不能先关源站再研究证书。
5. 安装脚本为 root 所有：同步和紧急脚本放 `/usr/local/sbin/`（0755），告警与健康脚本放 `/usr/local/lib/data-statistics/`（0755）。
6. 即使暂不开放紧急通道，也要先创建空的 `/etc/data-statistics/net02-emergency-cidrs.txt`，root:root 0600；只有审批后的精确公网 CIDR 才能逐行加入，禁止注释和空行。

## Nginx 配置

将 `data-statistics-cloudflare-real-ip.conf` 和 `data-statistics-security-headers.conf` 安装到 `/etc/nginx/snippets/`，均为 root:root 0644：

- 在 Nginx `http {}` 中 include real-IP 片段，确保所有 server 块统一信任 Cloudflare 地址。
- 在 HTTPS 应用 server 块和自定义错误页 server 块 include 安全响应头片段。
- 反代 location 必须保留 `proxy_set_header X-Real-IP $remote_addr;`。同步脚本会通过 `nginx -T` 确认 include 真正加载、此代理头存在，之后才 reload；失败会恢复旧片段。

先执行 `sudo nginx -t`，再检查：

```bash
sudo nginx -T | grep -E 'NET-02 managed|set_real_ip_from|real_ip_header|proxy_set_header X-Real-IP'
```

不要新建一个“同级 location 示例”覆盖现有 location，否则已有代理头可能消失，登录限流会把所有人认成同一个 IP。

## systemd、告警与无声失败监控

1. 将本目录的 service/timer 安装到 `/etc/systemd/system/`。`certbot-net02-onfailure.conf` 安装为 `/etc/systemd/system/certbot.service.d/net02-onfailure.conf`。
2. 从 `net02-monitor.env.example` 创建 `/etc/data-statistics/net02-monitor.env`，填入两个独立 HTTPS 监控地址，设置 root:root 0600。告警地址接收失败；dead-man 地址若超过 36 小时没收到成功心跳，也必须在监控平台告警。
3. 执行 `sudo systemd-analyze verify` 检查所有单位，随后 daemon-reload，手动启动同步、dead-man、紧急过期 service 并查看 journal。
4. 启用 `data-statistics-cloudflare-ufw.timer`、`data-statistics-net02-deadman.timer`、`data-statistics-net02-emergency-expiry.timer` 和现有 `certbot.timer`。

`OnFailure` 负责“明确报错”，last-success + dead-man 负责“任务根本没跑”的无声故障。只看 systemd 日志不够。

## 分阶段收口

```bash
sudo /usr/local/sbin/sync-data-statistics-cloudflare-ufw --check
sudo /usr/local/sbin/sync-data-statistics-cloudflare-ufw --apply
sudo ufw status verbose
sudo nginx -t
```

同步脚本会验证官方 CIDR、变化幅度、旧状态文件、UFW active/default deny/IPv6，先添加新规则和 Nginx 信任列表，再删除旧规则。列表突变会熔断，需人工核对 Cloudflare 公告，禁止用删除状态文件绕过。

从外部双栈验证机先验证域名、受控账号登录/退出和静态资源，然后才一次性收口：

```bash
sudo env CONFIRM_NET02_LOCKDOWN=YES \
  /usr/local/sbin/sync-data-statistics-cloudflare-ufw --apply --activate-lockdown
./ops/scripts/verify-data-statistics-edge.sh <真实域名> <真实源站IPv4> <真实源站IPv6>
```

验证脚本强制 `--noproxy '*'`，分别测试公网 IPv4/IPv6，并直测每个源站地址的 80/443。任意直连成功都算失败。不要把文档保留地址当真实 IP。

收口后再次执行 `sudo certbot renew --dry-run`，确认 A/AAAA、80/443、登录、API、静态资源、响应头、Nginx real IP 和证书全部正常，才结束窗口。ACME 续期失败由 certbot `OnFailure` 告警；另在监控平台配置证书到期天数告警。HTTP-01 必须继续经橙云进入 80 端口，不能为续期永久开放源站。

## CSP 为什么暂不强制

仓库没有经过隐私、安全和容量评审的 CSP 集中报告接收端，因此没有伪造 `/csp-report` 接口。当前必须保留 `Content-Security-Policy-Report-Only`。在浏览器控制台和受控测试中覆盖完整业务周期；只有安全团队部署合规接收端、确认报告采样/脱敏/限流/留存并处理完有效违规后，才可另开变更切换强制 CSP。

HSTS 当前也采用一周 `max-age` 的首轮观察值。连续一个完整业务周期确认 HTTPS、子域和证书续期无误后，才能单独审批提高到至少 180 天；只有全部子域永久支持 HTTPS 才加 `includeSubDomains`，满足长期承诺并完成专项核查前不得加 `preload`。

## 临时维护通道（自动到期）

SSH 是首选。确需绕过 Cloudflare 时，只允许审批过的办公/VPN 公网 CIDR，最长 8 小时：

```bash
# 每行只能是一个精确批准的公网 CIDR；不支持注释、空行或大于 IPv4 /24、IPv6 /64 的网段
sudo install -o root -g root -m 0600 /dev/null /etc/data-statistics/net02-emergency-cidrs.txt
sudoedit /etc/data-statistics/net02-emergency-cidrs.txt
sudo /usr/local/sbin/manage-data-statistics-emergency-web-access --add <办公公网CIDR> 60
sudo systemctl start data-statistics-net02-emergency-expiry.service
# 维护结束立即撤销，不等待定时器
sudo /usr/local/sbin/manage-data-statistics-emergency-web-access --remove <办公公网CIDR>
```

过期 timer 每 5 分钟清理；删除失败会 fail closed 并触发告警。不得直接手敲永久 UFW Web 规则，也不得使用文档示例网段。
同步任务会逐条审计 UFW：每条涉及 80/443 的入站/转发放行都必须带准确的 NET-02 管理注释，并且来源必须精确等于当前 Cloudflare 清单，或精确等于仍未到期且仍在 root:root 0600 审批清单中的紧急 CIDR。审计也会从 root 管理且不可写的 `/etc/ufw/applications.d` 安全展开自定义 application profile 的真实 `ports=`，不能靠给 Web 端口换一个名字绕过。每条 `ALLOW IN/FWD` 的目标必须是严格数字端口表达式，或当前已安装并通过验证的 profile；已删除/未知 profile，以及与 UFW `on INTERFACE` 或 `(v6)` 显示后缀存在多种解释的名称，一律熔断。遇到歧义 profile 规则时，改用明确数字端口规则。未知注释、伪造注释、过期来源、IPv4/IPv6 超宽网段都会熔断。紧急规则添加后必须找到唯一匹配 CIDR、80/443 TCP 和精确注释的 UFW 编号；回滚、手动删除和过期清理只按该编号倒序删除并复核，不会用无注释 tuple 误删同 CIDR 的其他规则。状态写入失败会立即执行该编号回滚并触发告警。

## 失败安全与回滚

- 下载、CIDR、变化熔断、UFW 前置检查、Nginx 测试或 reload 任一步失败：停止收口，查看 `journalctl`，修复原因后重跑；不要手工改受管 state。
- 若同步新增了 Cloudflare 规则但后续失败，它们只会扩大到 Cloudflare 官方范围，不会把公网关死；下次成功同步会收敛。
- 若收口后业务不可用，在保留的 SSH 会话中执行 `sudo ufw allow 'Nginx Full'`，确认外部恢复后创建事故记录。恢复前不要退出最后一个 SSH 会话。
- Nginx 新片段失败会由脚本自动恢复旧版本。人工回滚时恢复变更前备份，必须先 `nginx -t` 再 reload。
- 不删除证书、Certbot 配置、22 端口规则、last-success 或 CIDR state 来“解决”问题。

## 验收记录

记录审批单、操作人、时间、外部验证机网络、A/AAAA、每个源站 80/443 结果、UFW active/default deny/IPv6 与无宽 Web 规则、`nginx -t/-T`、real IP、登录/退出、两次 Certbot dry-run、三个 timer、OnFailure 测试、dead-man 平台超时策略和回滚负责人。敏感信息必须脱敏。
