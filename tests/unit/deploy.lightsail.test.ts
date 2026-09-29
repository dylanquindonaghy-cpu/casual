import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// deploy/lightsail.sh and deploy/cloud-init.sh (Phase 8): they create real servers in AWS, so
// they're never run by the tests (nor tonight: Dylan runs them with his own account). This pins
// what matters: London only, only 80 and 443 open to the internet, the database not public and
// backed up, the 4 GB and Postgres 16 choices, and no secret in either file.

const ROOT = process.cwd();
const script = readFileSync(join(ROOT, "deploy/lightsail.sh"), "utf8");
const cloudInit = readFileSync(join(ROOT, "deploy/cloud-init.sh"), "utf8");
const code = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

describe("deploy/lightsail.sh", () => {
  it("is valid bash, and stops at the first error", () => {
    execFileSync("bash", ["-n", "deploy/lightsail.sh"], { cwd: ROOT });
    expect(script).toMatch(/^#!\/usr\/bin\/env bash\n/);
    expect(script).toContain("set -euo pipefail");
  });

  it("every AWS call is pinned to London (eu-west-2)", () => {
    expect(script).toMatch(/^REGION="eu-west-2"$/m);
    expect(script).toMatch(/^ZONE="eu-west-2a"$/m);
    expect(script).toContain('aws_ls() { aws lightsail --region "$REGION" "$@"; }');
    // Any aws call not through aws_ls names the region itself.
    const direct = code(script)
      .split("\n")
      .filter(
        (line) => /(^|[\s(])aws [a-z]/.test(line) && !line.includes("aws lightsail --region"),
      );
    expect(direct.length).toBeGreaterThan(0);
    for (const line of direct) {
      if (/command -v aws/.test(line)) continue;
      expect(line, line).toMatch(/--region (\$REGION|"\$REGION")/);
    }
  });

  it("the firewall: 80 and 443 to everyone, SSH only from Lightsail's browser console, nothing else", () => {
    const ports =
      /put-instance-public-ports --instance-name "\$INSTANCE" --port-infos '(\[[\s\S]*?\])'/.exec(
        script,
      )?.[1];
    const rules = JSON.parse(ports ?? "[]") as {
      fromPort: number;
      toPort: number;
      protocol: string;
      cidrs?: string[];
      ipv6Cidrs?: string[];
      cidrListAliases?: string[];
    }[];
    const open = rules.filter(
      (r) => r.cidrs?.includes("0.0.0.0/0") || r.ipv6Cidrs?.includes("::/0"),
    );
    expect(open.map((r) => [r.fromPort, r.toPort, r.protocol])).toEqual([
      [80, 80, "tcp"],
      [443, 443, "tcp"],
    ]);
    expect(rules.filter((r) => !open.includes(r))).toEqual([
      { fromPort: 22, toPort: 22, protocol: "tcp", cidrListAliases: ["lightsail-connect"] },
    ]);
  });

  it("the server: Ubuntu 24.04, the cheapest 2-CPU 4 GB plan (looked up), with the first-boot script", () => {
    expect(script).toContain("starts_with(blueprintId, 'ubuntu_24_04')");
    expect(script).toContain(
      "sort_by(bundles[?isActive && ramSizeInGb==\\`4\\` && cpuCount==\\`2\\`",
    );
    expect(script).toContain("&price)[0]");
    expect(script).toContain('--user-data "file://$HERE/cloud-init.sh"');
  });

  it("shows the monthly prices and creates nothing without a typed yes", () => {
    const prompt = script.indexOf('read -r -p "Create these in London');
    expect(prompt).toBeGreaterThan(0);
    expect(script).toContain('[[ "$answer" == "yes" ]] || fail "nothing was created."');
    expect(script).toContain("$BUNDLE_PRICE a month");
    expect(script).toContain("$DB_PRICE a month");
    // Every create comes after the question.
    for (const create of ["create-instances", "allocate-static-ip", "create-relational-database"]) {
      expect(script.indexOf(create), create).toBeGreaterThan(prompt);
    }
  });

  it("the firewall is set as soon as the server runs (before anything else), then read back", () => {
    const running = script.indexOf('[[ "$state" == "running" ]] || fail');
    const firewall = script.indexOf("put-instance-public-ports");
    expect(firewall).toBeGreaterThan(running);
    expect(firewall).toBeLessThan(script.indexOf("allocate-static-ip"));
    expect(script).toContain("get-instance-port-states");
    expect(script).toMatch(/\|\| fail "ports other than 80 and 443 are open to the internet/);
  });

  it("the database: Postgres 16, not public, backed up each night, a password AWS makes", () => {
    expect(script).toContain("engine=='postgres' && starts_with(engineVersion, '16.')");
    expect(script).toContain("--no-publicly-accessible");
    expect(script).not.toMatch(/--publicly-accessible\b/);
    expect(script).toContain(
      "--enable-backup-retention --no-publicly-accessible --apply-immediately",
    );
    // Read back: private and backed up, or it stops.
    expect(script).toContain(
      '--query "relationalDatabase.[publiclyAccessible, backupRetentionEnabled]"',
    );
    expect(script).toContain(`[[ "$settings" == $'False\\tTrue' ]] \\`);
    expect(script).toContain("--preferred-backup-window 01:00-01:30");
    // Upkeep on a weekday, away from event nights.
    expect(script).toContain("--preferred-maintenance-window Tue:02:00-Tue:02:30");
    expect(script).toContain("--master-username shiftdesk_owner");
    expect(script).not.toMatch(/--master-user-password/);
    // The command it prints shows the password alone (not the date beside it).
    expect(script).toContain("get-relational-database-master-user-password --region $REGION");
    expect(script).toContain(
      "--relational-database-name $DATABASE --query masterUserPassword --output text",
    );
  });

  it("a static IP, attached to the server", () => {
    expect(script).toContain('allocate-static-ip --static-ip-name "$STATIC_IP"');
    expect(script).toContain(
      'attach-static-ip --static-ip-name "$STATIC_IP" --instance-name "$INSTANCE"',
    );
  });
});

describe("deploy/cloud-init.sh", () => {
  it("is plain POSIX sh (Lightsail runs it under dash, which has no pipefail on Ubuntu 24.04)", () => {
    execFileSync("sh", ["-n", "deploy/cloud-init.sh"], { cwd: ROOT });
    expect(cloudInit).toMatch(/^#!\/bin\/sh\n/);
    expect(code(cloudInit)).toMatch(/^set -eu$/m);
    expect(code(cloudInit)).not.toMatch(/pipefail|\[\[|\bfunction\b/);
    // No pipes, so nothing can fail unnoticed inside one.
    expect(code(cloudInit)).not.toMatch(/[^|]\|[^|]/);
  });

  it("keeps the server patched, and waits for apt's lock instead of failing on first boot", () => {
    expect(cloudInit).toContain('APT::Periodic::Unattended-Upgrade "1";');
    expect(cloudInit).toContain('Unattended-Upgrade::Automatic-Reboot-Time "02:30";');
    expect(cloudInit).toContain('APT="apt-get -y -o DPkg::Lock::Timeout=600"');
    expect(code(cloudInit)).not.toMatch(/^apt-get /m);
  });

  it("Docker from Docker's own repository; the app's folder root-only", () => {
    expect(cloudInit).toContain("https://download.docker.com/linux/ubuntu");
    expect(cloudInit).toContain("docker-compose-plugin");
    expect(cloudInit).toContain("install -d -m 0700 -o root -g root /opt/shiftdesk");
  });
});

describe("no secret in either file", () => {
  it.each([
    ["deploy/lightsail.sh", script],
    ["deploy/cloud-init.sh", cloudInit],
  ])("%s", (_name, text) => {
    expect(text).not.toMatch(/AKIA[0-9A-Z]{16}/); // an AWS access key
    expect(text).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    expect(text).not.toMatch(/(password|secret|token)\s*[=:]\s*["']?[^\s"'$]{6,}/i);
  });
});
