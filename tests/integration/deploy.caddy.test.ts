import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// deploy/Caddyfile checked by Caddy itself (audit L29: before, only its text was matched), with the
// Caddy version production runs (deploy/docker-compose.yml), in Docker like the test database:
// - `caddy validate`: Caddy reads the file, builds the whole configuration and says it's valid;
// - `caddy adapt`: the file as Caddy's own JSON, where what the app relies on is checked: on-demand
//   certificates only after asking our check, HSTS on every answer (audit L50), our check closed
//   to the outside, and the web app reached with an X-Real-IP Caddy sets itself.
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
  status_code?: number;
  response?: { set?: Record<string, string[]> };
  headers?: { request?: { set?: Record<string, string[]> } };
  upstreams?: { dial: string }[];
  routes?: Route[];
}
interface Route {
  match?: { host?: string[]; path?: string[] }[];
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

  it("serves our domain and every other name the same way: HSTS, our check closed, then the web app", () => {
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
      expect(inner.map((r) => r.handle[0]?.handler)).toEqual([
        "headers",
        "static_response",
        "reverse_proxy",
      ]);
      const [hsts, closed, proxy] = inner.map((r) => r.handle[0]);
      expect(hsts?.response?.set).toEqual({ "Strict-Transport-Security": ["max-age=31536000"] });
      expect(inner[1]?.match).toEqual([{ path: ["/api/caddy/*"] }]);
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
