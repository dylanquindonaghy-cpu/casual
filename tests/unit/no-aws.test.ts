import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// No AWS (ADR-021; docs/office-v2.md 5.8): no AWS account, SDK or AWS-branded service. Email goes
// over SMTP, AI through the Anthropic API, and the app runs on any UK or EU Docker host with the
// database's CA certificate from that host. This fails if an AWS SDK, endpoint, command, setting
// or name comes back in the code, the image, the deploy files, the env examples or CLAUDE.md.
// Docs that record history (the work log, the overnight log, the audit, PLAN.md's Hours log) keep
// their AWS mentions, so docs/ isn't scanned here.

const ROOT = process.cwd();
const AWS =
  /\b(aws-sdk|@aws-sdk|amazonaws\.com|AWS_[A-Z_]+|BEDROCK_[A-Z_]+|rds-ca\.pem|lightsail|bedrock)\b/i;
// The AWS command line: `aws` followed by a service or option, at the start of a command.
const AWS_COMMAND = /(^|[\s;&|(`"'$])aws\s+[a-z-]/m;
const AWS_PACKAGE = /^(aws-sdk|@aws-sdk\/.+|@aws\/.+|aws-cdk.*)$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const rel = (path: string) => relative(ROOT, path);
const read = (path: string) => readFileSync(path, "utf8");

const SCANNED = [
  ...[".env.example", "deploy/env.example", "Dockerfile", "CLAUDE.md"].map((p) => join(ROOT, p)),
  ...readdirSync(ROOT)
    .filter((name) => /^docker-compose.*\.ya?ml$/.test(name))
    .map((name) => join(ROOT, name)),
  ...["deploy", "src", "scripts", ".github/workflows"].flatMap((dir) => files(join(ROOT, dir))),
];

function awsFindings(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => AWS.test(line) || AWS_COMMAND.test(line))
    .map((line) => line.trim());
}

describe("no AWS (ADR-021)", () => {
  it("no AWS SDK, endpoint, command, setting or name in the code, image, deploy files or CLAUDE.md", () => {
    expect(SCANNED.map(rel)).toEqual(
      expect.arrayContaining([
        ".env.example",
        "deploy/env.example",
        "deploy/docker-compose.yml",
        "docker-compose.dev.yml",
        "Dockerfile",
        "CLAUDE.md",
        "src/lib/db/tls.ts",
      ]),
    );
    expect(SCANNED.length).toBeGreaterThan(200);
    const found = SCANNED.flatMap((path) =>
      awsFindings(read(path)).map((line) => `${rel(path)}: ${line}`),
    );
    expect(found).toEqual([]);
  });

  it("no AWS package in package.json", () => {
    const pkg = JSON.parse(read(join(ROOT, "package.json"))) as Record<string, unknown>;
    const names = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ].flatMap((field) => Object.keys((pkg[field] as Record<string, string> | undefined) ?? {}));
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((name) => AWS_PACKAGE.test(name))).toEqual([]);
  });

  it("the Lightsail scripts are gone", () => {
    for (const script of ["deploy/lightsail.sh", "deploy/alarms.sh", "deploy/restore-drill.sh"]) {
      expect(existsSync(join(ROOT, script)), script).toBe(false);
    }
  });

  it("the checks themselves catch what they're meant to", () => {
    for (const line of [
      'import { SESClient } from "@aws-sdk/client-ses";',
      "ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/x.pem",
      "AWS_REGION=eu-west-2",
      "BEDROCK_MODEL_SORT=",
      "sslrootcert=/app/rds-ca.pem",
      "# Production uses Lightsail managed Postgres.",
      "// Claude on Amazon Bedrock",
      "aws lightsail get-instance --instance-name x",
      "  value=$(aws s3 ls)",
    ]) {
      expect(awsFindings(line), line).toHaveLength(1);
    }
    for (const line of [
      "sslrootcert=/app/db-ca.pem",
      "EMAIL_TRANSPORT=smtp",
      "AI_TRANSPORT=anthropic",
      "// an awsome list",
      "laws apply",
    ]) {
      expect(awsFindings(line), line).toEqual([]);
    }
    expect(AWS_PACKAGE.test("@aws-sdk/client-s3")).toBe(true);
    expect(AWS_PACKAGE.test("aws-sdk")).toBe(true);
    expect(AWS_PACKAGE.test("nodemailer")).toBe(false);
  });
});
