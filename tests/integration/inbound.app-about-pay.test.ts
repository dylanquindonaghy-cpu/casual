import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeAi, type AiClient, type AiRequest } from "@/lib/ai/client";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { receiveAppMessage } from "@/lib/inbound/app";
import { runInboundMessage } from "@/lib/inbound/reply";
import { loadEnquiries, loadEnquiry } from "@/lib/office/enquiries";
import { sortedStep } from "@/lib/office/enquiries-copy";
import { readMessageAboutPay } from "@/lib/portal/message-office";
import { MESSAGE_OFFICE } from "@/lib/portal/pay-copy";
import { PROBLEM_LINKS } from "@/lib/portal/pay-query-kinds";
import { captureTransport } from "../helpers/auth";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The guardrails review of 28.10, on the real database as the app role: Pay's "Message the office"
// (no way to send her a code) and the pay query's too_old "message the office" both open Messages
// about her pay (/messages?about=pay). What she sends from there is never sorted: no keyword (her
// words say "pay"), no AI, and never the automatic pay link, which points back to the Pay page that
// sent her (a loop: the pay can't open, or the pay query refuses a question that old). It is a
// request for the office, waiting for a person on Enquiries, logged with ids only. The same words
// sent without it still get the pay link, as before. Nothing goes by WhatsApp, text or email.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const SECRET = "test-session-secret-for-app-about-pay-0123456789";

// What Messages reads from a link's address (src/app/messages/page.tsx).
const aboutPayFrom = (href: string) => {
  const q = new URL(href, "https://acme.shiftdesk.test").searchParams;
  return readMessageAboutPay({
    ...(q.has("shift") ? { shift: q.get("shift") ?? "" } : {}),
    ...(q.has("about") ? { about: q.get("about") ?? "" } : {}),
  });
};

async function setup() {
  const f = await bookingFirm(su, withFirm);
  const kay = await f.worker({ first: "Kay" });
  const line = captureTransport();
  const asked: AiRequest[] = [];
  const ai: AiClient = createFakeAi((r) => {
    asked.push(r);
    return "pay";
  });
  const at = { firmId: f.firmId, run: withFirm, secret: SECRET, clock: { now: () => NOW } };
  const ask = async (text: string, aboutPay?: boolean) => {
    const sent = await receiveAppMessage(at, kay, text, randomUUID(), null, aboutPay);
    if (sent.status !== "sent") throw new Error(`not sent: ${sent.status}`);
    const result = await runInboundMessage(
      { firmId: f.firmId, messageId: sent.messageId, idempotencyKey: `x:${sent.messageId}` },
      withFirm,
      {
        transport: line.transport,
        ai,
        baseDomain: "shiftdesk.test",
        aiTimeoutMs: 200,
        clock: { now: () => NOW },
      },
    );
    return { id: sent.messageId, result };
  };
  const repliesTo = async (messageId: string) =>
    (
      await su.query<{ body: string }>("select body from messages where reply_to = $1", [messageId])
    ).rows.map((r) => r.body);
  const questionOf = async (messageId: string) =>
    (
      await su.query<{ id: string; type: string; status: string; payload: unknown }>(
        "select id::text as id, type, status, payload from requests where message_id = $1",
        [messageId],
      )
    ).rows[0];
  const eventsAbout = async (entityId: string) =>
    (
      await su.query<{ action: string; data: Record<string, unknown> }>(
        "select action, data from events where firm_id = $1 and entity_id = $2 order by id",
        [f.firmId, entityId],
      )
    ).rows;
  return { f, kay, line, asked, ask, repliesTo, questionOf, eventsAbout };
}

describe("Pay's 'Message the office' opens Messages about her pay", () => {
  it("both links: no code sender, and a pay question older than 90 days", () => {
    expect(MESSAGE_OFFICE.href).toBe("/messages?about=pay");
    expect(PROBLEM_LINKS.too_old?.href).toBe("/messages?about=pay");
    expect(aboutPayFrom(MESSAGE_OFFICE.href)).toBe(true);
    expect(aboutPayFrom(PROBLEM_LINKS.too_old?.href ?? "")).toBe(true);
    // Plain Messages is not about her pay.
    expect(aboutPayFrom("/messages")).toBe(false);
  });
});

describe("a message sent about her pay", () => {
  for (const [from, href, text] of [
    ["no code sender", MESSAGE_OFFICE.href, "I can't open my pay. Was I paid for Saturday?"],
    [
      "too old",
      PROBLEM_LINKS.too_old?.href ?? "",
      "I wasn't paid for my shift on 2 June, my wages were short",
    ],
  ] as const) {
    it(`from ${from}: a request for the office, never sorted, no automatic pay reply`, async () => {
      const t = await setup();
      const { id, result } = await t.ask(text, aboutPayFrom(href));
      expect(result).toEqual({
        status: "held",
        intent: "office",
        sortedAs: "office",
        handledAs: "office",
      });
      // Not the keyword, not the AI, and no answer of any kind (never the /pay link).
      expect(t.asked).toHaveLength(0);
      expect(await t.repliesTo(id)).toEqual([]);
      expect(t.line.sent).toEqual([]);
      const { rows: m } = await su.query<{ handled_as: string; intent: string }>(
        "select handled_as, intent from messages where id = $1",
        [id],
      );
      expect(m[0]).toEqual({ handled_as: "office", intent: "office" });

      // The office's question, logged with ids only (golden rule 5).
      const q = await t.questionOf(id);
      expect(q).toMatchObject({
        type: "general",
        status: "open",
        payload: { note: text, via: "app" },
      });
      expect(await t.eventsAbout(q?.id ?? "")).toEqual([
        {
          action: "request.created",
          data: { type: "general", shiftId: null, via: "app", workerId: t.kay },
        },
      ]);
      expect(await t.eventsAbout(id)).toEqual([
        {
          action: "message.received",
          data: {
            channel: "app",
            handledAs: "office",
            intent: "office",
            aboutPay: true,
            workerId: t.kay,
          },
        },
      ]);
      expect(JSON.stringify(await t.eventsAbout(id))).not.toContain("paid");

      // Enquiries: waiting for a person, and says why it wasn't sorted.
      const person = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "person", new Date()));
      expect(person.rows.map((r) => [r.messageId, r.outcome])).toEqual([[id, "person_waiting"]]);
      const e = await withFirm(t.f.firmId, (tx) => loadEnquiry(tx, id, new Date()));
      expect(e?.timeline.sorted).toEqual({ how: "about_pay" });
      expect(e && sortedStep(e.timeline.sorted)).toBe(
        "About their pay, sent from the Pay page: passed to a person, never sorted.",
      );
      expect(e?.waiting).toBe(true);
    });
  }

  it("the same words sent from plain Messages still get the pay link, as before", async () => {
    const t = await setup();
    const { id, result } = await t.ask("I wasn't paid for my shift on 2 June");
    expect(result).toEqual({ status: "replied", intent: "pay", handledAs: "keyword" });
    expect((await t.repliesTo(id))[0]).toContain("/pay");
    expect(await t.questionOf(id)).toBeUndefined();
  });

  it("her next message, from plain Messages, is sorted as any other", async () => {
    const t = await setup();
    await t.ask("Was I paid for Saturday?", true);
    const next = await t.ask("Was I paid for Sunday?");
    expect(next.result).toEqual({ status: "replied", intent: "pay", handledAs: "keyword" });
  });
});
