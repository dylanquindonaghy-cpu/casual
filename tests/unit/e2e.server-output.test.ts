import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createLogger } from "@/lib/log";
import { BROWSER_LEFT, createOnRequestError } from "@/lib/log/next";
import { logProcessErrors } from "@/lib/log/process";
import { createConsoleTransport } from "@/lib/messaging/console";
import { logFailures } from "@/worker/jobs";
import { checkServerOutput } from "../e2e/server-output";

// What every e2e run's teardown checks in the servers' output (tests/e2e/teardown.ts): a stray
// phone number, a login token outside the console transport's own prints, or a server error the
// tests didn't expect fails the run (audit L53, L64).

const TOKEN = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v";
const ON_PURPOSE = "the e2e test page fails the first time, on purpose";
const opts = {
  allowNumbers: ["+447700900000"],
  sentTokens: [TOKEN],
  expectedErrors: new Set([ON_PURPOSE]),
};

// Real lines, as the logger and the console transport write them.
async function serverOutput(write: (log: (l: string) => void) => Promise<void>): Promise<string> {
  const lines: string[] = [];
  await write((l) => lines.push(l));
  return lines.join("\n");
}

describe("the e2e run's check of the servers' output", () => {
  it("passes a clean run: the console transport's printed login link, and the expected failures", async () => {
    const text = await serverOutput(async (print) => {
      const log = createLogger({ write: print });
      log.info("request", { path: "/login" });
      await createConsoleTransport(print).send({
        channel: "whatsapp",
        to: "+447700900123",
        from: "+447700900000",
        body: `Here's your link: https://acme.localhost:3100/l#${TOKEN}`,
      });
      log.error("request failed", { error: new Error(ON_PURPOSE) });
      log.info("worker started");
    });
    expect(checkServerOutput(text, opts)).toEqual({ findings: [], errors: [] });
  });

  it("fails on a server error no test expected", async () => {
    const text = await serverOutput(async (print) => {
      const log = createLogger({ write: print });
      await createOnRequestError(log)(
        new TypeError("Cannot read properties of undefined (reading 'id')"),
        { path: "/office", method: "GET", headers: {} },
        {
          routerKind: "App Router",
          routePath: "/office",
          routeType: "render",
          revalidateReason: undefined,
        },
      );
    });
    expect(checkServerOutput(text, opts).errors).toHaveLength(1);
  });

  it("a connection closed mid-page isn't a server error (it was one on every e2e run)", async () => {
    const text = await serverOutput(async (print) => {
      await createOnRequestError(createLogger({ write: print }))(
        new Error(BROWSER_LEFT),
        { path: "/office/shifts/x", method: "GET", headers: {} },
        {
          routerKind: "App Router",
          routePath: "/office/shifts/[id]",
          routeType: "render",
          revalidateReason: undefined,
        },
      );
    });
    expect(checkServerOutput(text, opts)).toEqual({ findings: [], errors: [] });
  });

  it("fails on a login token outside the console transport's prints, however it got there", () => {
    for (const leak of [
      `[server action] consumeLoginLinkAction("${TOKEN}")`,
      `GET /l#${TOKEN} 200`,
      `cookie __Host-sd_session=${TOKEN}`,
      `the token ${TOKEN} was used`,
    ]) {
      const found = checkServerOutput(`started\n${leak}`, opts).findings;
      expect(found.length, leak).toBeGreaterThan(0);
      expect(
        found.every((f) => f.kind === "token" && f.line === 2),
        leak,
      ).toBe(true);
    }
  });

  // 12J.1 (office.integrations.spec.ts makes a key and calls the API with it): the API never logs
  // a key or the Authorization header, and no message ever carries one, so this counts anywhere,
  // the console transport's prints included.
  it("fails on a planner's API key or a Bearer credential, even inside a printed message", async () => {
    const key = `shiftdesk_${"Kq7_Zx-Mv".repeat(4)}Pw3Ln_8`;
    for (const leak of [
      `{"msg":"api request","route":"PUT /api/v1/sessions/[ref]","key":"${key}"}`,
      `authorization: Bearer ${key}`,
      "Authorization: Bearer made-up-credential",
    ]) {
      const found = checkServerOutput(`started\n${leak}`, opts).findings;
      expect(
        found.map((f) => [f.line, f.kind]),
        leak,
      ).toEqual([[2, "key"]]);
    }
    const printed = await serverOutput(async (print) => {
      await createConsoleTransport(print).send({
        channel: "whatsapp",
        to: "+447700900123",
        from: "+447700900000",
        body: `Your planner key: ${key}`,
      });
    });
    expect(checkServerOutput(printed, opts).findings.map((f) => [f.line, f.kind])).toEqual([
      [2, "key"],
    ]);
  });

  it("fails on a phone number or email, but not the firm's own shifts line", () => {
    const text = "from +447700900000\ncall 07700 900123.\nann.booker@example.com";
    expect(checkServerOutput(text, opts).findings.map((f) => [f.line, f.kind])).toEqual([
      [2, "phone"],
      [3, "email"],
    ]);
  });

  // The guardrails and adversarial reviews: two kinds of failure used to reach no JSON line.
  it("a tick or alert job that throws is logged as an error (and still fails for pg-boss)", async () => {
    const lines: string[] = [];
    const tick = logFailures(
      "pay-digest-tick",
      async () => {
        throw new Error("listFirmIds failed");
      },
      createLogger({ write: (l) => lines.push(l) }),
    );
    await expect(tick()).rejects.toThrow("listFirmIds failed");
    expect(checkServerOutput(lines.join("\n"), opts).errors).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      msg: "job failed",
      queue: "pay-digest-tick",
    });
  });

  it("a promise or error nobody caught in the web app is logged as an error", () => {
    const lines: string[] = [];
    const proc = new EventEmitter();
    logProcessErrors(createLogger({ write: (l) => lines.push(l) }), proc);
    proc.emit("unhandledRejection", new Error("fire and forget failed"));
    proc.emit("uncaughtException", new Error("nobody caught this"));
    expect(checkServerOutput(lines.join("\n"), opts).errors).toHaveLength(2);
  });
});
