import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const syncScript = join(root, "ops/scripts/sync-data-statistics-cloudflare-ufw.sh");
const verifyScript = join(root, "ops/scripts/verify-data-statistics-edge.sh");
const emergencyScript = join(root, "ops/scripts/manage-data-statistics-emergency-web-access.sh");
const deadmanScript = join(root, "ops/scripts/check-data-statistics-cloudflare-sync.sh");
const alertScript = join(root, "ops/scripts/send-data-statistics-net02-alert.sh");
const headers = readFileSync(join(root, "ops/nginx/data-statistics-security-headers.conf"), "utf8");
const runbook = readFileSync(join(root, "ops/runbooks/NET-02-origin-lockdown-and-security-headers.md"), "utf8");
const service = readFileSync(join(root, "ops/systemd/data-statistics-cloudflare-ufw.service"), "utf8");
const workflow = readFileSync(join(root, ".github/workflows/verify.yml"), "utf8");
const ubuntuTest = readFileSync(join(root, "tests/integration/net02-ubuntu.sh"), "utf8");

describe("NET-02 origin hardening artifacts", () => {
  it("keeps shell automation syntactically valid", () => {
    execFileSync("bash", ["-n", syncScript]);
    execFileSync("bash", ["-n", verifyScript]);
    execFileSync("bash", ["-n", emergencyScript]);
    execFileSync("bash", ["-n", deadmanScript]);
    execFileSync("bash", ["-n", alertScript]);
  });

  it("defaults to a no-change check and fail-closed list validation", () => {
    const script = readFileSync(syncScript, "utf8");
    expect(script).toContain("MODE=check");
    expect(script).toContain("--activate-lockdown requires --apply");
    expect(script).toContain("refusing unexpected Cloudflare");
    expect(script).toContain("Cloudflare range change exceeds automatic safety threshold");
    expect(script).toContain("UFW default incoming policy must be deny");
    expect(script).toContain("IPV6");
    expect(script).toContain("flock -n");
    expect(script).toContain("NET-02 Cloudflare origin");
    expect(script).toContain("NET-02 emergency expiring");
    expect(script).toContain("unmanaged, expired, or non-approved web allow rule");
    expect(script).toContain("EMERGENCY_APPROVAL_FILE");
    expect(script).toContain("CONFIRM_NET02_LOCKDOWN");
    expect(script).toContain("https://www.cloudflare.com/ips-v4");
    expect(script).toContain("https://www.cloudflare.com/ips-v6");
  });

  it("stages browser security policy and hides version disclosures", () => {
    expect(headers).toContain("server_tokens off;");
    expect(headers).toContain("proxy_hide_header X-Powered-By;");
    expect(headers).toContain("Strict-Transport-Security");
    expect(headers).toContain("Content-Security-Policy-Report-Only");
    expect(headers).toContain("Permissions-Policy");
    expect(headers).not.toMatch(/(^|\n)add_header Content-Security-Policy\s/);
    expect(headers).not.toContain("report-uri");
    expect(runbook).toContain("没有伪造 `/csp-report` 接口");
  });

  it("preserves certificate and emergency recovery paths", () => {
    expect(runbook).toContain("certbot renew --dry-run");
    expect(runbook).toContain("sudo ufw allow 'Nginx Full'");
    expect(runbook).toContain("SSH");
    expect(runbook).toContain("Report-Only");
    expect(runbook).toContain("最长 8 小时");
    expect(runbook).toContain("OnFailure");
    expect(runbook).toContain("dead-man");
    expect(runbook).toContain("root:root 0600");
    expect(runbook).toContain("状态写入失败会立即执行该编号回滚");
  });

  it("runs refresh with a hardened least-write systemd unit", () => {
    expect(service).toContain("--apply");
    expect(service).not.toContain("--activate-lockdown");
    expect(service).toContain("NoNewPrivileges=true");
    expect(service).toContain("ProtectSystem=strict");
    expect(service).toContain("ReadWritePaths=/etc/ufw /run /var/lib/data-statistics");
    expect(service).toContain("ReadWritePaths=/etc/nginx/snippets");
    expect(service).toContain("OnFailure=");
    expect(service).toContain("StateDirectory=data-statistics/net-02");
  });

  it("updates Nginx real-IP trust atomically and checks the external dual stack path", () => {
    const script = readFileSync(syncScript, "utf8");
    const verify = readFileSync(verifyScript, "utf8");
    expect(script).toContain("set_real_ip_from");
    expect(script).toContain("$NGINX_BIN\" -t");
    expect(script).toContain("previous real-IP configuration restored");
    expect(verify).toContain("--noproxy");
    expect(verify).toContain("both origin IPv4 and IPv6 addresses are required");
    expect(verify).toContain("for port in 80 443");
  });

  it("runs Ubuntu behavioral mocks plus native Nginx and systemd validation in CI", () => {
    expect(workflow).toContain("tests/integration/net02-ubuntu.sh");
    expect(workflow).toContain("nginx ufw");
    expect(ubuntuTest).toContain("MOCK_UFW_MODE=inactive");
    expect(ubuntuTest).toContain("MOCK_UFW_MODE=allow");
    expect(ubuntuTest).toContain("nginx -t");
    expect(ubuntuTest).toContain("systemd-analyze verify");
    expect(ubuntuTest).toContain("128.0.0.0/1");
    expect(ubuntuTest).toContain("2001:4860::/32");
    expect(ubuntuTest).toContain("MOCK_RELOAD_FAIL_ONCE=yes");
    expect(ubuntuTest).toContain("MOCK_FAIL_TARGET");
    expect(ubuntuTest).toContain("net02-monitor.env");
    expect(ubuntuTest).toContain("Custom Web");
    expect(ubuntuTest).toContain("Deleted Web Profile");
    expect(ubuntuTest).toContain("Custom Web on eth0");
    expect(ubuntuTest).toContain("Custom Web (v6)");
    expect(ubuntuTest).toContain("preserve-other-rule");
    expect(ubuntuTest).toContain("systemctl start data-statistics-cloudflare-ufw.service");
    expect(ubuntuTest).toContain("--force delete [0-9]");
  });
});
