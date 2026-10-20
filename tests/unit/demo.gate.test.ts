import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import {
  checksItsOwnKey,
  DEMO_PASSWORD_NEEDED,
  DEMO_SITE_USER,
  demoLoginMatches,
  demoSitePassword,
} from "@/lib/demo/gate";
import { createProxy } from "@/lib/http/proxy";
import { createLogger } from "@/lib/log";

// Demo mode's one password for the whole site (16.1; ADR-025): the app's own check, run first for
// every request by the proxy (src/lib/http/proxy.ts), whatever stands in front of the app.

const PASSWORD = "made-up-demo-password";
const basic = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;

describe("the demo's password", () => {
  it("is on only in demo mode with a password set", () => {
    expect(demoSitePassword({ DEMO_MODE: "on", DEMO_SITE_PASSWORD: PASSWORD })).toBe(PASSWORD);
    expect(demoSitePassword({ DEMO_MODE: "on" })).toBeUndefined();
    expect(demoSitePassword({ DEMO_SITE_PASSWORD: PASSWORD })).toBeUndefined();
  });

  it("matches only the user name demo with the password, exactly", () => {
    expect(DEMO_SITE_USER).toBe("demo");
    expect(demoLoginMatches(basic("demo", PASSWORD), PASSWORD)).toBe(true);
    expect(demoLoginMatches(`basic  ${basic("demo", PASSWORD).slice(6)}`, PASSWORD)).toBe(true);
    for (const header of [
      null,
      "",
      basic("demo", `${PASSWORD}x`),
      basic("demo", PASSWORD.slice(0, -1)),
      basic("Demo", PASSWORD),
      basic("admin", PASSWORD),
      basic("", PASSWORD),
      basic("demo", ""),
      `Bearer ${PASSWORD}`,
      `Basic ${Buffer.from(`demo${PASSWORD}`).toString("base64")}`,
      "Basic not*base64",
      `Basic ${Buffer.from([0x64, 0x3a, 0xff, 0xfe]).toString("base64")}`,
    ]) {
      expect(demoLoginMatches(header, PASSWORD), String(header)).toBe(false);
    }
  });

  it("a password with a colon or accents works (only the first colon ends the user name)", () => {
    const odd = "dé:mo pass:word£";
    expect(demoLoginMatches(basic("demo", odd), odd)).toBe(true);
    expect(demoLoginMatches(basic("demo", "dé:mo pass:word"), odd)).toBe(false);
  });
});

describe("the proxy on a demo server", () => {
  const handle = createProxy(
    createLogger({ write: () => undefined }),
    () => "demo.example.co.uk",
    () => PASSWORD,
  );
  const send = (path: string, headers: Record<string, string> = {}) =>
    handle(
      new NextRequest(`https://acme.demo.example.co.uk${path}`, {
        headers: { host: "acme.demo.example.co.uk", ...headers },
      }),
    );

  it("asks for the password on every page, server action and API route without it", async () => {
    for (const path of [
      "/",
      "/login",
      "/demo",
      "/office",
      "/l",
      "/api/logout",
      "/api/push/subscribe",
      "/api/webhooks/twilio/sms",
      "/api/v1x",
      "/sw.js",
    ]) {
      const res = send(path);
      expect(res.status, path).toBe(401);
      expect(res.headers.get("www-authenticate"), path).toBe(
        'Basic realm="ShiftDesk demo", charset="UTF-8"',
      );
      expect(res.headers.get("cache-control"), path).toBe("no-store");
      expect(await res.text(), path).toBe(DEMO_PASSWORD_NEEDED);
    }
    expect(send("/login", { authorization: basic("demo", "wrong-password-0") }).status).toBe(401);
  });

  it("lets the page through with it", () => {
    const res = send("/login", { authorization: basic("demo", PASSWORD) });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("lets the server's own checks through without it: health, and Caddy's certificate check", () => {
    expect(send("/api/health").status).toBe(200);
    expect(send("/api/caddy/ask").status).toBe(200);
  });

  it("lets the planner API through: it refuses anyone without a firm's own key itself", () => {
    expect(checksItsOwnKey("/api/v1")).toBe(true);
    expect(checksItsOwnKey("/api/v1/sessions/SES-1")).toBe(true);
    expect(checksItsOwnKey("/api/v1x")).toBe(false);
    expect(checksItsOwnKey("/api/v2/sessions")).toBe(false);
    expect(send("/api/v1/sessions/SES-1", { authorization: "Bearer shiftdesk_x" }).status).toBe(
      200,
    );
    expect(send("/api/v1/cancellations").status).toBe(200);
  });

  it("an address we don't serve is still not found, password or not", () => {
    const res = handle(
      new NextRequest("https://evil.example.invalid:1/login", {
        headers: { host: "evil.example.invalid:1" },
      }),
    );
    expect(res.status).toBe(404);
  });

  it("without demo mode (no password): no password asked, as before", () => {
    const plain = createProxy(createLogger({ write: () => undefined }), () => "demo.example.co.uk");
    const res = plain(
      new NextRequest("https://acme.demo.example.co.uk/login", {
        headers: { host: "acme.demo.example.co.uk" },
      }),
    );
    expect(res.status).toBe(200);
  });
});
