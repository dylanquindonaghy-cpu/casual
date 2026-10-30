import { readFileSync } from "node:fs";
import { parseEnv as parseDotenv } from "node:util";
import { describe, expect, it } from "vitest";
import { serverEnv } from "../../playwright.config";
import noTexts, { NO_TEXTS_OUTBOX, NO_TEXTS_PORT } from "../../playwright.no-texts.config";
import walkthrough from "../../playwright.walkthrough.config";
import { EXAMPLE_INTEGRATIONS_SECRET, parseAdminEnv, parseAppEnv, parseWorkerEnv } from "@/lib/env";

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

  it("VAPID_PUBLIC_KEY: empty (as .env.example ships it) means unset; a real key is kept; junk is refused", () => {
    expect(parseAppEnv({ ...app, VAPID_PUBLIC_KEY: "" }).VAPID_PUBLIC_KEY).toBeUndefined();
    const key = "B".repeat(87);
    expect(parseAppEnv({ ...app, VAPID_PUBLIC_KEY: key }).VAPID_PUBLIC_KEY).toBe(key);
    expect(() => parseAppEnv({ ...app, VAPID_PUBLIC_KEY: "not a key" })).toThrow(
      /VAPID_PUBLIC_KEY/,
    );
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

  // The planner API (12J.1; docs/office-v2.md 5.3.6): unset, every call answers 503.
  it("INTEGRATIONS_SECRET: optional, empty means unset, 32+ characters, for the web and the worker", () => {
    for (const parse of [parseAppEnv, parseWorkerEnv]) {
      expect(parse(worker).INTEGRATIONS_SECRET).toBeUndefined();
      expect(parse({ ...worker, INTEGRATIONS_SECRET: "" }).INTEGRATIONS_SECRET).toBeUndefined();
      expect(() => parse({ ...worker, INTEGRATIONS_SECRET: "s".repeat(31) })).toThrow(
        /INTEGRATIONS_SECRET/,
      );
      const secret = "s".repeat(32);
      expect(parse({ ...worker, INTEGRATIONS_SECRET: secret }).INTEGRATIONS_SECRET).toBe(secret);
      // .env.example's value is fine locally.
      expect(
        parse({ ...worker, INTEGRATIONS_SECRET: EXAMPLE_INTEGRATIONS_SECRET }).INTEGRATIONS_SECRET,
      ).toBe(EXAMPLE_INTEGRATIONS_SECRET);
    }
  });

  it("INTEGRATIONS_SECRET: never .env.example's value in production (the web and the worker)", () => {
    const prod = {
      NODE_ENV: "production",
      SESSION_SECRET: "a-real-production-secret-0123456789abc",
    };
    const real = "a-real-integrations-secret-0123456789abcdef";
    expect(() =>
      parseAppEnv({ ...app, ...prod, INTEGRATIONS_SECRET: EXAMPLE_INTEGRATIONS_SECRET }),
    ).toThrow(/INTEGRATIONS_SECRET/);
    expect(parseAppEnv({ ...app, ...prod, INTEGRATIONS_SECRET: real }).INTEGRATIONS_SECRET).toBe(
      real,
    );
    expect(parseAppEnv({ ...app, ...prod }).INTEGRATIONS_SECRET).toBeUndefined();
    // The worker can't start in production on the console transport (the default here), so compare
    // what it says.
    const workerProblems = (secret: string) => {
      try {
        parseWorkerEnv({ ...worker, ...prod, PUSH_TRANSPORT: "none", INTEGRATIONS_SECRET: secret });
        return "";
      } catch (err) {
        return String(err);
      }
    };
    expect(workerProblems(EXAMPLE_INTEGRATIONS_SECRET)).toMatch(/INTEGRATIONS_SECRET/);
    expect(workerProblems(real)).toMatch(/MESSAGING_TRANSPORT/);
    expect(workerProblems(real)).not.toMatch(/INTEGRATIONS_SECRET/);
  });

  it("the browser tests' run with no text sender (P2.7) keeps every pin of the others, with no text sender at all", () => {
    const servers = [noTexts.webServer ?? []].flat();
    expect(servers).toHaveLength(2); // the worker and the web app
    for (const server of servers) {
      expect(server.env).toEqual({
        ...serverEnv(NO_TEXTS_PORT, NO_TEXTS_OUTBOX, { testPages: false }),
        MESSAGING_TRANSPORT: "none",
      });
    }
  });

  it("INTEGRATIONS_SECRET is pinned to made-up values a production build takes, for the tests and the browser tests' servers", () => {
    const prod = {
      ...app,
      NODE_ENV: "production",
      SESSION_SECRET: "a-real-production-secret-0123456789abc",
    };
    const pinned = [
      process.env.INTEGRATIONS_SECRET,
      serverEnv(3100, ".dev/outbox").INTEGRATIONS_SECRET,
      ...[walkthrough.webServer ?? []].flat().map((server) => server.env?.INTEGRATIONS_SECRET),
    ];
    expect(pinned).toHaveLength(4); // the walkthrough's worker and web app share theirs
    expect(new Set(pinned).size).toBe(3);
    for (const secret of pinned) {
      expect(secret).not.toBe(EXAMPLE_INTEGRATIONS_SECRET);
      expect(parseAppEnv({ ...prod, INTEGRATIONS_SECRET: secret }).INTEGRATIONS_SECRET).toBe(
        secret,
      );
    }
  });

  it("MESSAGING_TRANSPORT none (no text sender, P2.5): a choice in production too; empty means unset", () => {
    expect(parseWorkerEnv({ ...worker, MESSAGING_TRANSPORT: "none" }).MESSAGING_TRANSPORT).toBe(
      "none",
    );
    expect(parseWorkerEnv({ ...worker, MESSAGING_TRANSPORT: "" }).MESSAGING_TRANSPORT).toBe(
      "console",
    );
    // In production (its other settings aside, tested in deploy.compose.test.ts): console and an
    // empty value (console) are refused, none isn't.
    const problems = (value: string) => {
      try {
        parseWorkerEnv({ ...worker, NODE_ENV: "production", MESSAGING_TRANSPORT: value });
        return "";
      } catch (err) {
        return String(err);
      }
    };
    expect(problems("console")).toMatch(/MESSAGING_TRANSPORT/);
    expect(problems("")).toMatch(/MESSAGING_TRANSPORT/);
    expect(problems("none")).not.toMatch(/MESSAGING_TRANSPORT/);
  });

  it("rejects the twilio transport until it exists (Phase 4)", () => {
    expect(() => parseWorkerEnv({ ...worker, MESSAGING_TRANSPORT: "twilio" })).toThrow(
      /MESSAGING_TRANSPORT/,
    );
  });

  it("Google Sheets: off by default; google needs the key file's path; nothing else is accepted", () => {
    expect(parseWorkerEnv(worker).SHEETS_TRANSPORT).toBe("none");
    // As the env examples ship it: an empty path means not set.
    expect(
      parseWorkerEnv({ ...worker, GOOGLE_SERVICE_ACCOUNT_JSON_PATH: "" })
        .GOOGLE_SERVICE_ACCOUNT_JSON_PATH,
    ).toBeUndefined();
    expect(() => parseWorkerEnv({ ...worker, SHEETS_TRANSPORT: "google" })).toThrow(
      /GOOGLE_SERVICE_ACCOUNT_JSON_PATH/,
    );
    expect(() =>
      parseWorkerEnv({
        ...worker,
        SHEETS_TRANSPORT: "google",
        GOOGLE_SERVICE_ACCOUNT_JSON_PATH: "",
      }),
    ).toThrow(/GOOGLE_SERVICE_ACCOUNT_JSON_PATH/);
    const env = parseWorkerEnv({
      ...worker,
      SHEETS_TRANSPORT: "google",
      GOOGLE_SERVICE_ACCOUNT_JSON_PATH: "./secrets/google-service-account.json",
    });
    expect(env).toMatchObject({
      SHEETS_TRANSPORT: "google",
      GOOGLE_SERVICE_ACCOUNT_JSON_PATH: "./secrets/google-service-account.json",
    });
    expect(() => parseWorkerEnv({ ...worker, SHEETS_TRANSPORT: "csv" })).toThrow(
      /SHEETS_TRANSPORT/,
    );
  });

  it("rejects the console transport in production", () => {
    expect(() => parseWorkerEnv({ ...worker, NODE_ENV: "production" })).toThrow(
      /MESSAGING_TRANSPORT/,
    );
  });

  it("alerts to the founder: console when unset; can't be turned off in production", () => {
    expect(parseAppEnv(app).ALERTS_TRANSPORT).toBeUndefined();
    expect(parseAppEnv({ ...app, ALERTS_TRANSPORT: "none" }).ALERTS_TRANSPORT).toBe("none");
    expect(() => parseAppEnv({ ...app, ALERTS_TRANSPORT: "email" })).toThrow(/ALERTS_TRANSPORT/);
    const prod = {
      NODE_ENV: "production",
      SESSION_SECRET: "a-real-production-secret-0123456789abc",
    };
    expect(() => parseAppEnv({ ...app, ...prod, ALERTS_TRANSPORT: "none" })).toThrow(
      /ALERTS_TRANSPORT/,
    );
    expect(parseAppEnv({ ...app, ...prod, ALERTS_TRANSPORT: "console" }).ALERTS_TRANSPORT).toBe(
      "console",
    );
    expect(() =>
      parseWorkerEnv({ ...worker, ...prod, PUSH_TRANSPORT: "none", ALERTS_TRANSPORT: "none" }),
    ).toThrow(/ALERTS_TRANSPORT/);
  });

  it("the worker's health check address: http(s) only", () => {
    expect(
      parseWorkerEnv({ ...worker, HEALTH_CHECK_URL: "http://web:3000/api/health" })
        .HEALTH_CHECK_URL,
    ).toBe("http://web:3000/api/health");
    expect(() => parseWorkerEnv({ ...worker, HEALTH_CHECK_URL: "file:///etc/passwd" })).toThrow(
      /HEALTH_CHECK_URL/,
    );
  });

  it("the app environment never needs the jobs or owner credentials", () => {
    expect(parseAppEnv(app).DATABASE_URL).toBe(app.DATABASE_URL);
    expect(Object.keys(parseAppEnv(admin)).sort()).toEqual([
      "AI_TRANSPORT", // not a credential: "none" when unset; the web app shows Enquiries' banner (12D.1)
      "APP_BASE_DOMAIN",
      "DATABASE_URL",
      // not a credential: "console" when unset; the web app reads only whether there's a text
      // sender, for the login and pay pages' words (P2.7)
      "MESSAGING_TRANSPORT",
      "NODE_ENV",
      "SESSION_SECRET",
      "TRAVEL_PROVIDER", // not a credential: "fake" when unset (12G.1)
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
    expect(parseAppEnv(example).INTEGRATIONS_SECRET).toBe(EXAMPLE_INTEGRATIONS_SECRET);
    expect(parseWorkerEnv(example).DATABASE_JOBS_URL).toMatch(/shiftdesk_jobs/);
    expect(parseAdminEnv(example).DATABASE_ADMIN_URL).toMatch(/role%3Dshiftdesk_owner/);
  });
});
