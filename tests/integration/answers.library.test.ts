import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createFakeAi, noAi, type AiClient, type AiRequest } from "@/lib/ai/client";
import {
  createAnswer,
  listAnswers,
  questionsWithNoAnswer,
  setAnswerSwitch,
  switchAnswer,
  updateAnswer,
} from "@/lib/answers/office";
import { addStarterAnswers, STARTERS } from "@/lib/answers/starters";
import type { Clock } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { receiveEmail } from "@/lib/email/receive";
import { runInboundEmail } from "@/lib/email/sort";
import { receiveAppMessage } from "@/lib/inbound/app";
import { receiveSms } from "@/lib/inbound/receive";
import { runInboundMessage } from "@/lib/inbound/reply";
import { passesLogCheck } from "@/lib/events/record";
import { ANSWER_PAY_HINT, AUTOMATIC_REPLY } from "@/lib/messaging/templates";
import { portalUrl } from "@/lib/tenancy/portal-url";
import { captureTransport } from "../helpers/auth";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The answer library (Phase 35.1, 35.2) on the real database as the app role: the table, its
// starters and the office's writes (each logged, ids only); the three switches through
// app_set_firm_setting(); and the match and the reply on texts, the app and the staffing email, with
// a fake AI and a sender that only records. Made-up people, numbers and addresses only.

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

const SECRET = "test-session-secret-for-the-answer-library-0123";
const sid = () => `SM${randomBytes(16).toString("hex")}`;

let nextLine = Math.floor(Math.random() * 300);
async function freshLine(): Promise<string> {
  nextLine = (nextLine + 1) % 300;
  const line = `+447700900${300 + nextLine}`;
  await su.query("update firms set shifts_line_e164 = null where shifts_line_e164 = $1", [line]);
  return line;
}

// A fake AI giving one label, recording what it was asked.
function fakeAi(label: string): { ai: AiClient; asked: AiRequest[] } {
  const asked: AiRequest[] = [];
  const ai = createFakeAi((r) => {
    asked.push(r);
    return r.purpose === "classify_message" ? label : "Thanks.";
  });
  return { ai, asked };
}

type SeedAnswer = { name: string; examples: string; body: string; on?: boolean };
const PARKING: SeedAnswer = {
  name: "Parking",
  examples: "where do i park\nis there parking",
  body: "Park at the back. Gate C.",
};

async function libraryFirm(
  o: {
    settings?: Record<string, unknown>;
    answers?: { name: string; examples: string; body: string; on?: boolean }[];
  } = {},
) {
  const f = await bookingFirm(su, withFirm, {
    settings: o.settings ?? {
      auto_replies: true,
      answers: { app: true, texts: true, email: true },
    },
  });
  const line = await freshLine();
  await su.query("update firms set shifts_line_e164 = $2 where id = $1", [f.firmId, line]);
  const ann = await f.worker({ first: "Ann" });
  const inbox = `staffing-${randomBytes(4).toString("hex")}@inbound.example.test`;
  const address = `ann.${randomBytes(3).toString("hex")}@example.com`;
  await su.query("update firms set inbox_address = $2 where id = $1", [f.firmId, inbox]);
  await su.query("update workers set email = $2 where id = $1", [ann, address]);
  const { rows } = await su.query<{ mobile: string; slug: string; name: string }>(
    `select w.mobile_e164 as mobile, f.slug, f.name from workers w join firms f on f.id = w.firm_id
      where w.id = $1`,
    [ann],
  );
  const { mobile = "", slug = "", name = "" } = rows[0] ?? {};
  const ids: Record<string, string> = {};
  for (const a of o.answers ?? [PARKING]) {
    const { rows: made } = await su.query<{ id: string }>(
      `insert into answers (firm_id, name, examples, body, is_on) values ($1, $2, $3, $4, $5)
       returning id::text as id`,
      [f.firmId, a.name, a.examples, a.body, a.on ?? true],
    );
    ids[a.name] = made[0]?.id ?? "";
  }
  const line_ = captureTransport();
  const deps = (ai: AiClient = noAi) => ({
    transport: line_.transport,
    ai,
    baseDomain: "shiftdesk.test",
    aiTimeoutMs: 200,
  });
  const run = (messageId: string, ai?: AiClient) =>
    runInboundMessage(
      { firmId: f.firmId, messageId, idempotencyKey: `inbound-message:${messageId}` },
      withFirm,
      deps(ai),
    );
  // A text to the shifts line, answered by the job.
  const text = async (body: string, ai?: AiClient) => {
    const messageSid = sid();
    await receiveSms(
      f.firmId,
      { messageSid, from: mobile, to: line, body, twilioOptOut: null },
      { run: withFirm },
    );
    const { rows: m } = await su.query<{ id: string }>(
      "select id::text as id from messages where firm_id = $1 and provider_message_id = $2",
      [f.firmId, messageSid],
    );
    const id = m[0]?.id ?? "";
    return { id, result: await run(id, ai) };
  };
  // A message in the app, answered by the job.
  const ask = async (body: string, ai?: AiClient) => {
    const sent = await receiveAppMessage(
      { firmId: f.firmId, run: withFirm, secret: SECRET },
      ann,
      body,
    );
    if (sent.status !== "sent") throw new Error(`not sent: ${sent.status}`);
    return { id: sent.messageId, result: await run(sent.messageId, ai) };
  };
  // An email to the staffing inbox, sorted by its job.
  const email = async (subject: string, body: string, ai: AiClient = noAi, clock?: Clock) => {
    const messageId = `<${randomBytes(6).toString("hex")}@mail.example.test>`;
    await receiveEmail(
      f.firmId,
      {
        messageId,
        from: address,
        authenticated: true,
        to: inbox,
        subject,
        text: body,
        attachments: 0,
      },
      { run: withFirm },
    );
    const { rows: found } = await su.query<{ id: string }>(
      "select id::text as id from inbound_emails where firm_id = $1 and provider_message_id = $2",
      [f.firmId, messageId],
    );
    const id = found[0]?.id ?? "";
    const result = await runInboundEmail(
      { firmId: f.firmId, idempotencyKey: `inbound-email:${id}`, emailId: id },
      withFirm,
      {
        transport: line_.transport,
        ai,
        baseDomain: "shiftdesk.test",
        aiTimeoutMs: 200,
        draftTimeoutMs: 200,
        ...(clock ? { clock } : {}),
      },
    );
    return { id, result };
  };
  const message = async (id: string) =>
    (
      await su.query<{
        intent: string | null;
        handled_as: string | null;
        answer_id: string | null;
      }>("select intent, handled_as, answer_id::text as answer_id from messages where id = $1", [
        id,
      ])
    ).rows[0];
  const replyOf = async (id: string) =>
    (
      await su.query<{
        body: string;
        intent: string | null;
        answer_id: string | null;
        channel: string;
      }>(
        "select body, intent, answer_id::text as answer_id, channel from messages where reply_to = $1",
        [id],
      )
    ).rows;
  const eventsOf = async (action: string, entityId?: string) =>
    (
      await su.query<{ actor_type: string; data: Record<string, unknown> }>(
        `select actor_type, data from events where firm_id = $1 and action = $2
           and ($3::uuid is null or entity_id = $3::uuid) order by id`,
        [f.firmId, action, entityId ?? null],
      )
    ).rows;
  const requests = async (messageId: string) =>
    (
      await su.query<{ n: number }>(
        "select count(*)::int as n from requests where message_id = $1",
        [messageId],
      )
    ).rows[0]?.n ?? 0;
  return {
    f,
    line,
    ann,
    mobile,
    slug,
    name,
    ids,
    sent: line_.sent,
    text,
    ask,
    email,
    message,
    replyOf,
    eventsOf,
    requests,
  };
}

describe("the switches, through app_set_firm_setting()", () => {
  it("answers.app, answers.texts and answers.email take true or false; the other keys still work", async () => {
    const f = await bookingFirm(su, withFirm, { settings: { auto_replies: true } });
    const settings = async () =>
      (
        await su.query<{ s: Record<string, unknown> }>(
          "select settings as s from firms where id = $1",
          [f.firmId],
        )
      ).rows[0]?.s;
    await withFirm(f.firmId, (tx) =>
      tx.execute(sql`select app_set_firm_setting('answers.app', 'true')`),
    );
    await withFirm(f.firmId, (tx) =>
      tx.execute(sql`select app_set_firm_setting('answers.email', 'false')`),
    );
    expect((await settings())?.answers).toEqual({ app: true, email: false });
    expect((await settings())?.auto_replies).toBe(true);
    const refused = async (key: string, value: string | null) =>
      withFirm(f.firmId, (tx) =>
        tx.execute(sql`select app_set_firm_setting(${key}, ${value})`),
      ).then(
        () => null,
        (err: unknown) => {
          const e = err as { code?: string; cause?: { code?: string } };
          return e.code ?? e.cause?.code ?? "error";
        },
      );
    expect(await refused("answers.texts", "yes")).toBe("22023");
    expect(await refused("answers.texts", null)).toBe("22023");
    expect(await refused("answers.everything", "true")).toBe("42501");
    expect(await refused("auto_replies", "true")).toBe("42501");
    // The strikes team's email and the webhook, as before.
    await withFirm(f.firmId, (tx) =>
      tx.execute(sql`select app_set_firm_setting('strikes.email', 'strikes@example.com')`),
    );
    await withFirm(f.firmId, (tx) =>
      tx.execute(
        sql`select app_set_firm_setting('webhook.url', 'https://planner.example.com/hook')`,
      ),
    );
    const s = await settings();
    expect(s?.strikes).toEqual({ email: "strikes@example.com" });
    expect(s?.webhook).toEqual({ url: "https://planner.example.com/hook", signing_version: 1 });
    expect(s?.answers).toEqual({ app: true, email: false });
  });

  it("an admin sets one on the office side, logged firm.settings_changed; a resourcer can't", async () => {
    const f = await bookingFirm(su, withFirm, {});
    const admin = await f.office("admin");
    const resourcer = await f.office("resourcer");
    const ctx = (officeUserId: string) => ({ firm: { id: f.firmId }, officeUserId, run: withFirm });
    expect(await setAnswerSwitch(ctx(resourcer), "texts", true)).toEqual({ status: "not_allowed" });
    expect(await setAnswerSwitch(ctx(admin), "texts", true)).toEqual({ status: "saved", on: true });
    expect(await setAnswerSwitch(ctx(admin), "texts", true)).toEqual({
      status: "unchanged",
      on: true,
    });
    const { rows } = await su.query<{
      actor_type: string;
      actor_id: string;
      data: Record<string, unknown>;
    }>(
      `select actor_type, actor_id::text as actor_id, data from events
        where firm_id = $1 and action = 'firm.settings_changed'`,
      [f.firmId],
    );
    expect(rows).toEqual([
      {
        actor_type: "office",
        actor_id: admin,
        data: { by: "firm", keys: ["answers.texts"], on: true },
      },
    ]);
  });
});

describe("the answers table and the office's writes", () => {
  it("the five starters, switched off, once each; logged by the system", async () => {
    const f = await bookingFirm(su, withFirm, {});
    const added = await withFirm(f.firmId, (tx) => addStarterAnswers(tx));
    expect(added).toHaveLength(5);
    expect(await withFirm(f.firmId, (tx) => addStarterAnswers(tx))).toEqual([]);
    const { rows } = await su.query<{
      starter_key: string;
      is_on: boolean;
      updated_by: string | null;
    }>(
      "select starter_key, is_on, updated_by from answers where firm_id = $1 order by created_at, starter_key",
      [f.firmId],
    );
    expect(rows.map((r) => r.starter_key).sort()).toEqual(STARTERS.map((s) => s.key).sort());
    expect(rows.every((r) => !r.is_on && r.updated_by === null)).toBe(true);
    const { rows: logged } = await su.query<{ actor_type: string; data: Record<string, unknown> }>(
      "select actor_type, data from events where firm_id = $1 and action = 'answer.created'",
      [f.firmId],
    );
    expect(logged).toHaveLength(5);
    for (const e of logged) {
      expect(e.actor_type).toBe("system");
      expect(Object.keys(e.data).sort()).toEqual(["answerId", "starter"]);
      expect(passesLogCheck(e.data)).toBe(true);
    }
  });

  it("add, edit and switch: admins only, checked again in the transaction, every change logged with ids only", async () => {
    const f = await bookingFirm(su, withFirm, {});
    const admin = await f.office("admin");
    const resourcer = await f.office("resourcer");
    const ctx = (officeUserId: string) => ({ firm: { id: f.firmId }, officeUserId, run: withFirm });
    const input = {
      name: "Lockers",
      examples: "is there a locker",
      body: "Lockers are at gate A.",
    };
    expect(await createAnswer(ctx(resourcer), input, { switchOn: true })).toEqual({
      status: "not_allowed",
    });
    expect(
      await createAnswer(ctx(admin), { ...input, body: "Hi {nickname}" }, { switchOn: true }),
    ).toEqual({
      status: "invalid",
      errors: { body: "Use only the fill-ins from the list." },
    });
    const made = await createAnswer(ctx(admin), input, { switchOn: false });
    if (made.status !== "saved") throw new Error(made.status);
    expect(made.switchedOn).toBe(false);
    expect(await updateAnswer(ctx(admin), made.id, input)).toEqual({
      status: "unchanged",
      id: made.id,
    });
    expect(
      await updateAnswer(
        ctx(admin),
        made.id,
        { ...input, body: "Lockers are at gate B." },
        { switchOn: true },
      ),
    ).toEqual({ status: "saved", id: made.id, switchedOn: true });
    expect(await switchAnswer(ctx(resourcer), made.id, false)).toEqual({ status: "not_allowed" });
    expect(await switchAnswer(ctx(admin), made.id, false)).toEqual({
      status: "switched",
      on: false,
    });
    expect(await switchAnswer(ctx(admin), made.id, false)).toEqual({
      status: "unchanged",
      on: false,
    });
    const { rows } = await su.query<{ action: string; data: Record<string, unknown> }>(
      "select action, data from events where firm_id = $1 and action like 'answer.%' order by id",
      [f.firmId],
    );
    expect(rows).toEqual([
      { action: "answer.created", data: { answerId: made.id } },
      { action: "answer.changed", data: { answerId: made.id, keys: ["body"] } },
      { action: "answer.switched", data: { answerId: made.id, on: true } },
      { action: "answer.switched", data: { answerId: made.id, on: false } },
    ]);
    const list = await withFirm(f.firmId, (tx) => listAnswers(tx, new Date()));
    expect(list).toEqual([
      expect.objectContaining({
        id: made.id,
        name: "Lockers",
        examples: ["is there a locker"],
        body: "Lockers are at gate B.",
        isOn: false,
        updatedByName: "Office Person",
        usesLast7Days: 0,
      }),
    ]);
  });

  it("the app role may never delete an answer, nor move one to another firm", async () => {
    const t = await libraryFirm();
    const err = await withFirm(t.f.firmId, (tx) =>
      tx.execute(sql`delete from answers where id = ${t.ids.Parking}`),
    ).then(
      () => null,
      (e: unknown) =>
        (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code,
    );
    expect(err).toBe("42501");
    const moved = await withFirm(t.f.firmId, (tx) =>
      tx.execute(sql`update answers set firm_id = gen_random_uuid() where id = ${t.ids.Parking}`),
    ).then(
      () => null,
      (e: unknown) =>
        (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code,
    );
    expect(moved).toBe("42501");
  });
});

describe("texts to the shifts line", () => {
  it("an example phrase: the answer's words, the automatic line and the sign-off; logged by id", async () => {
    const t = await libraryFirm();
    const { id, result } = await t.text("Hi, where do I park on Saturday?");
    expect(result).toEqual({ status: "replied", intent: "answer", handledAs: "keyword" });
    expect(await t.message(id)).toEqual({
      intent: "answer",
      handled_as: "keyword",
      answer_id: t.ids.Parking,
    });
    const words = `Park at the back. Gate C. ${AUTOMATIC_REPLY} — ${t.name} Shift Team`;
    expect(t.sent.map((m) => m.body)).toEqual([words]);
    expect(await t.replyOf(id)).toEqual([
      { body: words, intent: "answer", answer_id: t.ids.Parking, channel: "sms" },
    ]);
    const [received] = await t.eventsOf("message.received", id);
    expect(received?.data).toEqual({
      channel: "sms",
      handledAs: "keyword",
      intent: "answer",
      answerId: t.ids.Parking,
      matchedBy: "example",
      workerId: t.ann,
    });
    const [replied] = await t.eventsOf("message.replied", id);
    expect(replied?.data).toMatchObject({
      channel: "sms",
      intent: "answer",
      answerId: t.ids.Parking,
    });
    expect(passesLogCheck(received?.data ?? {})).toBe(true);
    expect(await t.requests(id)).toBe(0);
    // Counted on the office's list as a use this week.
    const list = await withFirm(t.f.firmId, (tx) => listAnswers(tx, new Date()));
    expect(list.find((a) => a.id === t.ids.Parking)?.usesLast7Days).toBe(1);
  });

  it("the AI picks a switched-on answer by its label: shown names and examples only, never a fill-in's value", async () => {
    const t = await libraryFirm({
      answers: [
        PARKING,
        { name: "Pay day", examples: "when is payday", body: "Pay day: {next_pay_day}." },
        { name: "Old one", examples: "old", body: "Off.", on: false },
      ],
    });
    const { ai, asked } = fakeAi("a1");
    const { id, result } = await t.text("anywhere to leave the car near the arena", ai);
    expect(result).toEqual({ status: "replied", intent: "answer", handledAs: "ai" });
    expect(await t.message(id)).toEqual({
      intent: "answer",
      handled_as: "ai",
      answer_id: t.ids.Parking,
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.purpose).toBe("classify_message");
    expect(asked[0]?.maxTokens).toBe(5);
    expect(asked[0]?.system).toContain("a1 (Parking: where do i park; is there parking)");
    expect(asked[0]?.system).toContain("a2 (Pay day: when is payday)");
    expect(asked[0]?.system).not.toContain("Old one");
    expect(asked[0]?.system).not.toContain("Gate C");
    expect(asked[0]?.prompt).toBe("anywhere to leave the car near the arena");
    const [received] = await t.eventsOf("message.received", id);
    expect(received?.data).toMatchObject({
      answerId: t.ids.Parking,
      matchedBy: "ai",
      handledAs: "ai",
    });
  });

  it("an AI label beyond the answers it was shown, or the bare word 'answer': the office", async () => {
    const t = await libraryFirm();
    for (const label of ["a2", "answer", "a0"]) {
      const { id, result } = await t.text(`could you tell me something ${label}`, fakeAi(label).ai);
      expect(result).toMatchObject({ status: "replied", intent: "office", handledAs: "office" });
      expect(await t.message(id)).toMatchObject({ intent: "office", answer_id: null });
      expect(await t.requests(id)).toBe(1);
    }
  });

  it("a fill-in she has no value for: not sent, the office gets the question, and the log says which", async () => {
    const t = await libraryFirm({
      answers: [
        {
          name: "What to wear",
          examples: "what do i wear",
          body: "For {next_shift}: {next_shift_instructions}",
        },
      ],
    });
    const { id, result } = await t.text("what do I wear?");
    expect(result).toMatchObject({ status: "replied", intent: "office", handledAs: "keyword" });
    expect(await t.message(id)).toEqual({
      intent: "office",
      handled_as: "keyword",
      answer_id: null,
    });
    expect(await t.requests(id)).toBe(1);
    expect(t.sent[0]?.body).toContain("The office will see this and get back to you.");
    const [received] = await t.eventsOf("message.received", id);
    expect(received?.data).toMatchObject({
      intent: "office",
      answerId: t.ids["What to wear"],
      matchedBy: "example",
      answerMissing: ["next_shift", "next_shift_instructions"],
    });
  });

  it("her own facts filled in by code: pay day, next shift and its instructions, licence expiry, links", async () => {
    const t = await libraryFirm({
      answers: [
        {
          name: "Pay day",
          examples: "when do we get paid",
          body: "Hi {first_name}. Pay day is {next_pay_day}, for shifts {pay_cycle}: {pay_link}",
        },
        {
          name: "What to wear",
          examples: "what do i wear",
          body: "For {next_shift}: {next_shift_instructions}",
        },
        {
          name: "Licence",
          examples: "my licence runs out",
          body: "Your {licence_expiry}. Add the new one: {profile_link}",
        },
      ],
    });
    const shift = await t.f.shift({
      role: "steward",
      startsAt: new Date(Date.now() + 72 * 3_600_000),
    });
    await su.query(
      "update shifts set uniform = 'Black trousers, hi-vis', instructions = 'Report to gate B' where id = $1",
      [shift],
    );
    await t.f.booking(t.ann, shift);
    const pay = await t.text("when do we get paid?");
    expect(pay.result).toMatchObject({ status: "replied", intent: "answer" });
    const portal = portalUrl(t.slug, "shiftdesk.test");
    expect(t.sent[0]?.body).toMatch(
      new RegExp(
        `^Hi Ann\\. Pay day is [A-Z][a-z]+day \\d{1,2} [A-Z][a-z]+, for shifts [A-Z][a-z]{2} \\d{1,2} (?:[A-Z][a-z]{2} )?to Sun \\d{1,2} [A-Z][a-z]{2}: ${portal.replace(/[.]/g, "\\.")}/pay `,
      ),
    );
    await t.text("what do i wear");
    expect(t.sent[1]?.body).toMatch(
      /^For Steward · Fixture event, [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}, \d\d:\d\d to \d\d:\d\d: Uniform: Black trousers, hi-vis\. Report to gate B\. Automatic reply\./,
    );
    await t.text("my licence runs out soon");
    // The soonest-dated qualification she holds (the fixture's door supervisor licence, 2029).
    expect(t.sent[2]?.body).toMatch(
      new RegExp(
        `^Your .+ runs to 1 January 2029\\. Add the new one: ${portal.replace(/[.]/g, "\\.")}/profile `,
      ),
    );
  });

  it("a message about pay going wrong never gets a library answer: the built-in pay path, as before", async () => {
    const t = await libraryFirm({
      answers: [{ name: "Pay day", examples: "when will i get paid", body: "Pay day is soon." }],
    });
    const { ai, asked } = fakeAi("a1");
    const { id, result } = await t.text("When will I get paid? My pay was wrong last week", ai);
    expect(result).toEqual({ status: "replied", intent: "pay", handledAs: "keyword" });
    expect(await t.message(id)).toEqual({ intent: "pay", handled_as: "keyword", answer_id: null });
    expect(asked).toEqual([]);
    // And the AI isn't shown the answers for one either.
    const other = await t.text("I haven't been paid for the arena", ai);
    expect(other.result).toMatchObject({ intent: "pay" });
    const noKeyword = await t.text("the money for the arena never came, it's a mistake", ai);
    expect(noKeyword.result).toMatchObject({ intent: "office", handledAs: "office" });
    expect(asked.every((r) => !r.system.includes("Pay day"))).toBe(true);
  });

  it("the texts switch off: no library answer by text (the app's switch doesn't count)", async () => {
    const t = await libraryFirm({
      settings: { auto_replies: true, answers: { app: true, texts: false } },
    });
    const { ai, asked } = fakeAi("a1");
    const { id, result } = await t.text("where do i park", ai);
    // The AI is asked as before, with the four labels only, and "a1" isn't one of them.
    expect(result).toMatchObject({ intent: "office", handledAs: "office" });
    expect(await t.message(id)).toMatchObject({ intent: "office", answer_id: null });
    expect(asked[0]?.system).not.toContain("Parking");
  });

  it("automatic replies off: held for a person, sorted as the answer, nothing sent", async () => {
    const t = await libraryFirm({ settings: { answers: { texts: true } } });
    const { id, result } = await t.text("where do i park");
    expect(result).toEqual({
      status: "held",
      intent: "office",
      sortedAs: "answer",
      handledAs: "keyword",
    });
    expect(await t.message(id)).toEqual({
      intent: "office",
      handled_as: "keyword",
      answer_id: null,
    });
    expect(t.sent).toEqual([]);
    expect(await t.requests(id)).toBe(1);
    const [received] = await t.eventsOf("message.received", id);
    expect(received?.data).toMatchObject({
      intent: "office",
      replyHeld: true,
      sortedAs: "answer",
      answerId: t.ids.Parking,
      matchedBy: "example",
    });
  });

  it("a switched-off answer is never matched", async () => {
    const t = await libraryFirm({ answers: [{ ...PARKING, on: false }] });
    const { id } = await t.text("where do i park");
    expect(await t.message(id)).toMatchObject({ intent: "office", answer_id: null });
  });
});

describe("messages in the app", () => {
  it("answered in the app at once, without SEND OFFICE, whatever auto_replies says", async () => {
    const t = await libraryFirm({ settings: { answers: { app: true } } });
    const { id, result } = await t.ask("Is there parking?");
    expect(result).toEqual({ status: "replied", intent: "answer", handledAs: "keyword" });
    expect(await t.replyOf(id)).toEqual([
      {
        body: `Park at the back. Gate C. Automatic reply. — ${t.name} Shift Team`,
        intent: "answer",
        answer_id: t.ids.Parking,
        channel: "app",
      },
    ]);
    expect(t.sent).toEqual([]);
    const [replied] = await t.eventsOf("message.replied", id);
    expect(replied?.data).toMatchObject({
      channel: "app",
      intent: "answer",
      answerId: t.ids.Parking,
    });
    const [received] = await t.eventsOf("message.received", id);
    expect(received?.data).toMatchObject({
      channel: "app",
      answerId: t.ids.Parking,
      matchedBy: "example",
    });
  });

  it("the app's switch off: the AI and the office, as before", async () => {
    const t = await libraryFirm({ settings: { answers: { texts: true } } });
    const { id, result } = await t.ask("Is there parking?");
    expect(result).toMatchObject({ status: "replied", intent: "office" });
    expect(await t.message(id)).toMatchObject({ intent: "office", answer_id: null });
  });
});

describe("emails to the staffing inbox", () => {
  it("the answer by email (template 'answer'), its id on the email, within the daily limit", async () => {
    const t = await libraryFirm();
    const { id, result } = await t.email("Saturday", "Hello, where do I park at the arena?");
    expect(result).toMatchObject({ status: "replied", answer: "answer" });
    const { rows } = await su.query<{
      intent: string;
      handled_as: string;
      answer_id: string | null;
    }>(
      "select intent, handled_as, answer_id::text as answer_id from inbound_emails where id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ intent: "answer", handled_as: "keyword", answer_id: t.ids.Parking });
    const { rows: replies } = await su.query<{ kind: string; template: string; body: string }>(
      "select kind, template, body from email_replies where inbound_email_id = $1",
      [id],
    );
    expect(replies).toEqual([
      {
        kind: "automatic",
        template: "answer",
        body: `Hi Ann,\n\nPark at the back. Gate C.\n\nThis is an automatic reply. To reach a person, reply to this email.\n\n— ${t.name} Shift Team`,
      },
    ]);
    expect(t.sent.map((m) => m.channel)).toEqual(["email"]);
    const [received] = await t.eventsOf("email.received", id);
    expect(received?.data).toMatchObject({
      intent: "answer",
      handledAs: "keyword",
      answerId: t.ids.Parking,
      matchedBy: "example",
    });
    const [replied] = await t.eventsOf("email.replied", id);
    expect(replied?.data).toMatchObject({ answer: "answer", answerId: t.ids.Parking });
  });

  it("the email switch off, or auto_replies off: no library answer by email", async () => {
    const off = await libraryFirm({
      settings: { auto_replies: true, answers: { app: true, texts: true } },
    });
    const a = await off.email("Parking", "where do i park");
    expect(a.result).toMatchObject({ status: "person" });
    const held = await libraryFirm({ settings: { answers: { email: true } } });
    const b = await held.email("Parking", "where do i park");
    expect(b.result).toMatchObject({ status: "person", why: "held", sortedAs: "answer" });
    const { rows } = await su.query<{ intent: string; answer_id: string | null }>(
      "select intent, answer_id::text as answer_id from inbound_emails where id = any($1::uuid[])",
      [[a.id, b.id]],
    );
    expect(rows).toEqual([
      { intent: "office", answer_id: null },
      { intent: "office", answer_id: null },
    ]);
    expect(held.sent).toEqual([]);
  });
});

describe("no answer yet", () => {
  it("lists the latest casuals' questions that went to a person, never one about pay going wrong", async () => {
    const t = await libraryFirm({ answers: [] });
    await t.text("is there food at the festival?");
    await t.text("my pay is wrong");
    await t.ask("can I bring a friend?");
    const list = await withFirm(t.f.firmId, (tx) => questionsWithNoAnswer(tx, { limit: 5 }));
    expect(list.map((q) => [q.kind, q.channel, q.text])).toEqual([
      ["message", "app", "can I bring a friend?"],
      ["message", "sms", "is there food at the festival?"],
    ]);
  });
});

// The guardrails review of Phase 35 (H1, M1, M2), on all three channels.
const OFFICE_HOURS: SeedAnswer = {
  name: "Office hours",
  examples: "is anyone in",
  body: "The office is open 9 to 5.",
};
const PAY_DAY: SeedAnswer = {
  name: "Pay day",
  examples: "when do we get paid",
  body: "Your hours and rates: {pay_link}",
};
const WEAR: SeedAnswer = { name: "What to wear", examples: "what do i wear", body: "Black." };

describe("never a library answer for a cancel, a person or a dropout (H1)", () => {
  const answers = [OFFICE_HOURS, PAY_DAY, WEAR];

  it("texts: the dropout reaches a person, 'office' beats the pay words, cancel gets the cancel reply; the AI is never shown the answers", async () => {
    const t = await libraryFirm({ answers });
    const { ai, asked } = fakeAi("a1");
    const sick = await t.text("sick, can't make tonight, is anyone in?", ai);
    expect(sick.result).toEqual({ status: "replied", intent: "office", handledAs: "office" });
    expect(await t.message(sick.id)).toEqual({
      intent: "office",
      handled_as: "office",
      answer_id: null,
    });
    expect(await t.requests(sick.id)).toBe(1);
    // The AI was asked with the four labels only: "a1" isn't one.
    expect(asked).toHaveLength(1);
    expect(asked[0]?.system).not.toContain("Office hours");
    expect((await t.eventsOf("message.received", sick.id))[0]?.data).toMatchObject({
      intent: "office",
      aiFallback: "not_a_label",
    });
    const office = await t.text("office, when do we get paid", ai);
    expect(office.result).toEqual({ status: "replied", intent: "office", handledAs: "keyword" });
    expect(await t.message(office.id)).toEqual({
      intent: "office",
      handled_as: "keyword",
      answer_id: null,
    });
    expect(await t.requests(office.id)).toBe(1);
    const cancel = await t.text("I need to cancel Saturday, what do I wear", ai);
    expect(cancel.result).toEqual({ status: "replied", intent: "cancel", handledAs: "keyword" });
    expect(await t.message(cancel.id)).toMatchObject({ intent: "cancel", answer_id: null });
    // Only the first went to the AI; none got an answer's words.
    expect(asked).toHaveLength(1);
    expect(t.sent.some((m) => m.body.includes("The office is open 9 to 5"))).toBe(false);
    expect(t.sent.some((m) => m.body.includes("Black."))).toBe(false);
    for (const id of [sick.id, office.id, cancel.id]) {
      expect((await t.eventsOf("message.received", id))[0]?.data).not.toHaveProperty("answerId");
    }
  });

  it("the app: the same", async () => {
    const t = await libraryFirm({ answers });
    const { ai, asked } = fakeAi("a1");
    const sick = await t.ask("sick, can't make tonight, is anyone in?", ai);
    expect(sick.result).toEqual({ status: "replied", intent: "office", handledAs: "office" });
    expect(await t.message(sick.id)).toEqual({
      intent: "office",
      handled_as: "office",
      answer_id: null,
    });
    expect(await t.requests(sick.id)).toBe(1);
    expect(asked[0]?.system).not.toContain("Office hours");
    const office = await t.ask("office, when do we get paid", ai);
    expect(office.result).toEqual({ status: "replied", intent: "office", handledAs: "keyword" });
    expect(await t.requests(office.id)).toBe(1);
    const cancel = await t.ask("I need to cancel Saturday, what do I wear", ai);
    expect(cancel.result).toEqual({ status: "replied", intent: "cancel", handledAs: "keyword" });
    expect(asked).toHaveLength(1);
    for (const id of [sick.id, office.id, cancel.id]) {
      expect((await t.replyOf(id))[0]?.answer_id ?? null).toBeNull();
    }
  });

  it("email: the office's path (no answer, no email to her)", async () => {
    const t = await libraryFirm({ answers });
    const { ai, asked } = fakeAi("a1");
    const sick = await t.email("Tonight", "sick, can't make tonight, is anyone in?", ai);
    expect(sick.result).toMatchObject({ status: "person", why: "office", handledAs: "office" });
    const office = await t.email("Question", "office, when do we get paid", ai);
    expect(office.result).toMatchObject({ status: "person", why: "office", handledAs: "keyword" });
    const { rows } = await su.query<{ id: string; intent: string; answer_id: string | null }>(
      `select id::text as id, intent, answer_id::text as answer_id from inbound_emails
        where id = any($1::uuid[])`,
      [[sick.id, office.id]],
    );
    expect(rows.map((r) => [r.intent, r.answer_id])).toEqual([
      ["office", null],
      ["office", null],
    ]);
    const { rows: replies } = await su.query<{ n: number }>(
      "select count(*)::int as n from email_replies where inbound_email_id = any($1::uuid[])",
      [[sick.id, office.id]],
    );
    expect(replies[0]?.n).toBe(0);
    const sorting = asked.filter((r) => r.purpose === "classify_message");
    expect(sorting).toHaveLength(1);
    expect(sorting[0]?.system).not.toContain("Office hours");
  });

  it("an example holding a kept word can't be saved", async () => {
    const f = await bookingFirm(su, withFirm, {});
    const admin = await f.office("admin");
    const ctx = { firm: { id: f.firmId }, officeUserId: admin, run: withFirm };
    expect(
      await createAnswer(
        ctx,
        { name: "Office hours", examples: "what time is the office open", body: "9 to 5." },
        { switchOn: true },
      ),
    ).toEqual({
      status: "invalid",
      errors: {
        examples:
          "Leave out cancel, office, help, talk, stop, start, and words like can't, not, sick or late: messages with them always go to a person or a built-in reply.",
      },
    });
    expect(
      await createAnswer(
        ctx,
        { name: "Call 07700 900123", examples: "where do i park", body: "Gate C." },
        { switchOn: true },
      ),
    ).toEqual({
      status: "invalid",
      errors: { name: "Take out the phone number or email address." },
    });
  });
});

describe("an answer about pay carries the pay query hint, on every channel (M1)", () => {
  it("texts, the app and email", async () => {
    const t = await libraryFirm({ answers: [PAY_DAY] });
    const portal = portalUrl(t.slug, "shiftdesk.test");
    const words = `Your hours and rates: ${portal}/pay ${ANSWER_PAY_HINT}`;
    const text = await t.text("when do we get paid?");
    expect(text.result).toMatchObject({ status: "replied", intent: "answer" });
    expect(t.sent[0]?.body).toBe(`${words} ${AUTOMATIC_REPLY} — ${t.name} Shift Team`);
    const app = await t.ask("When do we get paid?");
    expect((await t.replyOf(app.id))[0]?.body).toBe(
      `${words} Automatic reply. — ${t.name} Shift Team`,
    );
    const email = await t.email("Pay day", "Hi, when do we get paid?");
    expect(email.result).toMatchObject({ status: "replied", answer: "answer" });
    const { rows } = await su.query<{ body: string }>(
      "select body from email_replies where inbound_email_id = $1",
      [email.id],
    );
    expect(rows[0]?.body).toBe(
      `Hi Ann,\n\n${words}\n\nThis is an automatic reply. To reach a person, reply to this email.\n\n— ${t.name} Shift Team`,
    );
  });

  it("not for an answer without a pay fill-in, nor for a dispute (the built-in pay reply)", async () => {
    const t = await libraryFirm({ answers: [PARKING, PAY_DAY] });
    await t.text("where do i park");
    expect(t.sent[0]?.body).not.toContain(ANSWER_PAY_HINT);
    const late = await t.text("when do we get paid? it's late again");
    expect(late.result).toMatchObject({ intent: "pay", handledAs: "keyword" });
    expect(await t.message(late.id)).toMatchObject({ answer_id: null });
  });
});

describe("switched off between the read and the claim: the office's (M2)", () => {
  // A fake AI that picks a1, after doing `meanwhile` (as an admin would, mid-job).
  const switchingAi = (meanwhile: () => Promise<unknown>) =>
    createFakeAi(async (r) => {
      if (r.purpose !== "classify_message") return "Thanks.";
      await meanwhile();
      return "a1";
    });
  const QUESTION = "anywhere to leave the car near the arena";

  it("texts: the answer switched off → no answer, a request, answerSwitchedOff in the log", async () => {
    const t = await libraryFirm();
    const ai = switchingAi(() =>
      su.query("update answers set is_on = false where id = $1", [t.ids.Parking]),
    );
    const { id, result } = await t.text(QUESTION, ai);
    expect(result).toEqual({ status: "replied", intent: "office", handledAs: "ai" });
    expect(await t.message(id)).toEqual({ intent: "office", handled_as: "ai", answer_id: null });
    expect(await t.requests(id)).toBe(1);
    expect(t.sent.map((m) => m.body)).toEqual([
      expect.stringMatching(/^The office will see this and get back to you\./),
    ]);
    const [received] = await t.eventsOf("message.received", id);
    expect(received?.data).toMatchObject({
      intent: "office",
      answerId: t.ids.Parking,
      matchedBy: "ai",
      answerSwitchedOff: true,
    });
    expect(passesLogCheck(received?.data ?? {})).toBe(true);
  });

  it("texts: the texts switch, or auto_replies, switched off meanwhile → the office's", async () => {
    for (const settings of [
      { auto_replies: true, answers: { texts: false, app: true, email: true } },
      { auto_replies: false, answers: { texts: true, app: true, email: true } },
    ]) {
      const t = await libraryFirm();
      const ai = switchingAi(() =>
        su.query("update firms set settings = $2::jsonb where id = $1", [
          t.f.firmId,
          JSON.stringify(settings),
        ]),
      );
      const { id } = await t.text(QUESTION, ai);
      expect(await t.message(id)).toMatchObject({ intent: "office", answer_id: null });
      expect(await t.requests(id)).toBe(1);
      expect((await t.eventsOf("message.received", id))[0]?.data).toMatchObject({
        answerSwitchedOff: true,
      });
    }
  });

  it("texts: its words edited meanwhile → the words as they are now go", async () => {
    const t = await libraryFirm();
    const ai = switchingAi(() =>
      su.query("update answers set body = 'Park at the front. Gate A.' where id = $1", [
        t.ids.Parking,
      ]),
    );
    const { id, result } = await t.text(QUESTION, ai);
    expect(result).toMatchObject({ status: "replied", intent: "answer" });
    expect(t.sent[0]?.body).toBe(
      `Park at the front. Gate A. ${AUTOMATIC_REPLY} — ${t.name} Shift Team`,
    );
    expect(await t.message(id)).toMatchObject({ intent: "answer", answer_id: t.ids.Parking });
    // Edited to need a fill-in not read before (and with no value for her): the office's.
    const u = await libraryFirm();
    const ai2 = switchingAi(() =>
      su.query("update answers set body = 'For {next_shift}: park at gate A.' where id = $1", [
        u.ids.Parking,
      ]),
    );
    const late = await u.text(QUESTION, ai2);
    expect(await u.message(late.id)).toMatchObject({ intent: "office", answer_id: null });
    expect((await u.eventsOf("message.received", late.id))[0]?.data).toMatchObject({
      answerMissing: ["next_shift"],
    });
  });

  it("the app: the answer, or the app's switch, switched off meanwhile → the office's", async () => {
    const t = await libraryFirm();
    const off = switchingAi(() =>
      su.query("update answers set is_on = false where id = $1", [t.ids.Parking]),
    );
    const a = await t.ask(QUESTION, off);
    expect(a.result).toMatchObject({ status: "replied", intent: "office" });
    expect(await t.message(a.id)).toMatchObject({ intent: "office", answer_id: null });
    expect(await t.requests(a.id)).toBe(1);
    expect((await t.eventsOf("message.received", a.id))[0]?.data).toMatchObject({
      channel: "app",
      answerSwitchedOff: true,
    });
    const u = await libraryFirm();
    const channel = switchingAi(() =>
      su.query(
        `update firms set settings = jsonb_set(settings, '{answers,app}', 'false') where id = $1`,
        [u.f.firmId],
      ),
    );
    const b = await u.ask(QUESTION, channel);
    expect(await u.message(b.id)).toMatchObject({ intent: "office", answer_id: null });
    expect((await u.eventsOf("message.received", b.id))[0]?.data).toMatchObject({
      answerSwitchedOff: true,
    });
  });

  it("email: the answer, or the email switch, switched off meanwhile → the office's, no email", async () => {
    const t = await libraryFirm();
    const off = switchingAi(() =>
      su.query("update answers set is_on = false where id = $1", [t.ids.Parking]),
    );
    const a = await t.email("Car", QUESTION, off);
    expect(a.result).toMatchObject({ status: "person", why: "office" });
    const u = await libraryFirm();
    const channel = switchingAi(() =>
      su.query(
        `update firms set settings = jsonb_set(settings, '{answers,email}', 'false') where id = $1`,
        [u.f.firmId],
      ),
    );
    const b = await u.email("Car", QUESTION, channel);
    expect(b.result).toMatchObject({ status: "person", why: "office" });
    for (const [x, id] of [
      [t, a.id],
      [u, b.id],
    ] as const) {
      const { rows } = await su.query<{ intent: string; answer_id: string | null }>(
        "select intent, answer_id::text as answer_id from inbound_emails where id = $1",
        [id],
      );
      expect(rows[0]).toEqual({ intent: "office", answer_id: null });
      const { rows: replies } = await su.query<{ n: number }>(
        "select count(*)::int as n from email_replies where inbound_email_id = $1",
        [id],
      );
      expect(replies[0]?.n).toBe(0);
      expect((await x.eventsOf("email.received", id))[0]?.data).toMatchObject({
        intent: "office",
        matchedBy: "ai",
        answerSwitchedOff: true,
      });
      expect(x.sent.filter((m) => m.channel === "email")).toEqual([]);
    }
  });
});

describe("email's fill-ins at the job's clock, as texts and the app (L4)", () => {
  it("her next shift as of the deps' clock: past it, none, so the office's", async () => {
    const t = await libraryFirm({
      answers: [{ name: "What to wear", examples: "what do i wear", body: "For {next_shift}." }],
    });
    const shift = await t.f.shift({
      role: "steward",
      startsAt: new Date(Date.now() + 72 * 3_600_000),
    });
    await t.f.booking(t.ann, shift);
    const now = await t.email("Saturday", "what do i wear");
    expect(now.result).toMatchObject({ status: "replied", answer: "answer" });
    const later: Clock = { now: () => new Date(Date.now() + 10 * 86_400_000) };
    const after = await t.email("Saturday", "what do i wear", noAi, later);
    expect(after.result).toMatchObject({ status: "person", why: "office" });
    expect((await t.eventsOf("email.received", after.id))[0]?.data).toMatchObject({
      intent: "office",
      answerMissing: ["next_shift"],
    });
  });
});
