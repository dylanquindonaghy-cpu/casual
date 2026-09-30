import { describe, expect, it } from "vitest";
import {
  alertTransport,
  firmLabel,
  healthAlert,
  jobFailureAlert,
  sendFailureAlert,
  signatureAlert,
  syncAlert,
  testAlert,
  THRESHOLDS,
  type AlertTransport,
  type OpsAlert,
} from "@/lib/ops/alerts";
import { checkWebHealth } from "@/lib/ops/health-check";
import { createSignatureCounter } from "@/lib/ops/signature-spike";
import { QUEUES } from "@/worker/jobs/queues";
import { createLogger } from "@/lib/log";

// Alerts to the founder (src/lib/ops/): code decides each one from counts, with fixed thresholds,
// and the words carry no personal data.

const FIRM = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("the alerts", () => {
  it("failed jobs: none is no alert; otherwise one alert listing each queue", () => {
    expect(jobFailureAlert([])).toBeNull();
    expect(jobFailureAlert([{ queue: "offer-wave", count: 0 }])).toBeNull();
    expect(
      jobFailureAlert([
        { queue: "shift-reminders", count: 1 },
        { queue: "offer-wave", count: 2 },
      ]),
    ).toEqual({
      kind: "job_failures",
      key: "job-failures",
      text: "ShiftDesk alert: 3 jobs failed after the last retry in the last hour (offer-wave 2, shift-reminders 1).",
    });
    expect(jobFailureAlert([{ queue: "offer-wave", count: 1 }])?.text).toContain("1 job failed");
  });

  it("failed jobs in every queue: the 5 with the most, then how many more (always fits)", () => {
    const everyQueue = QUEUES.map((q, i) => ({ queue: q.name, count: 10 + i }));
    const a = jobFailureAlert(everyQueue);
    expect(a?.text.length).toBeLessThanOrEqual(320);
    expect(a?.text).toMatch(
      new RegExp(
        `failed after the last retry in the last hour \\(.+ and ${QUEUES.length - 5} other queues\\)\\.$`,
      ),
    );
    const top = [...everyQueue].sort((x, y) => y.count - x.count)[0];
    expect(a?.text).toContain(`(${top?.queue} ${top?.count},`);
  });

  it("a firm whose slug looks like a phone number is named by its id instead", () => {
    expect(firmLabel("acme", FIRM)).toBe("acme");
    expect(firmLabel("acme07700900123", FIRM)).toBe("firm 0f8fad5b");
    expect(syncAlert({ firmId: FIRM, slug: "acme07700900123", code: "x" }).text).toBe(
      "ShiftDesk alert: firm 0f8fad5b's rota sheet sync is failing (x).",
    );
  });

  it("the test alert", () => {
    expect(testAlert()).toEqual({
      kind: "test",
      key: "test",
      text: "ShiftDesk alert: a test alert. If you can read this, alerts reach you.",
    });
  });

  it("a failing sheet sync: one alert per firm", () => {
    expect(syncAlert({ firmId: FIRM, slug: "acme", code: "sheet_not_found" })).toEqual({
      kind: "sync_failing",
      key: `sync:${FIRM}`,
      text: "ShiftDesk alert: acme's rota sheet sync is failing (sheet_not_found).",
    });
  });

  it("send failures: more than 5% of at least 20 sends in the hour", () => {
    const sends = (sent: number, failed: number) =>
      sendFailureAlert({ firmId: FIRM, slug: "acme", sent, failed, topCode: "twilio_21610" });
    expect(THRESHOLDS).toMatchObject({ sendFailureRate: 0.05, sendFailureMinTotal: 20 });
    expect(sends(19, 1)).toBeNull(); // exactly 5%: not more than
    expect(sends(10, 9)).toBeNull(); // 19 sends: too few to judge
    expect(sends(18, 2)).toEqual({
      kind: "send_failures",
      key: `send:${FIRM}`,
      text: "ShiftDesk alert: acme: 2 of 20 WhatsApps and texts failed to send in the last hour (10%), mostly twilio_21610.",
    });
    expect(
      sendFailureAlert({ firmId: FIRM, slug: "acme", sent: 0, failed: 20, topCode: null })?.text,
    ).toBe(
      "ShiftDesk alert: acme: 20 of 20 WhatsApps and texts failed to send in the last hour (100%).",
    );
  });

  it("health: an alert only when it's failing, saying how", () => {
    expect(healthAlert({ ok: true })).toBeNull();
    expect(healthAlert({ ok: false, detail: "HTTP 503" })).toEqual({
      kind: "health_down",
      key: "health",
      text: "ShiftDesk alert: the web app's health check is failing (HTTP 503). Check the server.",
    });
  });

  it("bad signatures: from 20 in the hour", () => {
    expect(THRESHOLDS.badSignatures).toBe(20);
    expect(signatureAlert(19)).toBeNull();
    expect(signatureAlert(20)?.text).toBe(
      "ShiftDesk alert: 20 Twilio webhook requests with a bad signature in the last hour. Check TWILIO_AUTH_TOKEN, or someone is probing.",
    );
  });

  it("refuses to build an alert holding a phone number or email", () => {
    expect(() => syncAlert({ firmId: FIRM, slug: "acme", code: "07700 900123" })).toThrow(
      /personal or secret/,
    );
    expect(() =>
      sendFailureAlert({
        firmId: FIRM,
        slug: "acme",
        sent: 0,
        failed: 20,
        topCode: "ann@example.com",
      }),
    ).toThrow(/personal or secret/);
  });
});

const capture = () => {
  const sent: OpsAlert[] = [];
  const transport: AlertTransport = {
    name: "capture",
    async send(a) {
      sent.push(a);
    },
  };
  return { sent, transport };
};

describe("counting bad webhook signatures (the web's memory)", () => {
  it("alerts at the 20th in an hour, then not again for an hour", async () => {
    let t = 1_000_000_000_000;
    const { sent, transport } = capture();
    const counter = createSignatureCounter({ transport: () => transport, now: () => t });
    for (let i = 1; i < 20; i += 1) {
      expect(await counter.note()).toBeNull();
      t += 60_000; // one a minute: all 19 still in the hour
    }
    expect((await counter.note())?.kind).toBe("webhook_signatures");
    expect(sent.map((a) => a.text)).toEqual([
      "ShiftDesk alert: 20 Twilio webhook requests with a bad signature in the last hour. Check TWILIO_AUTH_TOKEN, or someone is probing.",
    ]);
    for (let i = 0; i < 30; i += 1) expect(await counter.note()).toBeNull();
    expect(sent).toHaveLength(1);
    // An hour after the alert, still coming in: alerts again.
    t += 60 * 60_000;
    for (let i = 1; i < 20; i += 1) await counter.note();
    expect((await counter.note())?.kind).toBe("webhook_signatures");
    expect(sent).toHaveLength(2);
  });

  it("forgets counts over an hour old", async () => {
    let t = 1_000_000_000_000;
    const { sent, transport } = capture();
    const counter = createSignatureCounter({ transport: () => transport, now: () => t });
    for (let i = 0; i < 19; i += 1) await counter.note();
    t += 61 * 60_000;
    for (let i = 0; i < 19; i += 1) await counter.note();
    expect(sent).toEqual([]);
  });

  it("a transport that fails is logged, not thrown into the webhook", async () => {
    const errors: string[] = [];
    const logger = createLogger({
      write: (line, level) => {
        if (level === "error") errors.push((JSON.parse(line) as { msg: string }).msg);
      },
    });
    const counter = createSignatureCounter({
      transport: () => ({
        name: "broken",
        async send() {
          throw new Error("down");
        },
      }),
      now: () => 1_000_000_000_000,
      logger,
    });
    for (let i = 0; i < 19; i += 1) await counter.note();
    await expect(counter.note()).resolves.toMatchObject({ kind: "webhook_signatures" });
    expect(errors).toEqual(["ops alert failed to send"]);
  });
});

describe("the web app's health check, from inside the server", () => {
  const answers = (...list: (Response | Error)[]) => {
    const calls: string[] = [];
    const fetcher = (async (url: string | URL | Request) => {
      calls.push(String(url));
      const next = list.shift() ?? new Error("no more");
      if (next instanceof Error) throw next;
      return next;
    }) as typeof fetch;
    return { calls, fetcher };
  };
  const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  const slept: number[] = [];
  const sleep = async (ms: number) => {
    slept.push(ms);
  };
  const url = "http://web:3000/api/health";

  it("healthy on the first answer", async () => {
    const a = answers(ok());
    expect(await checkWebHealth(url, { fetch: a.fetcher, sleep })).toEqual({ ok: true });
    expect(a.calls).toEqual([url]);
  });

  it("three tries, 5 seconds apart, before it's failing; the last reason is given", async () => {
    slept.length = 0;
    const a = answers(
      new Response("", { status: 503 }),
      new Error("ECONNREFUSED"),
      new Response("", { status: 503 }),
    );
    expect(await checkWebHealth(url, { fetch: a.fetcher, sleep })).toEqual({
      ok: false,
      detail: "HTTP 503",
    });
    expect(a.calls).toHaveLength(3);
    expect(slept).toEqual([5_000, 5_000]);
  });

  it("one bad answer then a good one is healthy; a 200 that isn't {ok: true} isn't", async () => {
    const a = answers(new Error("timeout"), ok());
    expect(await checkWebHealth(url, { fetch: a.fetcher, sleep })).toEqual({ ok: true });
    const b = answers(
      new Response("<html>", { status: 200 }),
      new Response("{}", { status: 200 }),
      new Response(JSON.stringify({ ok: false }), { status: 200 }),
    );
    expect(await checkWebHealth(url, { fetch: b.fetcher, sleep })).toEqual({
      ok: false,
      detail: "an unexpected answer",
    });
    const c = answers(new Error("x"), new Error("y"), new Error("z"));
    expect(await checkWebHealth(url, { fetch: c.fetcher, sleep })).toEqual({
      ok: false,
      detail: "no answer",
    });
  });
});

describe("the console transport", () => {
  it("writes each alert as one error line, with its kind, key and words", async () => {
    const lines: { level: string; line: Record<string, unknown> }[] = [];
    const logger = createLogger({
      write: (line, level) =>
        lines.push({ level, line: JSON.parse(line) as Record<string, unknown> }),
    });
    const alert = healthAlert({ ok: false, detail: "no answer" });
    if (!alert) throw new Error("expected an alert");
    await alertTransport("console", logger).send(alert);
    await alertTransport("none", logger).send(alert);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("error");
    expect(lines[0]?.line).toMatchObject({
      msg: "ops alert",
      alert: "health_down",
      key: "health",
      text: alert.text,
    });
  });
});
