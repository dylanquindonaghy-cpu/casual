import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// deploy/Caddyfile (Phase 8): this pins the file's text, what the app relies on: on-demand
// certificates only after asking our own check, every request reaching the web app with its real
// Host and an X-Real-IP Caddy sets itself, and HSTS (Phase 10). Caddy itself checks the file too
// (tests/integration/deploy.caddy.test.ts); it's tried for real with the deploy.

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

  it("proxies to the web app with X-Real-IP from the connection (replacing any the client sent), but not our certificate check or the street map's file; HSTS on every answer", () => {
    expect(caddyfile).toMatch(
      /\(app\) \{\s*header \{\s*Strict-Transport-Security "max-age=31536000"[\s\S]*?\n\thandle \/maps\/\* \{\s*header Cache-Control "public, max-age=86400"\s*root \* \/srv\s*file_server\s*\}\s*respond \/api\/caddy\/\* 404\s*reverse_proxy web:3000 \{\s*header_up X-Real-IP \{remote_host\}\s*\}\s*\}/,
    );
    // Nothing rewrites Host: the app finds the firm from it.
    expect(caddyfile).not.toMatch(/header_up Host/i);
  });

  // Phase 37.7 (w1-11): safe headers on every answer, set as it leaves (deferred), so they replace
  // the app's own rather than sit beside them.
  it("sends the safe headers on every answer, removes X-Powered-By, and frames only for itself", () => {
    expect(caddyfile).toMatch(
      /\theader \{\n\t\tStrict-Transport-Security "max-age=31536000"\n\t\tX-Content-Type-Options "nosniff"\n\t\tReferrer-Policy "strict-origin-when-cross-origin"\n\t\tPermissions-Policy "camera=\(self\), microphone=\(\), geolocation=\(\)"\n\t\t-X-Powered-By\n\t\tdefer\n\t\}/,
    );
    // Only when the app sent no policy of its own (/files/[id]'s sandbox), and never DENY: the
    // staffing demo's phone frame (/start/phone) frames the app on the same address.
    expect(caddyfile).toContain(`header ?Content-Security-Policy "frame-ancestors 'self'"`);
    expect(caddyfile).not.toMatch(/DENY/i);
    expect(caddyfile).not.toContain("'none'");
    expect(caddyfile).not.toMatch(/X-Frame-Options/i);
  });

  it("compresses everything but the street map's file, the letter shapes as octet-stream; caches them a week and the tour a day, on good answers only", () => {
    expect(caddyfile).toContain("@compressible not path /maps/* /map-glyphs/*");
    expect(caddyfile).toContain("encode @compressible zstd gzip");
    expect(caddyfile).toMatch(
      /@glyphs path \/map-glyphs\/\*\n\tencode @glyphs \{\n\t\tzstd\n\t\tgzip\n\t\tmatch \{\n\t\t\theader Content-Type application\/octet-stream\n\t\t\}\n\t\}/,
    );
    const cached = (matcher: string, age: number) =>
      new RegExp(
        `header ${matcher} \\{\\n\\t\\tCache-Control "public, max-age=${age}"\\n\\t\\tdefer\\n\\t\\tmatch \\{\\n\\t\\t\\tstatus 2xx 304\\n\\t\\t\\}\\n\\t\\}`,
      );
    expect(caddyfile).toMatch(cached("@glyphs", 604800));
    expect(caddyfile).toContain("@tour path /tour/*");
    expect(caddyfile).toMatch(cached("@tour", 86400));
  });

  it("takes the certificate contact address from the environment, not the file", () => {
    expect(caddyfile).toMatch(/email \{\$ACME_EMAIL\}/);
    // (A matcher's name never has a dot after it, so @glyphs and @tour aren't addresses.)
    expect(caddyfile).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
  });
});
