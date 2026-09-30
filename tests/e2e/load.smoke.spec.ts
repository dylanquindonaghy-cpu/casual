import { randomBytes } from "node:crypto";
import { twilioSignature } from "../../src/lib/inbound/twilio-signature";
import { E2E_TWILIO_AUTH_TOKEN } from "../../playwright.config";
import { answeredMessages } from "./db";
import { expect, test } from "./fixtures";

// Pre-pilot load smoke (docs/testing.md "Pre-pilot checklist"): 200 WhatsApps to Acme's shifts line
// in under a minute, signed as Twilio signs them, through the real web app and the real worker.
// Every webhook is answered at once (store, queue, 200: golden rule 3), and the queue doesn't back
// up: every message has its reply within a minute of the last one arriving. Seeded Acme workers no
// other spec uses (07700 900128-900137 and 900140-900156), each asking for shifts. One webhook first,
// not counted, so a first compile (next dev) doesn't count against the timings.

const webhook = "http://localhost:3100/api/webhooks/twilio/whatsapp";
const acmeLine = "+447700900000";
const workers = [
  ...Array.from({ length: 10 }, (_, i) => 128 + i),
  ...Array.from({ length: 17 }, (_, i) => 140 + i),
].map((n) => `+447700900${n}`);
const TOTAL = 200;
const AT_ONCE = 10;

test("200 WhatsApps in under a minute: each webhook answered at once, every reply within a minute after", async ({
  request,
}) => {
  test.setTimeout(180_000);
  const ids = Array.from({ length: TOTAL }, () => `SM${randomBytes(16).toString("hex")}`);
  const post = (sid: string, from: string) => {
    const fields = {
      MessageSid: sid,
      From: `whatsapp:${from}`,
      To: `whatsapp:${acmeLine}`,
      Body: "Any shifts?",
      NumMedia: "0",
    };
    return request.post(webhook, {
      form: fields,
      headers: { "x-twilio-signature": twilioSignature(E2E_TWILIO_AUTH_TOKEN, webhook, fields) },
    });
  };
  const warmUpId = `SM${randomBytes(16).toString("hex")}`;
  expect((await post(warmUpId, workers[0] ?? "")).status()).toBe(200);
  const timings: number[] = [];
  const statuses: number[] = [];
  const started = Date.now();
  for (let i = 0; i < TOTAL; i += AT_ONCE) {
    await Promise.all(
      ids.slice(i, i + AT_ONCE).map(async (sid, j) => {
        const t0 = Date.now();
        const res = await post(sid, workers[(i + j) % workers.length] ?? "");
        timings.push(Date.now() - t0);
        statuses.push(res.status());
      }),
    );
  }
  const sentIn = Date.now() - started;
  const sorted = [...timings].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  console.log(
    `load smoke: ${TOTAL} webhooks in ${sentIn} ms, p95 ${p95} ms, max ${sorted.at(-1)} ms`,
  );
  expect(statuses.filter((s) => s !== 200)).toEqual([]);
  expect(sentIn).toBeLessThan(60_000);
  expect(p95).toBeLessThan(2_000);

  // The queue drains: every message answered within a minute of the last one arriving.
  const drainStarted = Date.now();
  let answered = 0;
  while (Date.now() - drainStarted < 60_000) {
    answered = await answeredMessages("acme", ids);
    if (answered === TOTAL) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  console.log(
    `load smoke: ${answered} of ${TOTAL} answered ${Date.now() - drainStarted} ms after the last`,
  );
  expect(answered).toBe(TOTAL);
});
