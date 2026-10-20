import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAppEnv, parseWorkerEnv } from "@/lib/env";

// Demo mode's settings (16.1; ADR-025): production prints messages instead of sending them only
// with DEMO_MODE=on, demo mode sends nothing outside the server, it always has an outbox to show,
// and in production the whole site needs its password.

const app = {
  DATABASE_URL: "postgres://shiftdesk_app:p@localhost:5432/shiftdesk",
  APP_BASE_DOMAIN: "demo.example.co.uk",
  SESSION_SECRET: "a-real-production-secret-0123456789abc",
  NODE_ENV: "production",
};
const worker = {
  ...app,
  DATABASE_JOBS_URL: "postgres://shiftdesk_jobs:p@localhost:5432/shiftdesk",
  PUSH_TRANSPORT: "none",
  WEBHOOK_TRANSPORT: "https",
};
const demo = { DEMO_MODE: "on", CONSOLE_OUTBOX_FILE: ".dev/demo-outbox.jsonl" };
// A demo server's web app and worker, as deploy/docker-compose.demo.yml sets them (16.2).
const demoApp = { ...app, ...demo, DEMO_SITE_PASSWORD: "made-up-demo-password" };
const demoWorker = { ...worker, ...demo, WEBHOOK_TRANSPORT: "console" };

const problems = (parse: () => unknown): string => {
  try {
    parse();
    return "";
  } catch (err) {
    return String(err);
  }
};

describe("demo mode settings", () => {
  it("production refuses printed texts and emails without demo mode, as before", () => {
    const said = problems(() => parseWorkerEnv(worker));
    expect(said).toMatch(/MESSAGING_TRANSPORT/);
    expect(said).toMatch(/EMAIL_TRANSPORT/);
  });

  it("production takes printed texts, emails and webhooks with demo mode and an outbox", () => {
    const env = parseWorkerEnv(demoWorker);
    expect(env.DEMO_MODE).toBe("on");
    expect(env.MESSAGING_TRANSPORT).toBe("console");
    expect(env.EMAIL_TRANSPORT).toBe("console");
    expect(env.WEBHOOK_TRANSPORT).toBe("console");
    expect(env.CONSOLE_OUTBOX_FILE).toBe(".dev/demo-outbox.jsonl");
    expect(parseAppEnv(demoApp).DEMO_MODE).toBe("on");
    // Printed webhooks in production: only in demo mode.
    expect(problems(() => parseWorkerEnv({ ...worker, WEBHOOK_TRANSPORT: "console" }))).toMatch(
      /webhooks must really be sent in production/,
    );
  });

  // (Texts have only the console sender until Phase 15's: the settings refuse anything else.)
  it.each([
    ["EMAIL_TRANSPORT", "smtp"],
    ["WEBHOOK_TRANSPORT", "https"],
    ["PUSH_TRANSPORT", "webpush"],
    ["SHEETS_TRANSPORT", "google"],
    ["AI_TRANSPORT", "anthropic"],
    ["TRAVEL_PROVIDER", "traveltime"],
  ])("the worker in demo mode sends nothing outside the server: %s=%s is refused", (key, value) => {
    expect(problems(() => parseWorkerEnv({ ...demoWorker, [key]: value }))).toMatch(
      new RegExp(`demo mode sends nothing outside the server: ${key} must be`),
    );
  });

  it.each([
    ["TRAVEL_PROVIDER", "traveltime"],
    ["AI_TRANSPORT", "anthropic"],
  ])("the web app in demo mode too: %s=%s is refused", (key, value) => {
    expect(problems(() => parseAppEnv({ ...demoApp, [key]: value }))).toMatch(
      new RegExp(`demo mode sends nothing outside the server: ${key} must be`),
    );
  });

  it("the site password: 12 characters or more; the settings don't demand it (the web app's own gate does)", () => {
    expect(problems(() => parseAppEnv({ ...demoApp, DEMO_SITE_PASSWORD: "short-pass" }))).toMatch(
      /DEMO_SITE_PASSWORD/,
    );
    expect(parseAppEnv(demoApp).DEMO_SITE_PASSWORD).toBe("made-up-demo-password");
    // The worker reads the app's settings too, in production, and never gets the password
    // (deploy/docker-compose.demo.yml): they must take demo mode without it. A web app without it
    // turns every request away instead (src/lib/demo/gate.ts; tests/unit/demo.gate.test.ts).
    expect(parseAppEnv({ ...app, ...demo }).DEMO_SITE_PASSWORD).toBeUndefined();
    expect(parseAppEnv(demoWorker).DEMO_MODE).toBe("on");
  });

  it("demo mode needs an outbox file, for the web app and the worker", () => {
    expect(problems(() => parseAppEnv({ ...app, DEMO_MODE: "on" }))).toMatch(/CONSOLE_OUTBOX_FILE/);
    expect(problems(() => parseWorkerEnv({ ...worker, DEMO_MODE: "on" }))).toMatch(
      /CONSOLE_OUTBOX_FILE/,
    );
  });

  it("demo mode never sends real email, even when an SMTP server is set", () => {
    const said = problems(() =>
      parseWorkerEnv({
        ...demoWorker,
        EMAIL_TRANSPORT: "smtp",
        SMTP_HOST: "smtp.example.com",
        SMTP_FROM: "shifts@example.com",
      }),
    );
    expect(said).toMatch(
      /demo mode sends nothing outside the server: EMAIL_TRANSPORT must be console/,
    );
  });

  it("DEMO_MODE: empty means unset; only 'on' turns it on", () => {
    expect(parseAppEnv({ ...app, DEMO_MODE: "" }).DEMO_MODE).toBeUndefined();
    expect(problems(() => parseAppEnv({ ...app, DEMO_MODE: "yes" }))).toMatch(/DEMO_MODE/);
    expect(problems(() => parseAppEnv({ ...app, DEMO_MODE: "true" }))).toMatch(/DEMO_MODE/);
  });

  it.each(["../outbox.jsonl", ".dev/../outbox.jsonl", ".dev/a/b.jsonl", ".dev/", "outbox.jsonl"])(
    "the outbox file is a file directly in .dev/: %j is refused",
    (file) => {
      expect(problems(() => parseAppEnv({ ...app, CONSOLE_OUTBOX_FILE: file }))).toMatch(
        /CONSOLE_OUTBOX_FILE/,
      );
    },
  );

  it("the outbox file: the e2e runs' and a demo server's are accepted; empty means unset", () => {
    for (const file of [
      ".dev/e2e-outbox.jsonl",
      ".dev/walkthrough-outbox.jsonl",
      ".dev/demo-outbox.jsonl",
    ]) {
      expect(parseAppEnv({ ...app, CONSOLE_OUTBOX_FILE: file }).CONSOLE_OUTBOX_FILE).toBe(file);
    }
    expect(parseAppEnv({ ...app, CONSOLE_OUTBOX_FILE: "" }).CONSOLE_OUTBOX_FILE).toBeUndefined();
  });
});

describe("the real server's files", () => {
  // Demo mode is only ever switched on by the demo server's own compose file (16.2): never by the
  // files a real server runs from, nor the image they're built into.
  it("never switch demo mode on", () => {
    const root = process.cwd();
    const workflows = readdirSync(join(root, ".github/workflows")).map((f) =>
      join(".github/workflows", f),
    );
    for (const file of [
      "deploy/docker-compose.yml",
      "deploy/env.example",
      "Dockerfile",
      ...workflows,
    ]) {
      expect(readFileSync(join(root, file), "utf8"), file).not.toMatch(/DEMO_MODE|DEMO_SITE/);
    }
  });
});
