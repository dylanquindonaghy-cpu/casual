import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// deploy/cloud-init.sh (Phase 8): the app server's first-boot script, given to a new server by the
// host's console (docs/runbooks.md "Set up the server (once)"). It's never run by the tests. This
// pins what matters: plain sh, the server kept patched, Docker from Docker's own repository, the
// app's folder root-only, and no secret in the file.

const ROOT = process.cwd();
const cloudInit = readFileSync(join(ROOT, "deploy/cloud-init.sh"), "utf8");
const code = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

describe("deploy/cloud-init.sh", () => {
  it("is plain POSIX sh (hosts often run it under dash, which has no pipefail on Ubuntu 24.04)", () => {
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

  it("holds no secret", () => {
    expect(cloudInit).not.toMatch(/AKIA[0-9A-Z]{16}/); // an AWS access key
    expect(cloudInit).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    expect(cloudInit).not.toMatch(/(password|secret|token)\s*[=:]\s*["']?[^\s"'$]{6,}/i);
  });
});
