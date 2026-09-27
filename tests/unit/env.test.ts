import { readFileSync } from "node:fs";
import { parseEnv as parseDotenv } from "node:util";
import { describe, expect, it } from "vitest";
import { parseAdminEnv, parseAppEnv, parseWorkerEnv } from "@/lib/env";

const app = {
  DATABASE_URL: "postgres://shiftdesk_app:p@localhost:5432/shiftdesk",
  APP_BASE_DOMAIN: "localhost:3000",
  SESSION_SECRET: "a-test-secret-that-is-long-enough-0123456789",
};
const worker = {
  ...app,
  DATABASE_JOBS_URL: "postgres://shiftdesk_jobs:p@localhost:5432/shiftdesk",
};
const admin = {
  ...worker,
  DATABASE_ADMIN_URL:
    "postgres://owner:p@localhost:5432/shiftdesk?options=-c%20role%3Dshiftdesk_owner",
};

describe("environment", () => {
  it("accepts a minimal valid environment and applies defaults", () => {
    const env = parseWorkerEnv(worker);
    expect(env.MESSAGING_TRANSPORT).toBe("console");
    expect(env.NODE_ENV).toBe("development");
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseAppEnv({ ...app, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it.each([
    "",
    "https://shiftdesk.co.uk",
    "Shiftdesk.co.uk",
    "shiftdesk.co.uk/",
    "*.shiftdesk.co.uk",
  ])("rejects APP_BASE_DOMAIN %j (a bare host name, optionally with a port)", (value) => {
    expect(() => parseAppEnv({ ...app, APP_BASE_DOMAIN: value })).toThrow(/APP_BASE_DOMAIN/);
  });

  it.each(["localhost:3000", "shiftdesk.co.uk"])("accepts APP_BASE_DOMAIN %s", (value) => {
    expect(parseAppEnv({ ...app, APP_BASE_DOMAIN: value }).APP_BASE_DOMAIN).toBe(value);
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    expect(() =>
      parseAppEnv({ ...app, DATABASE_URL: "mysql://shiftdesk_app:p@localhost/x" }),
    ).toThrow(/DATABASE_URL/);
  });

  it("rejects a DATABASE_URL that doesn't connect as the app role", () => {
    expect(() =>
      parseAppEnv({
        ...app,
        DATABASE_URL: "postgres://shiftdesk:shiftdesk@localhost:5432/shiftdesk",
      }),
    ).toThrow(/must connect as the shiftdesk_app role/);
  });

  it("rejects a DATABASE_JOBS_URL that doesn't connect as the jobs role", () => {
    expect(() => parseWorkerEnv({ ...worker, DATABASE_JOBS_URL: app.DATABASE_URL })).toThrow(
      /must connect as the shiftdesk_jobs role/,
    );
  });

  it("requires a SESSION_SECRET of 32+ characters, and never the example one in production", () => {
    expect(() => parseAppEnv({ ...app, SESSION_SECRET: "too-short" })).toThrow(/SESSION_SECRET/);
    const example = "dev-only-secret-change-me-in-prod-0123456789";
    expect(parseAppEnv({ ...app, SESSION_SECRET: example }).SESSION_SECRET).toBe(example);
    expect(() => parseAppEnv({ ...app, NODE_ENV: "production", SESSION_SECRET: example })).toThrow(
      /SESSION_SECRET/,
    );
  });

  it("rejects the twilio transport until it exists (Phase 4)", () => {
    expect(() => parseWorkerEnv({ ...worker, MESSAGING_TRANSPORT: "twilio" })).toThrow(
      /MESSAGING_TRANSPORT/,
    );
  });

  it("rejects the console transport in production", () => {
    expect(() => parseWorkerEnv({ ...worker, NODE_ENV: "production" })).toThrow(
      /MESSAGING_TRANSPORT/,
    );
  });

  it("the app environment never needs the jobs or owner credentials", () => {
    expect(parseAppEnv(app).DATABASE_URL).toBe(app.DATABASE_URL);
    expect(Object.keys(parseAppEnv(admin)).sort()).toEqual([
      "APP_BASE_DOMAIN",
      "DATABASE_URL",
      "NODE_ENV",
      "SESSION_SECRET",
    ]);
  });

  it("rejects an admin URL that is really the app role", () => {
    expect(() => parseAdminEnv({ ...admin, DATABASE_ADMIN_URL: app.DATABASE_URL })).toThrow(
      /must be the owner/,
    );
  });

  it(".env.example parses for the web, the worker and the admin scripts", () => {
    const example = parseDotenv(readFileSync(".env.example", "utf8"));
    expect(parseAppEnv(example).DATABASE_URL).toMatch(/shiftdesk_app/);
    expect(parseAppEnv(example).APP_BASE_DOMAIN).toBe("localhost:3000");
    expect(parseWorkerEnv(example).DATABASE_JOBS_URL).toMatch(/shiftdesk_jobs/);
    expect(parseAdminEnv(example).DATABASE_ADMIN_URL).toMatch(/role%3Dshiftdesk_owner/);
  });
});
