import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// deploy/Caddyfile (Phase 8): Caddy isn't run in tests (it's tried for real with the deploy), so
// this pins what the app relies on: on-demand certificates only after asking our own check, and
// every request reaching the web app with its real Host and an X-Real-IP Caddy sets itself.

const ROOT = process.cwd();
const caddyfile = readFileSync(join(ROOT, "deploy/Caddyfile"), "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("#"))
  .join("\n");

describe("the Caddyfile", () => {
  it("asks the app's certificate check, at the route that exists, before any on-demand certificate", () => {
    const ask = /on_demand_tls \{\s*ask (http:\/\/web:3000(\/[^\s]+))\s*\}/.exec(caddyfile);
    expect(ask?.[2]).toBe("/api/caddy/ask");
    expect(existsSync(join(ROOT, `src/app${ask?.[2] ?? "/none"}/route.ts`))).toBe(true);
  });

  it("our own domain the ordinary way; every other name only on demand", () => {
    expect(caddyfile).toMatch(/\{\$APP_BASE_DOMAIN\} \{\s*import app\s*\}/);
    expect(caddyfile).toMatch(/https:\/\/ \{\s*tls \{\s*on_demand\s*\}\s*import app\s*\}/);
  });

  it("proxies to the web app with X-Real-IP from the connection (replacing any the client sent), but not our certificate check", () => {
    expect(caddyfile).toMatch(
      /\(app\) \{\s*respond \/api\/caddy\/\* 404\s*reverse_proxy web:3000 \{\s*header_up X-Real-IP \{remote_host\}\s*\}\s*\}/,
    );
    // Nothing rewrites Host: the app finds the firm from it.
    expect(caddyfile).not.toMatch(/header_up Host/i);
  });

  it("takes the certificate contact address from the environment, not the file", () => {
    expect(caddyfile).toMatch(/email \{\$ACME_EMAIL\}/);
    expect(caddyfile).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
  });
});
