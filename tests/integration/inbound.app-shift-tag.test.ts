import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noAi } from "@/lib/ai/client";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { receiveAppMessage } from "@/lib/inbound/app";
import { runInboundMessage } from "@/lib/inbound/reply";
import { captureTransport } from "../helpers/auth";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { inFirm, pgError } from "../helpers/rls-probe";

// A casual's message in the app about a session (Phase 28.2; src/lib/inbound/app.ts): the session
// is kept on the row only for one she's booked on or can see that hasn't ended, checked inside the
// insert's own transaction. Anything else is stored with no session and sorted as any other
// message (a pay question about a worked shift gets the pay link). The database keeps a session
// off every row but her own message in the app (messages_shift_app_only).

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

const SECRET = "test-session-secret-for-app-shift-tags-0123456789";

async function setup() {
  const f = await bookingFirm(su, withFirm);
  const kay = await f.worker({ first: "Kay" });
  const at = (now = NOW) => ({
    firmId: f.firmId,
    run: withFirm,
    secret: SECRET,
    clock: { now: () => now },
  });
  const send = (text: string, shiftId?: string | null, now = NOW) =>
    receiveAppMessage(at(now), kay, text, randomUUID(), shiftId);
  const tagOf = async (messageId: string) =>
    (
      await su.query<{ shift_id: string | null }>(
        "select shift_id::text as shift_id from messages where id = $1",
        [messageId],
      )
    ).rows[0]?.shift_id ?? null;
  return { f, kay, send, tagOf };
}

const sentId = (outcome: Awaited<ReturnType<typeof receiveAppMessage>>) => {
  if (outcome.status !== "sent") throw new Error(`not sent: ${outcome.status}`);
  return outcome.messageId;
};

describe("receiveAppMessage with a session", () => {
  it("keeps the session she's booked on that hasn't ended, and one shown to casuals", async () => {
    const t = await setup();
    const booked = await t.f.shift({ startsAt: hoursFromNow(20) });
    await t.f.booking(t.kay, booked);
    const started = await t.f.shift({ startsAt: hoursFromNow(-2) }); // 8 hours: still on
    await t.f.booking(t.kay, started);
    const open = await t.f.shift({ startsAt: hoursFromNow(30) });

    expect(await t.tagOf(sentId(await t.send("What's the pay for this shift?", booked)))).toBe(
      booked,
    );
    expect(await t.tagOf(sentId(await t.send("This shift has started.", started)))).toBe(started);
    expect(await t.tagOf(sentId(await t.send("Is there parking?", open)))).toBe(open);
  });

  it("stores no session for another firm's, a hidden one, an ended one, a cancelled one or a draft", async () => {
    const t = await setup();
    const other = await setup();
    const theirs = await other.f.shift({ startsAt: hoursFromNow(20) });
    const hiddenEvent = await t.f.event({ name: "Private", showing: false });
    const hidden = await t.f.shift({ startsAt: hoursFromNow(20), eventId: hiddenEvent });
    const ended = await t.f.shift({ startsAt: hoursFromNow(-30) });
    await t.f.booking(t.kay, ended, "completed");
    const cancelled = await t.f.shift({ startsAt: hoursFromNow(40), status: "cancelled" });
    const draft = await t.f.shift({ startsAt: hoursFromNow(40), status: "draft" });

    for (const shiftId of [theirs, hidden, ended, cancelled, draft, "not-an-id", null]) {
      expect(await t.tagOf(sentId(await t.send("Hello", shiftId)))).toBeNull();
    }
    // Booked on a hidden session: still hers, so kept.
    const hiddenBooked = await t.f.shift({ startsAt: hoursFromNow(22), eventId: hiddenEvent });
    await t.f.booking(t.kay, hiddenBooked);
    expect(await t.tagOf(sentId(await t.send("Where do I go?", hiddenBooked)))).toBe(hiddenBooked);
  });

  it("a pay question about an ended session is sorted as today: the pay link, no session", async () => {
    const t = await setup();
    const ended = await t.f.shift({ startsAt: hoursFromNow(-30) });
    await t.f.booking(t.kay, ended, "completed");
    const id = sentId(await t.send("my pay is wrong for this shift", ended));
    expect(await t.tagOf(id)).toBeNull();
    const line = captureTransport();
    const result = await runInboundMessage(
      { firmId: t.f.firmId, messageId: id, idempotencyKey: `inbound-message:${id}` },
      withFirm,
      { transport: line.transport, ai: noAi, baseDomain: "shiftdesk.test", aiTimeoutMs: 200 },
    );
    expect(result).toEqual({ status: "replied", intent: "pay", handledAs: "keyword" });
    const { rows } = await su.query<{ body: string }>(
      "select body from messages where reply_to = $1",
      [id],
    );
    expect(rows[0]?.body).toContain("/pay");
    expect(rows[0]?.body).toContain("Raise a pay query");
  });
});

describe("messages_shift_app_only", () => {
  it("refuses a session on a WhatsApp, a text or an answer; allows it on her own message in the app", async () => {
    const t = await setup();
    const shift = await t.f.shift({ startsAt: hoursFromNow(20) });
    const insert = (direction: string, channel: string) =>
      inFirm(app, t.f.firmId, (c) =>
        c.query(
          `insert into messages (firm_id, direction, channel, provider_message_id, worker_id,
                                 from_e164, to_e164, body, shift_id)
           values ($1, $2, $3, $4, $5, $6, $7, 'About Saturday', $8)`,
          [
            t.f.firmId,
            direction,
            channel,
            `p28-${randomUUID()}`,
            t.kay,
            channel === "app" ? null : direction === "in" ? "+447700900321" : "+447700900000",
            channel === "app" ? null : direction === "in" ? "+447700900000" : "+447700900321",
            shift,
          ],
        ),
      );
    for (const [direction, channel] of [
      ["in", "whatsapp"],
      ["in", "sms"],
      ["out", "sms"],
      ["out", "app"],
    ] as const) {
      expect(await pgError(insert(direction, channel))).toMatchObject({
        code: "23514",
        message: expect.stringContaining("messages_shift_app_only"),
      });
    }
    await expect(insert("in", "app")).resolves.toMatchObject({ rowCount: 1 });
  });
});
