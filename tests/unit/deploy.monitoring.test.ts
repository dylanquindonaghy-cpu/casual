import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// deploy/alarms.sh and deploy/restore-drill.sh (Phase 8): Lightsail's alarms and the monthly restore
// drill. They act on a real AWS account, so no test lets them reach AWS: the one that runs a script
// puts a stand-in `aws` first on the PATH (it records being called and fails) and blanks AWS's
// credentials. This pins what matters: London only, errors never mistaken for "not there", the
// drill never reusing an old copy or touching the real database, the alarms, and no secrets.

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const alarms = read("deploy/alarms.sh");
const drill = read("deploy/restore-drill.sh");
const code = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

// Runs a script with a stand-in `aws` that records any call and fails, and no AWS credentials.
function runWithoutAws(script: string, args: string[]): { stderr: string; awsCalled: boolean } {
  const dir = mkdtempSync(join(tmpdir(), "no-aws-"));
  const marker = join(dir, "called");
  writeFileSync(join(dir, "aws"), `#!/bin/sh\ntouch "${marker}"\nexit 99\n`);
  chmodSync(join(dir, "aws"), 0o755);
  let stderr = "";
  try {
    execFileSync("bash", [script, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        NODE_ENV: "test",
        PATH: `${dir}:${process.env.PATH ?? ""}`,
        HOME: dir,
        AWS_CONFIG_FILE: "/dev/null",
        AWS_SHARED_CREDENTIALS_FILE: "/dev/null",
      },
    });
  } catch (err) {
    stderr = String((err as { stderr?: string }).stderr);
  }
  return { stderr, awsCalled: existsSync(marker) };
}

describe.each([
  ["deploy/alarms.sh", alarms],
  ["deploy/restore-drill.sh", drill],
])("%s", (path, text) => {
  it("is valid bash and stops at the first error", () => {
    execFileSync("bash", ["-n", path], { cwd: ROOT });
    expect(text).toContain("set -euo pipefail");
  });

  it("every AWS call is in London", () => {
    expect(text).toMatch(/^REGION="eu-west-2"$/m);
    expect(text).toContain('aws_ls() { aws lightsail --region "$REGION" "$@"; }');
    const direct = code(text)
      .split("\n")
      .filter(
        (line) => /(^|[\s(])aws [a-z]/.test(line) && !line.includes("aws lightsail --region"),
      );
    for (const line of direct) expect(line, line).toMatch(/--region "\$REGION"/);
  });

  it("stops if the CLI isn't logged in (or its key is deactivated), and only 'not found' means not there", () => {
    expect(text).toContain('aws sts get-caller-identity --region "$REGION"');
    expect(text).toContain('[[ "$err" == *NotFoundException* ]] && return 1');
    expect(text).toContain('fail "AWS answered with an error (is the CLI key active?): $err"');
    // No existence check that swallows every error.
    expect(code(text)).not.toMatch(/>\/dev\/null 2>&1 \\?\s*\n?\s*\|\|/);
  });
});

describe("deploy/alarms.sh", () => {
  it("alarms for the server being down, its CPU and burst capacity, the database's storage and CPU; emails when fixed too", () => {
    for (const line of [
      'alarm "${NAME}-app-down" "$INSTANCE" StatusCheckFailed GreaterThanOrEqualToThreshold 1 2 breaching',
      'alarm "${NAME}-app-cpu" "$INSTANCE" CPUUtilization GreaterThanThreshold 90 3 notBreaching',
      'alarm "${NAME}-app-burst" "$INSTANCE" BurstCapacityPercentage LessThanThreshold 20 3 notBreaching',
      'alarm "${NAME}-db-storage" "$DATABASE" FreeStorageSpace LessThanThreshold 8589934592 1 notBreaching',
      'alarm "${NAME}-db-cpu" "$DATABASE" CPUUtilization GreaterThanThreshold 90 3 notBreaching',
    ]) {
      expect(alarms, line).toContain(line);
    }
    expect(alarms).toContain("--notification-triggers ALARM OK");
    expect(alarms).toContain("--contact-protocols Email");
  });

  it("checks the server and the database both exist first; resends the confirmation until it's clicked", () => {
    expect(alarms).toContain('exists get-instance --instance-name "$INSTANCE"');
    expect(alarms).toContain(
      'exists get-relational-database --relational-database-name "$DATABASE"',
    );
    expect(alarms).toContain("send-contact-method-verification --protocol Email");
  });

  it("the address comes from the command line, checked before AWS is ever called", () => {
    for (const args of [[], ["not-an-email"], ["a@b"]]) {
      const { stderr, awsCalled } = runWithoutAws("deploy/alarms.sh", args);
      expect(stderr, args.join(" ")).toContain("give the email address to alert");
      expect(awsCalled, args.join(" ")).toBe(false);
    }
  });
});

describe("deploy/restore-drill.sh", () => {
  it("restores the latest backup to a separate, private drill database", () => {
    expect(drill).toMatch(/^DRILL="\$\{NAME\}-db-drill"$/m);
    expect(drill).toContain('--relational-database-name "$DRILL"');
    expect(drill).toContain('--source-relational-database-name "$DATABASE"');
    expect(drill).toContain("--use-latest-restorable-time");
    expect(drill).toContain("--no-publicly-accessible");
  });

  it("reuses a drill database only if it was restored in the last few hours (never an old copy)", () => {
    expect(drill).toMatch(/^REUSE_HOURS=3$/m);
    expect(drill).toContain("(( $(date +%s) - created_s > REUSE_HOURS * 3600 ))");
    expect(drill).toContain('fail "an old drill database from $created exists.');
  });

  it("only ever deletes the drill database, and only after its name is typed", () => {
    const deletes = [...drill.matchAll(/delete-relational-database[^\n]*/g)].map((m) => m[0]);
    expect(deletes).toEqual([
      'delete-relational-database --relational-database-name "$DRILL" --skip-final-snapshot >/dev/null',
    ]);
    const confirm = drill.indexOf('[[ "$typed" == "$DRILL" ]] || fail "not deleted."');
    expect(confirm).toBeGreaterThan(0);
    expect(confirm).toBeLessThan(drill.indexOf("delete-relational-database"));
  });

  it("never runs against AWS in a test: an unknown option or a missing CLI login stops it", () => {
    const { awsCalled } = runWithoutAws("deploy/restore-drill.sh", ["--help"]);
    // The stand-in aws fails the login check (it's called for that alone), so nothing else runs.
    expect(awsCalled).toBe(true);
    expect(runWithoutAws("deploy/restore-drill.sh", ["--help"]).stderr).toContain(
      "the AWS CLI isn't logged in",
    );
  });
});

describe("no secret in either file", () => {
  it.each([
    ["deploy/alarms.sh", alarms],
    ["deploy/restore-drill.sh", drill],
  ])("%s", (_name, text) => {
    expect(text).not.toMatch(/AKIA[0-9A-Z]{16}/);
    expect(text).not.toMatch(/(password|secret|token)\s*[=:]\s*["']?[^\s"'$]{6,}/i);
    for (const address of text.match(/[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []) {
      expect(address).toMatch(/@example\.com$/);
    }
  });
});
