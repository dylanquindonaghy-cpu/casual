import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "pg-connection-string";
import { describe, expect, it } from "vitest";
import { databaseTlsOn } from "@/lib/db/tls";
import { parseAdminEnv, parseAppEnv, parseWorkerEnv } from "@/lib/env";

// Database TLS in production (audit L38; ADR-021): the server's .env (deploy/env.example) asks pg
// for an encrypted connection checked against the host's CA certificate (sslmode=verify-full, the
// server's db-ca.pem mounted read-only at /app/db-ca.pem by deploy/docker-compose.yml; nothing
// fetched into the image), and the app refuses to start in production with a database address
// that doesn't. A database on the same machine (development, the browser tests) needs neither.

const ROOT = process.cwd();
const envExample = Object.fromEntries(
  readFileSync(join(ROOT, "deploy/env.example"), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const TLS = "?sslmode=verify-full&sslrootcert=/app/db-ca.pem";
const remote = (role: string, query = TLS) =>
  `postgres://${role}:pw@db.shiftdesk.example:5432/shiftdesk${query}`;
const prod = {
  NODE_ENV: "production",
  APP_BASE_DOMAIN: "shiftdesk.example",
  SESSION_SECRET: "a-real-production-secret-0123456789abc",
  ALERTS_TRANSPORT: "console",
  PUSH_TRANSPORT: "none",
  MESSAGING_TRANSPORT: "console", // refused in production on its own: not what's tested here
};

// The services as Docker Compose reads them (`docker compose config` only reads the file), with
// made-up values for everything it asks for.
const COMPOSE_ENV = [
  "SHIFTDESK_IMAGE=ghcr.io/example/shiftdesk",
  "APP_BASE_DOMAIN=shiftdesk.example",
  `DATABASE_URL=${remote("shiftdesk_app")}`,
  `DATABASE_JOBS_URL=${remote("shiftdesk_jobs")}`,
  `DATABASE_ADMIN_URL=${remote("shiftdesk_owner")}`,
  "SESSION_SECRET=made-up-session-secret-for-this-test-only",
  "ACME_EMAIL=ops@example.com",
].join("\n");

interface Mount {
  source: string;
  target: string;
  type: string;
  read_only?: boolean;
  bind?: { create_host_path?: boolean };
}
interface Service {
  environment?: Record<string, string>;
  volumes?: Mount[];
}

function composeServices(): Record<string, Service> {
  const dir = mkdtempSync(join(tmpdir(), "compose-tls-"));
  const envFile = join(dir, "test.env");
  writeFileSync(envFile, COMPOSE_ENV);
  const profiles = ["worker", "migrate", "owner"].flatMap((p) => ["--profile", p]);
  const out = execFileSync(
    "docker",
    [
      "compose",
      "-f",
      "deploy/docker-compose.yml",
      "--env-file",
      envFile,
      ...profiles,
      "config",
    ].concat(["--format", "json"]),
    // A clean environment, as in deploy.compose.test.ts: compose reads the caller's variables
    // before the env file, and this process has the test database's addresses loaded.
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return (JSON.parse(out) as { services: Record<string, Service> }).services;
}

describe("the server's database addresses (deploy/env.example)", () => {
  it("all three end with checked TLS, against the host's certificate at /app/db-ca.pem", () => {
    for (const key of ["DATABASE_ADMIN_URL", "DATABASE_URL", "DATABASE_JOBS_URL"]) {
      expect(envExample[key], key).toMatch(/\?sslmode=verify-full&sslrootcert=\/app\/db-ca\.pem$/);
      expect(databaseTlsOn(envExample[key] ?? ""), key).toBe(true);
    }
  });

  it("every service with a database address gets the server's db-ca.pem, read-only; Caddy doesn't", () => {
    const services = composeServices();
    const withDatabase = Object.entries(services)
      .filter(([, s]) => Object.keys(s.environment ?? {}).some((k) => k.startsWith("DATABASE_")))
      .map(([name]) => name)
      .sort();
    expect(withDatabase).toEqual(["migrate", "owner", "web", "worker"]);
    for (const name of withDatabase) {
      const ca = services[name]?.volumes?.find((v) => v.target === "/app/db-ca.pem");
      expect(ca, name).toMatchObject({ type: "bind", read_only: true });
      expect(ca?.source, name).toMatch(/\/deploy\/secrets\/db-ca\.pem$/);
    }
    expect(services.caddy?.volumes?.some((v) => v.target === "/app/db-ca.pem")).toBe(false);
    // Never created: a missing file stops the start instead of mounting an empty folder. Read from
    // the file, not the rendered config: Compose versions print that setting differently (this
    // one leaves it out of a long-form bind and prints a short one as "bind: {}"). Each of those
    // services mounts the shared x-db-ca block, and the block never creates the file.
    const source = readFileSync(join(ROOT, "deploy/docker-compose.yml"), "utf8");
    const block = (name: string) =>
      new RegExp(`^  ${name}:\\n((?:(?:    .*)?\\n)*)`, "m").exec(source)?.[1] ?? "";
    for (const name of withDatabase) {
      expect(block(name), name).toMatch(/^ {6}- \*db-ca$/m);
    }
    expect(source).toMatch(
      /^x-db-ca: &db-ca\n(?: {2}.*\n)*? {2}bind:\n {4}create_host_path: false$/m,
    );
  });

  it("the image fetches nothing and holds no database certificate (nothing from Amazon)", () => {
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    const instructions = dockerfile
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    // ADD can fetch a URL; nothing downloads anything; no certificate is copied in.
    expect(instructions).not.toMatch(/^ADD\b/m);
    expect(instructions).not.toMatch(/\b(curl|wget)\b|https?:\/\//);
    expect(instructions).not.toMatch(/^COPY\b[^\n]*\.pem\b/m);
    expect(dockerfile).not.toMatch(/amazonaws|rds-ca/i);
  });

  it("pg reads them as: encrypt, check the certificate and the name, against that certificate", () => {
    const dir = mkdtempSync(join(tmpdir(), "db-ca-"));
    const certificate = join(dir, "db-ca.pem");
    writeFileSync(certificate, "-----BEGIN CERTIFICATE-----\nmade up\n-----END CERTIFICATE-----\n");
    const config = parse((envExample.DATABASE_URL ?? "").replace("/app/db-ca.pem", certificate));
    expect(config.ssl).toMatchObject({ ca: expect.stringContaining("made up") });
    // Not turned off: pg checks the certificate (and, for verify-full, the name).
    expect((config.ssl as { rejectUnauthorized?: boolean }).rejectUnauthorized).not.toBe(false);
  });
});

describe("the app in production", () => {
  it("refuses a database address without checked TLS, in every part of the app", () => {
    for (const plain of [
      "",
      "?sslmode=require",
      "?sslmode=verify-full",
      "?sslrootcert=/app/x.pem",
    ]) {
      expect(
        () => parseAppEnv({ ...prod, DATABASE_URL: remote("shiftdesk_app", plain) }),
        plain,
      ).toThrow(/sslmode=verify-full[\s\S]*at DATABASE_URL/);
    }
    expect(() =>
      parseWorkerEnv({
        ...prod,
        DATABASE_URL: remote("shiftdesk_app"),
        DATABASE_JOBS_URL: remote("shiftdesk_jobs", ""),
      }),
    ).toThrow(/DATABASE_JOBS_URL/);
    expect(() =>
      parseAdminEnv({
        NODE_ENV: "production",
        DATABASE_ADMIN_URL: remote("shiftdesk_owner", ""),
        DATABASE_URL: remote("shiftdesk_app"),
        DATABASE_JOBS_URL: remote("shiftdesk_jobs"),
      }),
    ).toThrow(/DATABASE_ADMIN_URL/);
  });

  it("starts with checked TLS", () => {
    expect(parseAppEnv({ ...prod, DATABASE_URL: remote("shiftdesk_app") }).DATABASE_URL).toBe(
      remote("shiftdesk_app"),
    );
    expect(
      parseAdminEnv({
        NODE_ENV: "production",
        DATABASE_ADMIN_URL: remote("shiftdesk_owner"),
        DATABASE_URL: remote("shiftdesk_app"),
        DATABASE_JOBS_URL: remote("shiftdesk_jobs"),
      }).NODE_ENV,
    ).toBe("production");
  });

  it("reads the address as pg does: a ?host= elsewhere, or a later sslmode, counts", () => {
    expect(
      databaseTlsOn("postgres://shiftdesk_app:pw@localhost/shiftdesk?host=db.example.com"),
    ).toBe(false);
    expect(databaseTlsOn(remote("shiftdesk_app", `${TLS}&sslmode=disable`))).toBe(false);
    expect(databaseTlsOn("not a url")).toBe(false);
  });

  // The guardrails review: `next build` runs in production mode and the root layout reads the
  // settings while pages are built, so the image's build-only placeholders must pass too, or the
  // Docker build fails (verify.sh doesn't build the image).
  it("accepts the Dockerfile's build-only placeholders (next build runs in production mode)", () => {
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    const build = dockerfile.slice(
      dockerfile.indexOf("AS build"),
      dockerfile.indexOf("AS runtime"),
    );
    const envBlock = /ENV ((?:[^\n]*\\\n)*[^\n]*)/.exec(build)?.[1] ?? "";
    const placeholders = Object.fromEntries(
      [...envBlock.matchAll(/([A-Z_]+)=("[^"]*"|\S+)/g)].map((m) => [
        m[1],
        (m[2] ?? "").replace(/^"|"$/g, ""),
      ]),
    );
    expect(Object.keys(placeholders)).toEqual(
      expect.arrayContaining(["APP_BASE_DOMAIN", "DATABASE_URL", "SESSION_SECRET"]),
    );
    expect(parseAppEnv({ ...placeholders, NODE_ENV: "production" }).NODE_ENV).toBe("production");
  });

  it("a database on the same machine needs none (development, the browser tests' production build)", () => {
    for (const url of [
      "postgres://shiftdesk_app:pw@localhost:5432/shiftdesk",
      "postgres://shiftdesk_app:pw@127.0.0.1:5432/shiftdesk",
      "postgres://shiftdesk_app:pw@[::1]:5432/shiftdesk",
    ]) {
      expect(databaseTlsOn(url), url).toBe(true);
      expect(parseAppEnv({ ...prod, DATABASE_URL: url }).NODE_ENV).toBe("production");
    }
    // As pg reads them: a socket, and a ?host= that points back to this machine.
    for (const url of [
      "postgres://shiftdesk_app:pw@/shiftdesk?host=/var/run/postgresql",
      "postgres://shiftdesk_app:pw@db.example.com/shiftdesk?host=localhost",
    ]) {
      expect(databaseTlsOn(url), url).toBe(true);
    }
  });
});
