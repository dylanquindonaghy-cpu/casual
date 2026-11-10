import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noAi } from "@/lib/ai/client";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { receiveAppMessage } from "@/lib/inbound/app";
import { runInboundMessage } from "@/lib/inbound/reply";
import { officeAnswer, officeAnswersPage, officeNewAnswer } from "@/lib/office/answers-page";
import { officeEnquiries, officeEnquiry } from "@/lib/office/enquiries";
import { messagesThread } from "@/lib/portal/messages";
import { askOfficeTexts } from "@/lib/portal/messages-copy";
import { captureTransport } from "../helpers/auth";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The answer library's screens (Phase 35.3, 35.4) on the real database as the app role: what
// Settings → Automatic answers and its Add and Edit forms read (admins only; another firm's rows
// never), Enquiries' "Answered automatically" view and "How it was answered" for one of the firm's
// answers, and the casual's "Not what you needed? Ask the office" (its words reach a person). The
// AI is off (noAi); nothing is sent anywhere. Made-up people only.

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

const SECRET = "test-session-secret-for-the-answer-screens-0123";

async function scene(o: { answers?: { name: string; examples: string; body: string }[] } = {}) {
  const f = await bookingFirm(su, withFirm, {
    settings: { auto_replies: true, answers: { app: true, texts: true, email: true } },
  });
  const ann = await f.worker({ first: "Ann" });
  const admin = await f.office("admin");
  const resourcer = await f.office("resourcer");
  const ids: Record<string, string> = {};
  for (const a of o.answers ?? [
    {
      name: "Lockers",
      examples: "where do i leave my bag",
      body: "Hi {first_name}, lockers at gate A.",
    },
  ]) {
    const { rows } = await su.query<{ id: string }>(
      `insert into answers (firm_id, name, examples, body, is_on, updated_by)
       values ($1, $2, $3, $4, true, $5) returning id::text as id`,
      [f.firmId, a.name, a.examples, a.body, admin],
    );
    ids[a.name] = rows[0]?.id ?? "";
    await su.query(
      `insert into events (firm_id, actor_type, actor_id, action, entity_type, entity_id, data)
       values ($1, 'office', $2, 'answer.switched', 'answer', $3, $4)`,
      [f.firmId, admin, ids[a.name], JSON.stringify({ answerId: ids[a.name], on: true })],
    );
  }
  const transport = captureTransport();
  // A message in the app, answered by the job (the AI off).
  const ask = async (body: string) => {
    const sent = await receiveAppMessage(
      { firmId: f.firmId, run: withFirm, secret: SECRET },
      ann,
      body,
      crypto.randomUUID(),
    );
    if (sent.status !== "sent") throw new Error(`not sent: ${sent.status}`);
    await runInboundMessage(
      {
        firmId: f.firmId,
        messageId: sent.messageId,
        idempotencyKey: `inbound-message:${sent.messageId}`,
      },
      withFirm,
      { transport: transport.transport, ai: noAi, baseDomain: "shiftdesk.test", aiTimeoutMs: 200 },
    );
    return sent.messageId;
  };
  const ctx = (officeUserId: string) => ({ firm: { id: f.firmId }, officeUserId, run: withFirm });
  return { f, ann, admin, resourcer, ids, ask, ctx };
}

describe("Settings → Automatic answers: what the page and its forms read", () => {
  it("admins get the switches, the answers with their uses and the latest questions with no answer; resourcers get nothing", async () => {
    const s = await scene();
    await s.ask(`Where do I leave my bag? ${randomBytes(2).toString("hex")}`);
    const food = await s.ask("Is there food at the festival?");
    // Her "Ask the office" after an answer is a follow-up, not a question with no answer.
    await s.ask("Please can someone from the office help? (About: Lockers)");
    expect(await officeAnswersPage(s.ctx(s.resourcer))).toBeNull();
    const page = await officeAnswersPage(s.ctx(s.admin));
    expect(page).not.toBeNull();
    expect(page?.switches).toEqual({ app: true, texts: true, email: true });
    expect(page?.autoReplies).toBe(true);
    expect(page?.answeredLast7Days).toEqual({ app: 1, texts: 0, email: 0 });
    const lockers = page?.answers.find((a) => a.name === "Lockers");
    expect(lockers).toMatchObject({ isOn: true, usesLast7Days: 1, updatedByName: "Office Person" });
    expect(page?.unanswered.map((q) => [q.id, q.text, q.channel])).toEqual([
      [food, "Is there food at the festival?", "app"],
    ]);
  });

  it("Make this an answer: Add starts with the casual's question (admins only, a question that went to a person, this firm's only)", async () => {
    const s = await scene();
    const food = await s.ask("Is there   food at the festival?");
    const answered = await s.ask("where do i leave my bag please");
    const trouble = await s.ask("Something went wrong with my hours, can someone help");
    expect(await officeNewAnswer(s.ctx(s.resourcer), food)).toBeNull();
    expect((await officeNewAnswer(s.ctx(s.admin), food))?.example).toBe(
      "Is there food at the festival?",
    );
    // Answered automatically, about pay going wrong, not an id, or another firm's: no example.
    expect((await officeNewAnswer(s.ctx(s.admin), answered))?.example).toBeNull();
    expect((await officeNewAnswer(s.ctx(s.admin), trouble))?.example).toBeNull();
    expect((await officeNewAnswer(s.ctx(s.admin), "not-an-id"))?.example).toBeNull();
    const other = await scene();
    const theirs = await other.ask("Can I bring a friend along?");
    expect((await officeNewAnswer(s.ctx(s.admin), theirs))?.example).toBeNull();
    expect((await officeNewAnswer(other.ctx(other.admin), theirs))?.example).toBe(
      "Can I bring a friend along?",
    );
    // Edit: this firm's answer only, admins only.
    expect((await officeAnswer(s.ctx(s.admin), s.ids.Lockers ?? ""))?.answer?.name).toBe("Lockers");
    expect(await officeAnswer(s.ctx(s.resourcer), s.ids.Lockers ?? "")).toBeNull();
    expect(await officeAnswer(other.ctx(other.admin), s.ids.Lockers ?? "")).toBeNull();
  });
});

describe("Enquiries: answered automatically, and how", () => {
  it("the view lists one of the firm's answers by name and the built-in ones, never one for a person; its detail names the answer, how and the words", async () => {
    const s = await scene();
    const bag = await s.ask("Hi, where do I leave my bag?");
    const pay = await s.ask("Where do I see my pay?");
    const food = await s.ask("Is there food at the festival?");
    const list = await officeEnquiries(s.ctx(s.resourcer), "answered");
    expect(list?.answered).toBe(2);
    expect(list?.rows.map((r) => [r.messageId, r.outcome, r.answerName])).toEqual([
      [pay, "pay", null],
      [bag, "answer", "Lockers"],
    ]);
    expect(list?.rows.some((r) => r.messageId === food)).toBe(false);
    const all = await officeEnquiries(s.ctx(s.resourcer), "all");
    expect(all?.rows.find((r) => r.messageId === food)?.answerName).toBeNull();

    const detail = await officeEnquiry(s.ctx(s.resourcer), bag);
    expect(detail?.channel).toBe("app");
    expect(detail?.answer).toMatchObject({
      answerId: s.ids.Lockers,
      name: "Lockers",
      matchedBy: "example",
      switchedOn: { by: "Office Person" },
      fillIns: ["first_name"],
      missing: null,
      changedSince: false,
    });
    const { rows: firm } = await su.query<{ name: string }>(
      "select name from firms where id = $1",
      [s.f.firmId],
    );
    expect(detail?.answer?.words).toBe(
      `Hi Ann, lockers at gate A. Automatic reply. — ${firm[0]?.name} Shift Team`,
    );
    expect((await officeEnquiry(s.ctx(s.resourcer), food))?.answer).toBeNull();
    // Another firm's office can't open it.
    const other = await scene();
    expect(await officeEnquiry(other.ctx(other.admin), bag)).toBeNull();
  });

  it("an answer whose fill-in had no value for her: passed to a person, and the detail says which", async () => {
    const s = await scene({
      answers: [{ name: "Kit", examples: "what kit", body: "For {next_shift}: bring a torch." }],
    });
    const kit = await s.ask("What kit do I need?");
    const detail = await officeEnquiry(s.ctx(s.admin), kit);
    expect(detail?.outcome).toBe("person_waiting");
    expect(detail?.answer).toMatchObject({ name: "Kit", missing: ["next_shift"], words: null });
  });
});

describe("Messages: Not what you needed? Ask the office", () => {
  it("under the latest of the firm's answers, words that reach a person; sent, it says so and goes to the office", async () => {
    const s = await scene();
    await s.ask("Where do I leave my bag?");
    const thread = await messagesThread({ firm: { id: s.f.firmId }, run: withFirm }, s.ann);
    const reply = thread.items.findLast((i) => i.libraryAnswer);
    expect(reply).toBeDefined();
    expect(thread.askOffice).toEqual({
      replyId: reply?.id,
      words: "Please can someone from the office help? (About: Lockers)",
      asked: false,
    });
    const asked = await s.ask(thread.askOffice?.words ?? "");
    const { rows } = await su.query<{ intent: string; handled_as: string }>(
      "select intent, handled_as from messages where id = $1",
      [asked],
    );
    expect(rows[0]).toEqual({ intent: "office", handled_as: "keyword" });
    const after = await messagesThread({ firm: { id: s.f.firmId }, run: withFirm }, s.ann);
    expect(after.askOffice).toMatchObject({ replyId: reply?.id, asked: true });
    // Anything else she writes after it: the button goes.
    await s.ask("Thanks");
    const later = await messagesThread({ firm: { id: s.f.firmId }, run: withFirm }, s.ann);
    expect(later.askOffice).toBeNull();
  });

  it("an answer named with a keyword (Pay day) or another answer's example: still the named words, which still reach a person (H1)", async () => {
    const s = await scene({
      answers: [
        { name: "Pay day", examples: "when is payday", body: "Fridays." },
        { name: "Kit list", examples: "what kit", body: "A torch." },
        // Its example is in "(About: Kit list)": before H1 that would have matched it.
        { name: "Bags", examples: "kit list", body: "One small bag." },
      ],
    });
    const intentOf = async (id: string) =>
      (
        await su.query<{ intent: string; handled_as: string; answer_id: string | null }>(
          "select intent, handled_as, answer_id::text as answer_id from messages where id = $1",
          [id],
        )
      ).rows[0];
    await s.ask("When is payday?");
    const t1 = await messagesThread({ firm: { id: s.f.firmId }, run: withFirm }, s.ann);
    // "(About: Pay day)" has "pay", but "office" is the first keyword and keeps it from the library.
    expect(t1.askOffice?.words).toBe("Please can someone from the office help? (About: Pay day)");
    expect(t1.askOffice?.words).toBe(askOfficeTexts("Pay day")[0]);
    const asked = await s.ask(t1.askOffice?.words ?? "");
    expect(await intentOf(asked)).toEqual({
      intent: "office",
      handled_as: "keyword",
      answer_id: null,
    });
    const t1After = await messagesThread({ firm: { id: s.f.firmId }, run: withFirm }, s.ann);
    expect(t1After.askOffice).toMatchObject({ asked: true });
    await s.ask("What kit do I bring?");
    const t2 = await messagesThread({ firm: { id: s.f.firmId }, run: withFirm }, s.ann);
    expect(t2.askOffice?.words).toBe("Please can someone from the office help? (About: Kit list)");
    const asked2 = await s.ask(t2.askOffice?.words ?? "");
    expect(await intentOf(asked2)).toEqual({
      intent: "office",
      handled_as: "keyword",
      answer_id: null,
    });
  });
});
