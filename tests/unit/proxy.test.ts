import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { createLogger } from "@/lib/log";
import { createProxy } from "@/lib/http/proxy";
import { clientIpFrom, ipLimitKey, requestIdFrom } from "@/lib/request";
import { proxy } from "@/proxy";

// Request IDs: src/proxy.ts gives every request a fresh one and passes it to the app.

const BASE = "localhost:3000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function run(headers: Record<string, string> = {}) {
  const response = proxy(
    new NextRequest("http://acme.localhost:3000/login", {
      headers: { host: "acme.localhost:3000", ...headers },
    }),
  );
  return {
    // What the app will see as the request header, and what the browser gets back.
    forwarded: response.headers.get("x-middleware-request-x-request-id"),
    returned: response.headers.get("x-request-id"),
  };
}

describe("the proxy's log line", () => {
  it("logs method and path only: no query string, and numbers in the path masked", () => {
    const lines: string[] = [];
    const handle = createProxy(createLogger({ write: (line) => lines.push(line) }), () => BASE);
    handle(
      new NextRequest(
        "http://acme.localhost:3000/x/%2B447700900123?token=s3cret&mobile=07700900123",
        {
          headers: { host: "acme.localhost:3000" },
        },
      ),
    );
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(line).toMatchObject({ msg: "request", method: "GET" });
    expect(line.requestId).toMatch(UUID);
    for (const leak of ["s3cret", "token", "mobile", "7700900"])
      expect(lines[0]).not.toContain(leak);
  });
});

describe("request ids", () => {
  it("gives every request a fresh id, passed on to the app and returned to the client", () => {
    const first = run();
    const second = run();
    expect(first.forwarded).toMatch(UUID);
    expect(first.returned).toBe(first.forwarded);
    expect(second.forwarded).not.toBe(first.forwarded);
  });

  it("overwrites an id the client sent", () => {
    const spoofed = "11111111-1111-4111-8111-111111111111";
    const { forwarded } = run({ "x-request-id": spoofed });
    expect(forwarded).toMatch(UUID);
    expect(forwarded).not.toBe(spoofed);
  });

  it("server code reads the id, and anything malformed becomes 'unknown'", () => {
    const id = "5f0c8c1e-1d0e-4c5a-9a1a-3b2c1d0e9f8a";
    expect(requestIdFrom(new Headers({ "x-request-id": id }))).toBe(id);
    expect(requestIdFrom(new Headers({ "x-request-id": "<script>" }))).toBe("unknown");
    expect(requestIdFrom(new Headers())).toBe("unknown");
  });
});

describe("hosts the proxy serves", () => {
  const quiet = createProxy(createLogger({ write: () => undefined }), () => BASE);
  // The URL is fixed; the proxy only ever reads the Host header.
  const status = (host: string, path = "/") =>
    quiet(new NextRequest(`http://localhost:3000${path}`, { headers: { host } })).status;

  it.each(["localhost:3000", "acme.localhost:3000", "ACME.Localhost:3000", "acme.localhost.:3000"])(
    "passes %s through to the app",
    (host) => {
      expect(status(host)).toBe(200);
    },
  );

  it("ignores X-Forwarded-Host: the Host header alone decides", () => {
    const res = quiet(
      new NextRequest("http://127.0.0.1:3000/", {
        headers: { host: "127.0.0.1:3000", "x-forwarded-host": "acme.localhost:3000" },
      }),
    );
    expect(res.status).toBe(404);
  });

  it("lets a name that may be a firm's own domain through (the page's firm lookup decides)", () => {
    expect(status("shifts.acme-events.test:3000", "/login")).toBe(200);
    expect(status("evil.example:3000", "/login")).toBe(200);
  });

  it("lets Caddy's certificate check through on any host (it calls http://web:3000), nothing else", () => {
    expect(status("web:3000", "/api/caddy/ask")).toBe(200);
    expect(status("web:3000", "/login")).toBe(404);
    expect(status("web:3000", "/api/caddy/ask/x")).toBe(404);
  });

  it("returns 404 when there is no Host header", () => {
    const req = new NextRequest("http://acme.localhost:3000/");
    req.headers.delete("host");
    expect(quiet(req).status).toBe(404);
  });

  it.each([
    ["an IPv6 address", "[::1]:3000"],
    ["a dot after the port", "acme.localhost:3000."],
    ["an IP address", "127.0.0.1:3000"],
    ["a nested subdomain", "x.acme.localhost:3000"],
    ["a reserved subdomain", "portal.localhost:3000"],
    ["a punycode subdomain", "xn--80ak6aa92e.localhost:3000"],
    ["the wrong port", "acme.localhost:4000"],
    ["a custom domain on the wrong port", "shifts.acme-events.test:4000"],
  ])("returns 404 for %s (%s)", (_label, host) => {
    expect(status(host, "/login")).toBe(404);
  });
});

describe("the client IP for rate limits", () => {
  it("comes from X-Real-IP only; anything else is the shared 'unknown' bucket", () => {
    expect(clientIpFrom(new Headers({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIpFrom(new Headers({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8:0:0::/64");
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "203.0.113.7" }))).toBe("unknown");
    expect(clientIpFrom(new Headers({ "x-real-ip": "<script>" }))).toBe("unknown");
    expect(clientIpFrom(new Headers())).toBe("unknown");
  });
});

describe("IP rate-limit keys", () => {
  it("group IPv6 by /64, whatever the spelling, so one connection can't rotate addresses", () => {
    const key = ipLimitKey("2001:db8:1234:5678::1");
    expect(key).toBe("2001:db8:1234:5678::/64");
    expect(ipLimitKey("2001:DB8:1234:5678:ffff:eeee:dddd:cccc")).toBe(key);
    expect(ipLimitKey("2001:0db8:1234:5678:0:0:0:2")).toBe(key);
    expect(ipLimitKey("2001:db8:1234:5679::1")).not.toBe(key);
    expect(ipLimitKey("::1")).toBe("0:0:0:0::/64");
  });

  it("keep IPv4 as is, including IPv4 written as IPv6", () => {
    expect(ipLimitKey("203.0.113.7")).toBe("203.0.113.7");
    expect(ipLimitKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("turn anything else into the shared 'unknown' bucket", () => {
    for (const junk of ["", "not-an-ip", "999.1.1.1", "1.2.3", "::g"]) {
      expect(ipLimitKey(junk)).toBe("unknown");
    }
  });
});
