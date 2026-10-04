import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "pg-connection-string";
import { describe, expect, it } from "vitest";
import { databaseTlsOn } from "@/lib/db/tls";
import { parseAdminEnv, parseAppEnv, parseWorkerEnv } from "@/lib/env";

// Database TLS in production (audit L38): the server's .env (deploy/env.example) asks pg for an
// encrypted connection checked against Amazon's certificates (sslmode=verify-full, the bundle in the
// image at /app/rds-ca.pem), and the app refuses to start in production with a database address
// that doesn't. A database on the same machine (development, the browser tests) needs neither.

const ROOT = process.cwd();
const envExample = Object.fromEntries(
  readFileSync(join(ROOT, "deploy/env.example"), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const TLS = "?sslmode=verify-full&sslrootcert=/app/rds-ca.pem";
const remote = (role: string, query = TLS) =>
  `postgres://${role}:pw@db.abc123.eu-west-2.rds.amazonaws.com:5432/shiftdesk${query}`;
const prod = {
  NODE_ENV: "production",
  APP_BASE_DOMAIN: "shiftdesk.example",
  SESSION_SECRET: "a-real-production-secret-0123456789abc",
  ALERTS_TRANSPORT: "console",
  PUSH_TRANSPORT: "none",
  MESSAGING_TRANSPORT: "console", // refused in production on its own: not what's tested here
};

describe("the server's database addresses (deploy/env.example)", () => {
  it("all three end with checked TLS, against the bundle the image holds", () => {
    for (const key of ["DATABASE_ADMIN_URL", "DATABASE_URL", "DATABASE_JOBS_URL"]) {
      expect(envExample[key], key).toMatch(/\?sslmode=verify-full&sslrootcert=\/app\/rds-ca\.pem$/);
      expect(databaseTlsOn(envExample[key] ?? ""), key).toBe(true);
    }
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    const runtime = dockerfile.slice(dockerfile.indexOf("AS runtime"));
    expect(runtime).toContain(
      "ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-ca.pem",
    );
  });

  it("pg reads them as: encrypt, check the certificate and the name, against that bundle", () => {
    const dir = mkdtempSync(join(tmpdir(), "rds-ca-"));
    const bundle = join(dir, "rds-ca.pem");
    writeFileSync(bundle, "-----BEGIN CERTIFICATE-----\nmade up\n-----END CERTIFICATE-----\n");
    const config = parse((envExample.DATABASE_URL ?? "").replace("/app/rds-ca.pem", bundle));
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
