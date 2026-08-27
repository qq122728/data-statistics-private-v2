import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const unit = readFileSync("ops/systemd/data-statistics.service", "utf8");
const migration = readFileSync("ops/scripts/migrate-runtime-account.sh", "utf8");
const verification = readFileSync("ops/scripts/verify-runtime-account.sh", "utf8");
const runbook = readFileSync("ops/runbooks/OPS-01-runtime-account-separation.md", "utf8");

describe("OPS-01 runtime account isolation", () => {
  it("runs the website under a dedicated non-deployment identity", () => {
    expect(unit).toContain("User=data-statistics-runtime");
    expect(unit).toContain("Group=data-statistics-runtime");
    expect(unit).toContain("ExecStart=/usr/local/bin/node ");
    expect(unit).not.toContain("ExecStart=/usr/local/bin/npm");
    expect(migration).toContain("--shell /usr/sbin/nologin");
    expect(migration).toContain("runtime account must not be a member of the deployment group");
  });

  it("keeps the application read-only and hides deployment assets", () => {
    expect(unit).toContain("ProtectSystem=strict");
    expect(unit).toContain("ReadOnlyPaths=/opt/data-statistics");
    expect(unit).not.toContain("ReadWritePaths=/opt/data-statistics");
    expect(unit).toContain("InaccessiblePaths=/opt/data-statistics/.ssh /opt/data-statistics/repository /opt/data-statistics/backups /opt/data-statistics/deploy-backups");
    expect(unit).toContain("ReadWritePaths=/var/lib/data-statistics-runtime /var/cache/data-statistics-runtime");
    expect(unit).toContain("CacheDirectory=data-statistics-runtime");
    expect(unit).toContain("BindPaths=/var/cache/data-statistics-runtime:/opt/data-statistics/app/.next/cache");
    expect(unit).toContain("NoNewPrivileges=true");
    expect(unit).toContain("CapabilityBoundingSet=\n");
  });

  it("verifies every required denial plus website and deployment continuity", () => {
    expect(verification).toContain('runuser -u "$runtime_user" -- test -r "$deploy_key"');
    expect(verification).toContain('runuser -u "$runtime_user" -- test -w "$repository_path"');
    expect(verification).toContain('runuser -u "$runtime_user" -- test -w "$application_link"');
    expect(verification).toContain('runuser -u "$runtime_user" -- test -r "$backup_path"');
    expect(verification).toContain('nsenter --mount="/proc/${main_pid}/ns/mnt"');
    expect(verification).toContain("http://127.0.0.1:3000/performance-leaderboard");
    expect(verification).toContain('runuser -u "$deploy_user" -- test -w "${application_root}/releases"');
    expect(verification).toContain("http://127.0.0.1:3000/login");
    expect(runbook).toContain("## 回滚");
    expect(runbook).toContain("24 小时");
  });

  it("restores every changed permission if migration fails", () => {
    expect(migration).toContain('permission_snapshots+=("${permission_target}|$(stat -c');
    expect(migration).toContain('chown "${permission_uid}:${permission_gid}" "$permission_path"');
    expect(migration).toContain("trap rollback EXIT");
    expect(migration).toContain("if [[ $exit_code -ne 0 && $rollback_needed -eq 1 ]]");
    expect(migration).toContain('for runtime_path in "/var/lib/${runtime_user}" "/var/cache/${runtime_user}"');
    expect(migration.indexOf("rollback_needed=1")).toBeLessThan(
      migration.indexOf('install -d -o "$runtime_user"'),
    );
  });
});
