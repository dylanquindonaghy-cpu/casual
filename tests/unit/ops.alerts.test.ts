import { describe, expect, it } from "vitest";
import { takeConnectionWaits } from "@/lib/db/scoped";
import {
  aiFallbackAlert,
  alertTransport,
  backlogAlert,
  connectionWaitAlert,
  firmLabel,
  healthAlert,
  jobFailureAlert,
  loginLinkAlerts,
  runningLongAlert,
  sendFailureAlert,
  signatureAlert,
  syncAlert,
  testAlert,
  THRESHOLDS,
  volumeAlerts,
  type AlertTransport,
  type OpsAlert,
} from "@/lib/ops/alerts";
import { backlogLimitSeconds } from "@/lib/ops/tick";
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

  it("login links: more than 100 in the hour, or more than 300 in 24 hours (14.2)", () => {
    const links = (lastHour: number, lastDay: number, slug = "acme") =>
      loginLinkAlerts({ firmId: FIRM, slug, lastHour, lastDay });
    expect(THRESHOLDS).toMatchObject({ loginLinksPerHour: 100, loginLinksPerDay: 300 });
    expect(links(0, 0)).toEqual([]);
    expect(links(100, 300)).toEqual([]); // exactly at each: not more than
    const hour = {
      kind: "login_links",
      key: `logins:${FIRM}`,
      text: "ShiftDesk alert: acme: 101 login links by WhatsApp and text in the last hour. A big briefing can do that; if not, someone may be running up the firm's messages. Check the action log's Logins.",
    };
    const day = {
      kind: "login_links",
      key: `logins-day:${FIRM}`,
      text: "ShiftDesk alert: acme: 301 login links by WhatsApp and text in the last 24 hours, far more than a firm needs. Someone may be running up the firm's messages. Check the action log's Logins.",
    };
    expect(links(101, 101)).toEqual([hour]);
    // A slow drip: never 100 in an hour, but over 300 in the day.
    expect(links(40, 301)).toEqual([day]);
    expect(links(101, 301)).toEqual([hour, day]);
    // Within the alert's length with the longest slug (20 characters), and passes the masker.
    for (const a of links(10_000, 100_000, "a".repeat(20))) {
      expect(a.text.length).toBeLessThanOrEqual(320);
    }
    // A slug that looks like a phone number: named by the firm's id instead.
    expect(links(101, 0, "acme07700900123")[0]?.text).toMatch(
      /^ShiftDesk alert: firm 0f8fad5b: 101 /,
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

// Seeing a backlog (P4.8).
describe("the backlog alerts", () => {
  const wait = (queue: string, oldestSeconds: number, waiting = 1) => ({
    queue,
    waiting,
    oldestSeconds,
    limitSeconds: backlogLimitSeconds(queue),
  });

  it("each queue's limit: a casual's message 60 s, an offer wave 2 minutes, anything else 15", () => {
    expect(backlogLimitSeconds("inbound-message")).toBe(60);
    expect(backlogLimitSeconds("offer-wave")).toBe(120);
    for (const q of QUEUES.filter((q) => !["inbound-message", "offer-wave"].includes(q.name))) {
      expect(backlogLimitSeconds(q.name), q.name).toBe(15 * 60);
    }
    expect(THRESHOLDS.backlogSeconds).toEqual({ inbound: 60, waves: 120, other: 900 });
  });

  it("a job waiting past its queue's limit: an alert naming it, the furthest past first", () => {
    expect(backlogAlert([])).toBeNull();
    // At the limit, or nothing waiting: no alert.
    expect(backlogAlert([wait("inbound-message", 60), wait("offer-wave", 120)])).toBeNull();
    expect(backlogAlert([wait("inbound-message", 500, 0)])).toBeNull();
    expect(
      backlogAlert([
        wait("shift-reminders", 1_800, 40),
        wait("inbound-message", 61, 240),
        wait("offer-wave", 119, 3),
        wait("pay-digest", 899),
      ]),
    ).toEqual({
      kind: "job_backlog",
      key: "job-backlog",
      text: "ShiftDesk alert: jobs are waiting too long to start: shift-reminders 40 waiting, the oldest 30 min (limit 15 min); inbound-message 240 waiting, the oldest 61 s (limit 60 s). Check the worker is running and keeping up.",
    });
  });

  it("every queue backed up: the 3 furthest past, then how many more (always fits)", () => {
    const all = QUEUES.map((q, i) => ({
      queue: q.name,
      waiting: 99_999,
      oldestSeconds: 999_999 + i,
      limitSeconds: 60,
    }));
    const a = backlogAlert(all);
    expect(a?.text.length).toBeLessThanOrEqual(320);
    expect(a?.text).toContain(`; and ${QUEUES.length - 3} other queues.`);
  });

  it("jobs running past 80% of their time limit: an alert, the furthest along first", () => {
    expect(runningLongAlert([])).toBeNull();
    expect(runningLongAlert([{ queue: "offer-wave", count: 0, longestShare: 0.9 }])).toBeNull();
    expect(
      runningLongAlert([
        { queue: "retention-purge", count: 1, longestShare: 0.85 },
        { queue: "offer-wave", count: 2, longestShare: 0.97 },
      ]),
    ).toEqual({
      kind: "job_running_long",
      key: "job-running-long",
      text: "ShiftDesk alert: jobs are running past 80% of their time limit: offer-wave 2, the longest at 97%; retention-purge 1, the longest at 85%. pg-boss stops and reruns a job at its limit.",
    });
    const all = QUEUES.map((q) => ({ queue: q.name, count: 99_999, longestShare: 9.99 }));
    expect(runningLongAlert(all)?.text.length).toBeLessThanOrEqual(320);
  });

  it("the worker's waits for a connection: any that ran out, or 5 of a second or more", () => {
    expect(connectionWaitAlert({ slow: 0, timedOut: 0, poolMax: 15 })).toBeNull();
    expect(connectionWaitAlert({ slow: 4, timedOut: 0, poolMax: 15 })).toBeNull();
    expect(connectionWaitAlert({ slow: 5, timedOut: 0, poolMax: 15 })).toEqual({
      kind: "connection_waits",
      key: "connection-waits",
      text: "ShiftDesk alert: the worker waited a second or more for a database connection 5 times in the last 5 minutes. Its 15 connections are all busy: look for slow queries, or give it more.",
    });
    expect(connectionWaitAlert({ slow: 0, timedOut: 1, poolMax: 15 })?.text).toBe(
      "ShiftDesk alert: the worker waited a second or more for a database connection 0 times in the last 5 minutes, and 1 wait ran out (those jobs failed, and will run again). Its 15 connections are all busy: look for slow queries, or give it more.",
    );
    expect(
      connectionWaitAlert({ slow: 999_999, timedOut: 999_999, poolMax: 15 })?.text.length,
    ).toBeLessThanOrEqual(320);
  });

  it("the withFirm wait count is taken and starts again from zero", () => {
    expect(takeConnectionWaits()).toEqual({ slow: 0, timedOut: 0 });
    expect(takeConnectionWaits()).toEqual({ slow: 0, timedOut: 0 });
  });

  it("a firm's AI fallbacks: more than 20% of at least 20 messages it was asked to sort", () => {
    const ai = (asked: number, fellBack: number) =>
      aiFallbackAlert({ firmId: FIRM, slug: "acme", asked, fellBack });
    expect(ai(19, 19)).toBeNull();
    expect(ai(20, 4)).toBeNull();
    expect(ai(20, 5)).toEqual({
      kind: "ai_fallbacks",
      key: `ai:${FIRM}`,
      text: "ShiftDesk alert: acme: the AI couldn't sort 5 of 20 messages in the last hour (25%), so they went to the office. Check the AI's key and Anthropic's status.",
    });
  });

  it("a firm's messages in and offers out: over 1,500 and 500 an hour, each its own alert", () => {
    const v = (inbound: number, offers: number) =>
      volumeAlerts({ firmId: FIRM, slug: "acme", inbound, offers });
    expect(v(1_500, 500)).toEqual([]);
    expect(v(1_501, 500).map((a) => [a.kind, a.key])).toEqual([
      ["inbound_volume", `inbound:${FIRM}`],
    ]);
    expect(v(1_500, 501).map((a) => [a.kind, a.key])).toEqual([["offer_volume", `offers:${FIRM}`]]);
    expect(v(1_501, 501).map((a) => a.text)).toEqual([
      "ShiftDesk alert: acme: 1501 messages came in to the shifts line in the last hour, far more than a firm's busiest. A big event can do that; if not, something may be flooding the line.",
      "ShiftDesk alert: acme: 501 offers went out in the last hour, far more than usual. Check the firm's wave settings, and for a shift reopening again and again.",
    ]);
  });

  it("a firm named by a slug that looks like a number is named by its id in these too", () => {
    const slug = "07700900123";
    expect(aiFallbackAlert({ firmId: FIRM, slug, asked: 20, fellBack: 20 })?.text).toContain(
      "firm 0f8fad5b:",
    );
    expect(volumeAlerts({ firmId: FIRM, slug, inbound: 9_999, offers: 0 })[0]?.text).toContain(
      "firm 0f8fad5b:",
    );
  });
});

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
