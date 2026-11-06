import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeAi, type AiClient, type AiRequest } from "@/lib/ai/client";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { receiveAppMessage } from "@/lib/inbound/app";
import { APP_REPLIES_PER_HOUR, runInboundMessage } from "@/lib/inbound/reply";
import { loadEnquiries, loadEnquiry } from "@/lib/office/enquiries";
import { sortedStep } from "@/lib/office/enquiries-copy";
import { messageAboutShift, messageKeptShift } from "@/lib/portal/messages";
import { captureTransport } from "../helpers/auth";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Message the office about a shift (Phase 28.6; docs/screens.md "### 28.6"; docs/messaging-templates.md
// "Messages in the app"), on the real database as the app role. A casual's message in the app that
// kept its session (src/lib/inbound/app.ts: hers or shown to casuals, not ended) is never sorted:
// no keyword, no AI (the AI stub counts zero calls) and no automatic answer; it waits for a person
// on Enquiries, whose page names the session ("About: …"), and its log entry carries ids only. A
// worked shift's pay question keeps no session and is sorted as today, towards the pay query
// (golden rule 9). Another firm's session, a hidden one and another casual's hidden booking are
// ignored, as on Messages' About line (messageAboutShift). The limits are unchanged. Nothing goes
// by WhatsApp, text or email: the capturing transport stays empty.

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

const SECRET = "test-session-secret-for-app-about-shift-0123456789";
const APP_AUTOMATIC = "Automatic reply.";

async function setup() {
  const f = await bookingFirm(su, withFirm);
  const kay = await f.worker({ first: "Kay" });
  const { rows } = await su.query<{ slug: string; name: string }>(
    "select slug, name from firms where id = $1",
    [f.firmId],
  );
  const slug = rows[0]?.slug ?? "";
  const name = rows[0]?.name ?? "";
  const line = captureTransport();
  // The AI stub: every request it's asked, answering "pay".
  const asked: AiRequest[] = [];
  const ai: AiClient = createFakeAi((r) => {
    asked.push(r);
    return "pay";
  });
  const at = { firmId: f.firmId, run: withFirm, secret: SECRET, clock: { now: () => NOW } };
  const send = (text: string, shiftId?: string | null, workerId = kay) =>
    receiveAppMessage(at, workerId, text, randomUUID(), shiftId);
  const answer = (messageId: string) =>
    runInboundMessage(
      { firmId: f.firmId, messageId, idempotencyKey: `inbound-message:${messageId}` },
      withFirm,
      {
        transport: line.transport,
        ai,
        baseDomain: "shiftdesk.test",
        aiTimeoutMs: 200,
        clock: { now: () => NOW },
      },
    );
  // Sent, then the job answers it. Returns the message's id and the job's result.
  const ask = async (text: string, shiftId?: string | null, workerId = kay) => {
    const sent = await send(text, shiftId, workerId);
    if (sent.status !== "sent") throw new Error(`not sent: ${sent.status}`);
    return { id: sent.messageId, result: await answer(sent.messageId) };
  };
  const tagOf = async (messageId: string) =>
    (
      await su.query<{ shift_id: string | null }>(
        "select shift_id::text as shift_id from messages where id = $1",
        [messageId],
      )
    ).rows[0]?.shift_id ?? null;
  const repliesTo = async (messageId: string) =>
    (
      await su.query<{ body: string; channel: string }>(
        "select body, channel from messages where reply_to = $1",
        [messageId],
      )
    ).rows;
  const eventsAbout = async (messageId: string) =>
    (
      await su.query<{ action: string; actor_type: string; data: Record<string, unknown> }>(
        "select action, actor_type, data from events where firm_id = $1 and entity_id = $2 order by id",
        [f.firmId, messageId],
      )
    ).rows;
  const questionOf = async (messageId: string) =>
    (
      await su.query<{
        id: string;
        type: string;
        status: string;
        payload: Record<string, unknown>;
        shift_id: string | null;
      }>(
        `select id::text as id, type, status, payload, shift_id::text as shift_id
           from requests where message_id = $1`,
        [messageId],
      )
    ).rows[0];
  const portal = { firm: { id: f.firmId }, run: withFirm, clock: { now: () => NOW } };
  return {
    f,
    kay,
    slug,
    name,
    line,
    asked,
    send,
    ask,
    tagOf,
    repliesTo,
    eventsAbout,
    questionOf,
    portal,
  };
}

describe("a message in the app about a session that hasn't ended", () => {
  it("keeps the session, is never sorted or answered automatically, and waits for a person on Enquiries, named", async () => {
    const t = await setup();
    const booked = await t.f.shift({ role: "steward", startsAt: hoursFromNow(20) });
    await t.f.booking(t.kay, booked);

    // "pay" is a keyword: about a session, it isn't matched, and the AI isn't asked.
    const { id, result } = await t.ask("What's the pay for this shift?", booked);
    expect(await t.tagOf(id)).toBe(booked);
    expect(result).toEqual({
      status: "held",
      intent: "office",
      sortedAs: "office",
      handledAs: "office",
    });
    expect(t.asked).toHaveLength(0);
    // No automatic answer of any kind (not the pay link, not "The office will see this…"), and
    // nothing by WhatsApp, text or email.
    expect(await t.repliesTo(id)).toEqual([]);
    expect(t.line.sent).toEqual([]);
    const { rows: m } = await su.query<{ handled_as: string; intent: string }>(
      "select handled_as, intent from messages where id = $1",
      [id],
    );
    expect(m[0]).toEqual({ handled_as: "office", intent: "office" });

    // The office's question, as any other for a person (Enquiries answers it with its message).
    const q = await t.questionOf(id);
    expect(q).toMatchObject({
      type: "general",
      status: "open",
      payload: { note: "What's the pay for this shift?", via: "app" },
    });
    // The log: ids only, never her words (golden rule 5), naming the session.
    expect(await t.eventsAbout(id)).toEqual([
      {
        action: "message.received",
        actor_type: "worker",
        data: {
          channel: "app",
          handledAs: "office",
          intent: "office",
          shiftId: booked,
          workerId: t.kay,
        },
      },
    ]);
    const logged = JSON.stringify(await t.eventsAbout(id));
    expect(logged).not.toContain("pay for this shift");

    // Enquiries: in Need a person, in the app; its page names the session.
    const person = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "person", new Date()));
    expect(person.rows.map((r) => [r.messageId, r.channel, r.outcome])).toEqual([
      [id, "app", "person_waiting"],
    ]);
    const e = await withFirm(t.f.firmId, (tx) => loadEnquiry(tx, id, new Date()));
    expect(e?.about).toEqual({ shiftId: booked, role: "steward", startsAt: hoursFromNow(20) });
    expect(e?.waiting).toBe(true);
    expect(e?.pay).toBe(false);
    expect(e?.outcome).toBe("person_waiting");
    expect(e?.timeline.sorted).toEqual({ how: "about_shift" });
    expect(e && sortedStep(e.timeline.sorted)).toBe(
      "About a session: passed to a person, never sorted.",
    );
    expect(e?.timeline.reply).toEqual({ how: "none" });
    expect(e?.timeline.sent).toEqual({ how: "none" });
    expect(e?.plan).toEqual({ ok: true, channel: "app", form: "free_text" });
    expect(e?.conversation.map((c) => [c.direction, c.text])).toEqual([
      ["in", "What's the pay for this shift?"],
    ]);
    // Not on the Pay view: it isn't a pay message, whatever its words.
    const payView = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "pay", new Date()));
    expect(payView.rows.map((r) => r.messageId)).not.toContain(id);
  });

  it("running late, a session that has started, and an open session she can see: each a person's, the AI never asked", async () => {
    const t = await setup();
    const booked = await t.f.shift({ role: "steward", startsAt: hoursFromNow(3) });
    await t.f.booking(t.kay, booked);
    const started = await t.f.shift({ startsAt: hoursFromNow(-2) }); // 8 hours: still on
    await t.f.booking(t.kay, started);
    const open = await t.f.shift({ startsAt: hoursFromNow(30) });

    for (const [text, shiftId] of [
      ["I'm running late. I'll be there about 10:45", booked],
      ["This shift has started and I need to talk to someone.", started],
      // No keyword: without the session, the AI would sort it.
      ["How much is this one an hour?", open],
      // "cancel" is a keyword: about a session, it isn't matched either.
      ["Can I cancel this one?", open],
    ] as const) {
      const { id, result } = await t.ask(text, shiftId);
      expect(await t.tagOf(id), text).toBe(shiftId);
      expect(result, text).toMatchObject({ status: "held", intent: "office", handledAs: "office" });
      expect(await t.repliesTo(id), text).toEqual([]);
      const e = await withFirm(t.f.firmId, (tx) => loadEnquiry(tx, id, new Date()));
      expect(e?.about?.shiftId, text).toBe(shiftId);
      expect(e?.waiting, text).toBe(true);
    }
    expect(t.asked).toHaveLength(0);
    expect(t.line.sent).toEqual([]);
  });
});

describe("a pay question about a worked shift (golden rule 9)", () => {
  it("'I wasn't paid for this shift' with about=pay on a worked shift: no session, sorted as today, the pay link", async () => {
    const t = await setup();
    const worked = await t.f.shift({ role: "steward", startsAt: hoursFromNow(-30) });
    await t.f.booking(t.kay, worked, "completed");
    // Messages shows no About line for it either.
    expect(await messageAboutShift(t.portal, t.kay, worked)).toBeNull();

    const { id, result } = await t.ask("I wasn't paid for this shift", worked);
    expect(await t.tagOf(id)).toBeNull();
    expect(result).toEqual({ status: "replied", intent: "pay", handledAs: "keyword" });
    expect((await t.repliesTo(id)).map((r) => r.body)).toEqual([
      `Your hours, rates and pay dates: https://${t.slug}.shiftdesk.test/pay (you'll get a code to log in). If something looks wrong, tap 'Raise a pay query' there, so payroll sees it. ${APP_AUTOMATIC} — ${t.name} Shift Team`,
    ]);
    // Never the office's question: payroll's pay query is the way.
    expect(await t.questionOf(id)).toBeUndefined();
    expect((await t.eventsAbout(id))[0]?.data).toEqual({
      channel: "app",
      handledAs: "keyword",
      intent: "pay",
      workerId: t.kay,
    });

    // No keyword: the sorter runs as today (the AI is asked, with her words only).
    const sorted = await t.ask("short changed on this one", worked);
    expect(await t.tagOf(sorted.id)).toBeNull();
    expect(sorted.result).toEqual({ status: "replied", intent: "pay", handledAs: "ai" });
    expect(t.asked.map((r) => r.prompt)).toEqual(["short changed on this one"]);
    expect((await t.repliesTo(sorted.id))[0]?.body).toContain("Raise a pay query");
    expect(t.line.sent).toEqual([]);
  });
});

describe("without a session it may name", () => {
  it("'What's the pay for this shift?' with no session is answered as today: the pay link", async () => {
    const t = await setup();
    const { id, result } = await t.ask("What's the pay for this shift?");
    expect(await t.tagOf(id)).toBeNull();
    expect(result).toEqual({ status: "replied", intent: "pay", handledAs: "keyword" });
    expect((await t.repliesTo(id))[0]?.body).toContain(`https://${t.slug}.shiftdesk.test/pay`);
  });

  it("another firm's session, a hidden one and another casual's hidden booking are ignored: sorted as today, and no About line", async () => {
    const t = await setup();
    const other = await setup();
    const theirs = await other.f.shift({ startsAt: hoursFromNow(20) });
    const hiddenEvent = await t.f.event({ name: "Private", showing: false });
    const hidden = await t.f.shift({ startsAt: hoursFromNow(20), eventId: hiddenEvent });
    const lee = await t.f.worker({ first: "Lee" });
    const leesHidden = await t.f.shift({ startsAt: hoursFromNow(22), eventId: hiddenEvent });
    await t.f.booking(lee, leesHidden);

    for (const shiftId of [theirs, hidden, leesHidden]) {
      expect(await messageAboutShift(t.portal, t.kay, shiftId)).toBeNull();
      const { id, result } = await t.ask("What's the pay for this shift?", shiftId);
      expect(await t.tagOf(id)).toBeNull();
      expect(result).toEqual({ status: "replied", intent: "pay", handledAs: "keyword" });
      const e = await withFirm(t.f.firmId, (tx) => loadEnquiry(tx, id, new Date()));
      expect(e?.about).toBeNull();
    }
    // Lee's own hidden booking is his to name. Kay's message about a session is her firm's alone:
    // another firm's office can't open it, nor see it in Need a person.
    expect(await messageAboutShift(t.portal, lee, leesHidden)).toMatchObject({
      shiftId: leesHidden,
    });
    const { id: kays } = await t.ask("Is there parking?", await t.f.shift());
    const elsewhere = await withFirm(other.f.firmId, (tx) => loadEnquiry(tx, kays, new Date()));
    expect(elsewhere).toBeNull();
    const otherPerson = await withFirm(other.f.firmId, (tx) =>
      loadEnquiries(tx, "person", new Date()),
    );
    expect(otherPerson.rows).toEqual([]);
  });

  it("Messages' About line: her booked session and one she can see; nothing for a cancelled or draft one", async () => {
    const t = await setup();
    const booked = await t.f.shift({ role: "steward", startsAt: hoursFromNow(20) });
    await t.f.booking(t.kay, booked);
    const open = await t.f.shift({ role: "door_supervisor", startsAt: hoursFromNow(40) });
    const cancelled = await t.f.shift({ startsAt: hoursFromNow(40), status: "cancelled" });
    const draft = await t.f.shift({ startsAt: hoursFromNow(40), status: "draft" });
    expect(await messageAboutShift(t.portal, t.kay, booked)).toEqual({
      shiftId: booked,
      role: "steward",
      startsAt: hoursFromNow(20),
    });
    expect(await messageAboutShift(t.portal, t.kay, open)).toMatchObject({
      shiftId: open,
      role: "door_supervisor",
    });
    expect(await messageAboutShift(t.portal, t.kay, cancelled)).toBeNull();
    expect(await messageAboutShift(t.portal, t.kay, draft)).toBeNull();
  });
});

describe('"Sent" says what the send kept', () => {
  it("kept: the office will answer; a shift that ended before she tapped Send, or none: the usual words; not hers or another firm's: not kept", async () => {
    const t = await setup();
    const booked = await t.f.shift({ role: "steward", startsAt: hoursFromNow(20) });
    await t.f.booking(t.kay, booked);
    // Booked, 8 hours from 8h15 ago: it ends 15 minutes before she taps Send.
    const ending = await t.f.shift({ startsAt: hoursFromNow(-8.25) });
    await t.f.booking(t.kay, ending);
    // Half an hour earlier, Messages opened about it with its About line.
    const opened = { ...t.portal, clock: { now: () => hoursFromNow(-0.5) } };
    expect(await messageAboutShift(opened, t.kay, ending)).toMatchObject({ shiftId: ending });

    const sentId = async (text: string, shiftId?: string) => {
      const sent = await t.send(text, shiftId);
      if (sent.status !== "sent") throw new Error(`not sent: ${sent.status}`);
      return sent.messageId;
    };
    const kept = await sentId("I'm running late. I'll be there about 10:45", booked);
    const ended = await sentId("This shift has started and I need to talk to someone.", ending);
    const plain = await sentId("Is there parking?");

    expect(await messageKeptShift(t.portal, t.kay, kept)).toBe(true);
    // The shift ended in between: the send kept nothing, so the message is sorted as any other and
    // the page says "Sent. The answer comes here.", not "The office will answer here."
    expect(await t.tagOf(ended)).toBeNull();
    expect(await messageKeptShift(t.portal, t.kay, ended)).toBe(false);
    expect(await messageKeptShift(t.portal, t.kay, plain)).toBe(false);
    // Another casual's message, or another firm's (RLS), reads as not kept.
    const lee = await t.f.worker({ first: "Lee" });
    expect(await messageKeptShift(t.portal, lee, kept)).toBe(false);
    const other = await setup();
    expect(await messageKeptShift(other.portal, t.kay, kept)).toBe(false);
  });
});

describe("the limits are unchanged", () => {
  it(`messages about a session count towards the 20 an hour, take none of the ${APP_REPLIES_PER_HOUR} automatic answers, and past those answers one is still a person's`, async () => {
    const t = await setup();
    const booked = await t.f.shift({ startsAt: hoursFromNow(20) });
    await t.f.booking(t.kay, booked);

    // The hour's 5 automatic answers, then a 6th untagged message waits (as before).
    for (let i = 0; i < APP_REPLIES_PER_HOUR; i += 1) {
      expect((await t.ask(`pay ${i}`)).result).toMatchObject({ status: "replied" });
    }
    const sixth = await t.ask("pay again");
    expect(sixth.result).toEqual({
      status: "held",
      intent: "office",
      sortedAs: "pay",
      handledAs: "keyword",
    });
    expect((await t.eventsAbout(sixth.id))[0]?.data).toMatchObject({ replyLimit: true });
    // About a session: a person's for its own reason, never logged as the limit.
    const tagged = await t.ask("I'm running late. I'll be there about 10:45", booked);
    expect((await t.eventsAbout(tagged.id))[0]?.data).toEqual({
      channel: "app",
      handledAs: "office",
      intent: "office",
      shiftId: booked,
      workerId: t.kay,
    });
    const e = await withFirm(t.f.firmId, (tx) => loadEnquiry(tx, tagged.id, new Date()));
    expect(e?.timeline.sorted).toEqual({ how: "about_shift" });

    // 20 sends an hour, tagged or not: 7 so far, 13 more, then refused.
    for (let i = 0; i < 13; i += 1) {
      expect((await t.send(`About Saturday ${i}`, booked)).status).toBe("sent");
    }
    expect(await t.send("one more", booked)).toMatchObject({ status: "rate_limited" });
  });
});
