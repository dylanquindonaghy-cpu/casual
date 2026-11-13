import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// deploy/Caddyfile checked by Caddy itself (audit L29: before, only its text was matched), with the
// Caddy version production runs (deploy/docker-compose.yml), in Docker like the test database:
// - `caddy validate`: Caddy reads the file, builds the whole configuration and says it's valid;
// - `caddy adapt`: the file as Caddy's own JSON, where what the app relies on is checked: on-demand
//   certificates only after asking our check, HSTS on every answer (audit L50) and the other safe
//   headers, compression and cache times (Phase 37.7), the street map's
//   file from the server's maps folder (Phase 26.2), our check closed to the outside, and the web
//   app reached with an X-Real-IP Caddy sets itself.
// Made-up values for the two settings it reads from the server's .env.

const ROOT = process.cwd();
const compose = readFileSync(join(ROOT, "deploy/docker-compose.yml"), "utf8");
const IMAGE = /image: (caddy:[\w.-]+)/.exec(compose)?.[1] ?? "caddy:missing";

const caddy = (...args: string[]) =>
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      // Caddy reads the file and nothing else: no network, so no certificate is ever asked for.
      "--network",
      "none",
      "-e",
      "APP_BASE_DOMAIN=shiftdesk.example",
      "-e",
      "ACME_EMAIL=ops@shiftdesk.example",
      "-v",
      `${join(ROOT, "deploy/Caddyfile")}:/etc/caddy/Caddyfile:ro`,
      IMAGE,
      "caddy",
      ...args,
      "--config",
      "/etc/caddy/Caddyfile",
      "--adapter",
      "caddyfile",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 },
  );

interface Handler {
  handler: string;
  root?: string;
  status_code?: number;
  response?: {
    set?: Record<string, string[]>;
    delete?: string[];
    deferred?: boolean;
    require?: { status_code?: number[]; headers?: Record<string, string[] | null> };
  };
  headers?: { request?: { set?: Record<string, string[]> } };
  upstreams?: { dial: string }[];
  routes?: Route[];
  encodings?: Record<string, object>;
  prefer?: string[];
  match?: { headers?: Record<string, string[]> };
}
interface Route {
  match?: { host?: string[]; path?: string[]; not?: { path?: string[] }[] }[];
  handle: Handler[];
}

describe("the Caddyfile, read by Caddy itself", () => {
  // The image first (a fresh machine downloads it once), so each check below is quick.
  beforeAll(() => {
    try {
      execFileSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore" });
    } catch {
      try {
        execFileSync("docker", ["pull", "--quiet", IMAGE], { stdio: "ignore", timeout: 240_000 });
      } catch {
        throw new Error(
          `Couldn't get ${IMAGE}: these tests need Docker running (as the test database does) and, the first time, the internet to download Caddy.`,
        );
      }
    }
  }, 300_000);

  it("uses the Caddy version production runs", () => {
    expect(IMAGE).toMatch(/^caddy:2\.\d+$/);
  });

  it("is valid: Caddy builds the whole configuration from it", () => {
    // `caddy validate` reports on stderr; a non-zero exit (an invalid file) throws here.
    expect(() => caddy("validate")).not.toThrow();
  });

  it("serves our domain and every other name the same way: the safe headers, compression and caching, the street map's file, our check closed, then the web app", () => {
    const json = JSON.parse(caddy("adapt")) as {
      apps: {
        http: { servers: Record<string, { listen: string[]; routes: Route[] }> };
        tls: {
          automation: {
            on_demand?: { permission?: { module: string; endpoint: string } };
            policies: { subjects?: string[]; on_demand?: boolean }[];
          };
        };
      };
    };
    const servers = Object.values(json.apps.http.servers);
    expect(servers).toHaveLength(1);
    const [server] = servers;
    expect(server?.listen).toEqual([":443"]);
    // Our domain first, then everything else.
    expect(server?.routes.map((r) => r.match?.[0]?.host ?? "any")).toEqual([
      ["shiftdesk.example"],
      "any",
    ]);
    for (const route of server?.routes ?? []) {
      const inner = route.handle[0]?.routes ?? [];
      // Caddy's own order (Phase 37.7, w1-11): the letter shapes' and the tour's cache times, the
      // safe headers (with the framing rule beside them), compression, the street map's file, our
      // check closed, then the web app.
      expect(inner.map((r) => r.handle.map((h) => h.handler))).toEqual([
        ["headers"],
        ["headers"],
        ["headers", "headers"],
        ["encode"],
        ["encode"],
        ["subroute"],
        ["static_response"],
        ["reverse_proxy"],
      ]);
      const [glyphCache, tourCache, safe, encodeAll, encodeGlyphs] = inner;
      // Cached only on good answers (2xx and 304), as they leave: the demo's password answer and
      // a missing file are never kept.
      const cached = { deferred: true, require: { status_code: [2, 304] } };
      expect(glyphCache?.match).toEqual([{ path: ["/map-glyphs/*"] }]);
      expect(glyphCache?.handle[0]?.response).toEqual({
        ...cached,
        set: { "Cache-Control": ["public, max-age=604800"] },
      });
      expect(tourCache?.match).toEqual([{ path: ["/tour/*"] }]);
      expect(tourCache?.handle[0]?.response).toEqual({
        ...cached,
        set: { "Cache-Control": ["public, max-age=86400"] },
      });
      // Every answer, set as it leaves (so they replace the app's own), and no X-Powered-By.
      expect(safe?.match).toBeUndefined();
      const [hsts, framing] = safe?.handle ?? [];
      expect(hsts?.response).toEqual({
        deferred: true,
        delete: ["X-Powered-By"],
        set: {
          "Strict-Transport-Security": ["max-age=31536000"],
          "X-Content-Type-Options": ["nosniff"],
          "Referrer-Policy": ["strict-origin-when-cross-origin"],
          "Permissions-Policy": ["camera=(self), microphone=(), geolocation=()"],
        },
      });
      // Only when the app sent no policy of its own (/files/[id]'s sandbox), and only our own pages
      // may frame the app (the staffing demo's phone frame): never DENY.
      expect(framing?.response).toEqual({
        require: { headers: { "Content-Security-Policy": null } },
        set: { "Content-Security-Policy": ["frame-ancestors 'self'"] },
      });
      // Compression: everything but the street map's file (range requests) and the letter shapes,
      // which get their own: Caddy's list leaves out application/octet-stream.
      expect(encodeAll?.match).toEqual([{ not: [{ path: ["/maps/*", "/map-glyphs/*"] }] }]);
      expect(encodeAll?.handle[0]?.encodings).toEqual({ gzip: {}, zstd: {} });
      expect(encodeAll?.handle[0]?.prefer).toEqual(["zstd", "gzip"]);
      expect(encodeGlyphs?.match).toEqual([{ path: ["/map-glyphs/*"] }]);
      expect(encodeGlyphs?.handle[0]?.encodings).toEqual({ gzip: {}, zstd: {} });
      expect(encodeGlyphs?.handle[0]?.match).toEqual({
        headers: { "Content-Type": ["application/octet-stream"] },
      });
      const [maps, closed, proxy] = inner.slice(5).map((r) => r.handle[0]);
      // /maps/* from /srv/maps (docker-compose.yml mounts the server's maps folder there, read
      // only), cached for a day, and never passed on to the web app.
      expect(inner[5]?.match).toEqual([{ path: ["/maps/*"] }]);
      const files = maps?.routes?.[0]?.handle ?? [];
      expect(files.map((h) => h.handler)).toEqual(["vars", "headers", "file_server"]);
      expect(files[0]?.root).toBe("/srv");
      expect(files[1]?.response?.set).toEqual({ "Cache-Control": ["public, max-age=86400"] });
      expect(compose).toMatch(/\n {6}- \.\/maps:\/srv\/maps:ro\n/);
      expect(inner[6]?.match).toEqual([{ path: ["/api/caddy/*"] }]);
      expect(closed?.status_code).toBe(404);
      expect(proxy?.upstreams).toEqual([{ dial: "web:3000" }]);
      expect(proxy?.headers?.request?.set).toEqual({
        "X-Real-Ip": ["{http.request.remote.host}"],
      });
    }
  });

  it("gets a certificate on demand only after asking our check", () => {
    const json = JSON.parse(caddy("adapt")) as {
      apps: {
        tls: {
          automation: {
            on_demand?: { permission?: { module: string; endpoint: string } };
            policies: { subjects?: string[]; on_demand?: boolean }[];
          };
        };
      };
    };
    const automation = json.apps.tls.automation;
    expect(automation.on_demand?.permission).toEqual({
      module: "http",
      endpoint: "http://web:3000/api/caddy/ask",
    });
    // Our own domain the ordinary way; on demand only for the rest.
    expect(
      automation.policies.find((p) => p.subjects?.includes("shiftdesk.example"))?.on_demand,
    ).toBeFalsy();
    expect(automation.policies.some((p) => !p.subjects && p.on_demand === true)).toBe(true);
  });
});
