import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeAi, noAi, type AiClient, type AiRequest } from "@/lib/ai/client";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { receiveEmail } from "@/lib/email/receive";
import {
  AUTOMATIC_PER_DAY,
  runInboundEmail,
  runInboundEmailTick,
  runInboundEmailWithLastTry,
  STALE_HOURS,
} from "@/lib/email/sort";
import type { MessagingTransport } from "@/lib/messaging/transport";
import { loadEmailEnquiry, loadEnquiries } from "@/lib/office/enquiries";
import { portalUrl } from "@/lib/tenancy/portal-url";
import { captureTransport } from "../helpers/auth";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Sorting an email to the staffing inbox (P7.4, P7.5; Phase 25.5; src/lib/email/sort.ts) on the real
// database as the app role, with a fake AI and a sender that only records: an email not from a
// casual is left for the firm's own inbox; a casual's is sorted by keyword, else the AI's label,
// else a person; with automatic replies on, a shifts, cancel or pay email gets its link by email to
// the address on file (Reply-To the firm's inbox), at most 3 a day; off, it waits for a person with
// the AI's draft (never for pay or money); stale and former casuals' go to a person unsorted; each
// is handled once, logged with labels and ids only; the slot's summary is queued; the hourly sweep
// finds the ones whose job was lost. Made-up people and addresses only.

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

// A fake AI: the label it gives, and the draft it writes.
function fakeAi(o: { label?: string; draft?: string } = {}): {
  ai: AiClient;
  asked: AiRequest[];
} {
  const asked: AiRequest[] = [];
  const ai = createFakeAi((r) => {
    asked.push(r);
    if (r.purpose === "classify_message") return o.label ?? "office";
    if (r.purpose === "draft_reply") return o.draft ?? "Thanks for letting us know.";
    throw new Error(`unexpected purpose ${r.purpose}`);
  });
  return { ai, asked };
}

async function inboxFirm(o: { repliesOn?: true } = {}) {
  const f = await bookingFirm(su, withFirm, {
    settings: o.repliesOn ? { auto_replies: true } : {},
  });
  const inbox = `staffing-${randomBytes(4).toString("hex")}@inbound.example.test`;
  await su.query("update firms set inbox_address = $2 where id = $1", [f.firmId, inbox]);
  const priya = await f.worker({ first: "Priya" });
  const address = `priya.${randomBytes(3).toString("hex")}@example.com`;
  await su.query("update workers set email = $2 where id = $1", [priya, address]);
  const { rows } = await su.query<{ slug: string }>("select slug from firms where id = $1", [
    f.firmId,
  ]);
  const slug = rows[0]?.slug ?? "";
  // An email stored as the webhook would (receiveEmail), returning its id.
  const store = async (e: {
    from?: string;
    subject?: string | null;
    text?: string | null;
    authenticated?: boolean;
  }) => {
    const messageId = `<${randomBytes(6).toString("hex")}@mail.example.test>`;
    await receiveEmail(
      f.firmId,
      {
        messageId,
        from: e.from ?? address,
        authenticated: e.authenticated ?? true,
        to: inbox,
        subject: e.subject === undefined ? "Saturday" : e.subject,
        text: e.text === undefined ? "Hello" : e.text,
        attachments: 0,
      },
      { run: withFirm },
    );
    const { rows: found } = await su.query<{ id: string }>(
      "select id::text as id from inbound_emails where firm_id = $1 and provider_message_id = $2",
      [f.firmId, messageId],
    );
    return found[0]?.id ?? "";
  };
  const payload = (emailId: string) => ({
    firmId: f.firmId,
    idempotencyKey: `inbound-email:${emailId}`,
    emailId,
  });
  const run = (emailId: string, o: { ai?: AiClient; transport?: MessagingTransport } = {}) =>
    runInboundEmail(payload(emailId), withFirm, {
      transport: o.transport ?? captureTransport().transport,
      ai: o.ai ?? noAi,
      baseDomain: "shiftdesk.test",
      aiTimeoutMs: 200,
      draftTimeoutMs: 200,
    });
  const row = async (emailId: string) =>
    (
      await su.query<{
        handled_as: string | null;
        intent: string | null;
        handled_at: Date | null;
        draft_reply: string | null;
      }>("select handled_as, intent, handled_at, draft_reply from inbound_emails where id = $1", [
        emailId,
      ])
    ).rows[0];
  const logged = async (emailId: string) =>
    (
      await su.query<{ action: string; actor_type: string; data: Record<string, unknown> }>(
        "select action, actor_type, data from events where entity_id = $1 order by id",
        [emailId],
      )
    ).rows;
  const replies = async (emailId: string) =>
    (
      await su.query<{
        id: string;
        kind: string;
        template: string | null;
        to_address: string;
        subject: string;
        body: string;
      }>(
        `select id::text as id, kind, template, to_address, subject, body from email_replies
          where inbound_email_id = $1 order by created_at`,
        [emailId],
      )
    ).rows;
  return { f, inbox, priya, address, slug, store, payload, run, row, logged, replies };
}

describe("an email not from a casual", () => {
  it("is left for the firm's own inbox: handled, no words, never a person's here", async () => {
    const t = await inboxFirm({ repliesOn: true });
    const id = await t.store({
      from: "venue@example.org",
      subject: "Invoice",
      text: "See attached",
    });
    const { transport, sent } = captureTransport();
    expect(await t.run(id, { transport })).toEqual({ status: "not_casual" });
    expect(await t.row(id)).toMatchObject({
      handled_as: "unknown",
      intent: null,
      draft_reply: null,
    });
    expect(sent).toEqual([]);
    expect(await t.logged(id)).toEqual([
      {
        action: "email.received",
        actor_type: "system",
        data: { handledAs: "unknown", intent: null },
      },
    ]);
    // Listed, as left for the inbox, never in Need a person.
    const page = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "all", new Date()));
    expect(page.inbox).toBe(true);
    expect(page.rows.find((r) => r.messageId === id)).toMatchObject({
      channel: "email",
      outcome: "inbox",
      who: { kind: "unknown_address", from: "venue@example.org" },
      text: null,
      subject: null,
    });
    expect(page.needPerson.count).toBe(0);
    const person = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "person", new Date()));
    expect(person.rows).toEqual([]);
  });

  it("an address that didn't pass the provider's checks is nobody's, even a casual's", async () => {
    const t = await inboxFirm();
    const id = await t.store({ authenticated: false, text: "cancel my shift" });
    expect(await t.run(id)).toEqual({ status: "not_casual" });
  });
});

describe("a casual's email, automatic replies off (the default)", () => {
  it("sorted by keyword, held for a person with the AI's draft; nothing sent", async () => {
    const t = await inboxFirm();
    const id = await t.store({ subject: "Shifts", text: "Any work this weekend?" });
    const { ai, asked } = fakeAi({ draft: "Hi Priya,\n\nThe office will look into it." });
    const { transport, sent } = captureTransport();
    expect(await t.run(id, { ai, transport })).toEqual({
      status: "person",
      why: "held",
      sortedAs: "shifts",
      handledAs: "keyword",
      drafted: true,
    });
    expect(sent).toEqual([]);
    // A keyword skips the AI's label; the draft has its greeting taken off.
    expect(asked.map((r) => r.purpose)).toEqual(["draft_reply"]);
    expect(await t.row(id)).toMatchObject({
      handled_as: "keyword",
      intent: "office",
      draft_reply: "The office will look into it.",
    });
    expect(await t.logged(id)).toEqual([
      {
        action: "email.received",
        actor_type: "worker",
        data: {
          handledAs: "keyword",
          intent: "office",
          replyHeld: true,
          sortedAs: "shifts",
          workerId: t.priya,
        },
      },
    ]);
    // Waiting for a person on Enquiries, its page showing the draft.
    const detail = await withFirm(t.f.firmId, (tx) => loadEmailEnquiry(tx, id, new Date()));
    expect(detail).toMatchObject({
      channel: "email",
      outcome: "person_waiting",
      waiting: true,
      pay: false,
      subject: "Shifts",
      text: "Any work this weekend?",
      draft: "The office will look into it.",
      timeline: {
        sorted: { how: "held", by: "keyword", intent: "shifts" },
        reply: { how: "held" },
        sent: { how: "none" },
      },
    });
  });

  it("pay: held, in the Pay view, and never a draft (golden rule 9)", async () => {
    const t = await inboxFirm();
    const id = await t.store({ subject: "Payslip", text: "My payslip looks wrong" });
    const { ai, asked } = fakeAi();
    expect(await t.run(id, { ai })).toMatchObject({
      status: "person",
      why: "held",
      sortedAs: "pay",
      drafted: false,
    });
    expect(asked).toEqual([]);
    expect((await t.row(id))?.draft_reply).toBeNull();
    const pay = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "pay", new Date()));
    expect(pay.rows.map((r) => r.messageId)).toEqual([id]);
    const detail = await withFirm(t.f.firmId, (tx) => loadEmailEnquiry(tx, id, new Date()));
    expect(detail).toMatchObject({ pay: true, draft: null });
  });

  it("the AI's label for the office: drafted; one about money: no draft, whatever it's sorted as", async () => {
    const t = await inboxFirm();
    const id = await t.store({ subject: "Question", text: "Can I bring a friend to training?" });
    const { ai } = fakeAi({ label: "office", draft: "The office will look into it." });
    expect(await t.run(id, { ai })).toMatchObject({
      status: "person",
      why: "office",
      handledAs: "ai",
      drafted: true,
    });
    expect(await t.row(id)).toMatchObject({ handled_as: "ai", intent: "office" });
    const money = await t.store({ subject: "Question", text: "I think I'm owed £40 from June" });
    const second = fakeAi({ label: "office" });
    expect(await t.run(money, { ai: second.ai })).toMatchObject({
      status: "person",
      drafted: false,
    });
    expect(second.asked.map((r) => r.purpose)).toEqual(["classify_message"]);
    // The AI is told it's an email.
    expect(second.asked[0]?.system).toMatch(/an email a casual worker sent/);
  });

  it("no AI: passed to a person, no draft, the reason logged", async () => {
    const t = await inboxFirm();
    // (No keyword: "talk" would be one, for the office.)
    const id = await t.store({ subject: "Tuesday", text: "Is Tuesday still on?" });
    expect(await t.run(id)).toMatchObject({ status: "person", why: "office", drafted: false });
    expect((await t.logged(id))[0]?.data).toMatchObject({
      handledAs: "office",
      intent: "office",
      aiFallback: "not_connected",
    });
    const detail = await withFirm(t.f.firmId, (tx) => loadEmailEnquiry(tx, id, new Date()));
    expect(detail?.timeline.sorted).toEqual({
      how: "person",
      why: "not_sorted",
      ai: "not_connected",
    });
  });
});

describe("a casual's email, automatic replies on", () => {
  it("shifts: its link by email to the address on file, Reply-To the inbox; logged and stored", async () => {
    const t = await inboxFirm({ repliesOn: true });
    const id = await t.store({ subject: "Shifts", text: "Any work this weekend?" });
    const { transport, sent } = captureTransport();
    const result = await t.run(id, { transport });
    expect(result).toMatchObject({ status: "replied", answer: "shifts" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      channel: "email",
      to: t.address,
      replyTo: t.inbox,
      subject: "Re: Shifts",
    });
    const body = sent[0]?.channel === "email" ? sent[0].body : "";
    expect(body).toContain(`\n${portalUrl(t.slug, "shiftdesk.test")}/shifts/open\n`);
    expect(body).toMatch(/^Hi Priya,/);
    const [reply] = await t.replies(id);
    expect(reply).toMatchObject({
      kind: "automatic",
      template: "shifts",
      to_address: t.address,
      subject: "Re: Shifts",
      body,
    });
    expect((await t.logged(id)).map((e) => [e.action, e.data])).toEqual([
      ["email.received", { handledAs: "keyword", intent: "shifts", workerId: t.priya }],
      ["email.replied", { replyId: reply?.id, answer: "shifts", workerId: t.priya }],
    ]);
    expect(await t.row(id)).toMatchObject({ intent: "shifts", draft_reply: null });
    const detail = await withFirm(t.f.firmId, (tx) => loadEmailEnquiry(tx, id, new Date()));
    expect(detail).toMatchObject({
      outcome: "keyword",
      waiting: false,
      timeline: { reply: { how: "automatic", answer: "shifts" }, sent: { how: "sent" } },
      replies: [{ automatic: true, state: "sent", body }],
    });
  });

  it("cancel and pay by the AI's label: their own links; pay never an answer", async () => {
    const t = await inboxFirm({ repliesOn: true });
    const cancel = await t.store({ subject: "Friday", text: "I can't do Friday any more" });
    const { transport, sent } = captureTransport();
    expect(await t.run(cancel, { transport, ai: fakeAi({ label: "cancel" }).ai })).toMatchObject({
      status: "replied",
      answer: "cancel",
    });
    const pay = await t.store({ subject: "Hours", text: "How many hours did I do in May?" });
    expect(await t.run(pay, { transport, ai: fakeAi({ label: "pay" }).ai })).toMatchObject({
      status: "replied",
      answer: "pay",
    });
    const bodies = sent.map((m) => (m.channel === "email" ? m.body : ""));
    expect(bodies[0]).toContain(`/shifts\n`);
    expect(bodies[0]).not.toContain("/shifts/open");
    expect(bodies[1]).toContain(`/pay\n`);
    expect(bodies[1]).toContain('tap "Raise a pay query" there');
  });

  it("at most 3 link emails to a casual in 24 hours: the next waits for a person", async () => {
    const t = await inboxFirm({ repliesOn: true });
    const { transport, sent } = captureTransport();
    for (let i = 0; i < AUTOMATIC_PER_DAY; i++) {
      const id = await t.store({ subject: `Work ${i}`, text: "Any shifts?" });
      expect((await t.run(id, { transport })).status).toBe("replied");
    }
    const fourth = await t.store({ subject: "Work again", text: "Any shifts?" });
    expect(await t.run(fourth, { transport })).toMatchObject({
      status: "person",
      why: "limit",
      sortedAs: "shifts",
    });
    expect(sent).toHaveLength(AUTOMATIC_PER_DAY);
    expect((await t.logged(fourth))[0]?.data).toMatchObject({
      intent: "office",
      replyLimit: true,
      sortedAs: "shifts",
    });
  });

  it("no address on file now: waits for a person", async () => {
    const t = await inboxFirm({ repliesOn: true });
    const id = await t.store({ subject: "Shifts", text: "Any work?" });
    await su.query("update workers set email = null where id = $1", [t.priya]);
    expect(await t.run(id)).toMatchObject({ status: "person", why: "no_address" });
    expect(await t.replies(id)).toEqual([]);
  });

  it("a link email that fails: logged with its code, never sent again", async () => {
    const t = await inboxFirm({ repliesOn: true });
    const id = await t.store({ subject: "Shifts", text: "Any work?" });
    const broken: MessagingTransport = {
      name: "broken",
      send: async () => {
        throw Object.assign(new Error("refused"), { name: "SmtpRefused" });
      },
    };
    expect(await t.run(id, { transport: broken })).toMatchObject({
      status: "reply_failed",
      code: "SmtpRefused",
    });
    expect((await t.logged(id)).at(-1)).toMatchObject({
      action: "email.reply_failed",
      data: { answer: "shifts", code: "SmtpRefused" },
    });
    const { transport, sent } = captureTransport();
    expect(await t.run(id, { transport })).toEqual({ status: "already" });
    expect(sent).toEqual([]);
    const detail = await withFirm(t.f.firmId, (tx) => loadEmailEnquiry(tx, id, new Date()));
    expect(detail?.timeline.sent).toMatchObject({ how: "failed", code: "SmtpRefused" });
  });

  it("the same job twice: handled and answered once", async () => {
    const t = await inboxFirm({ repliesOn: true });
    const id = await t.store({ subject: "Shifts", text: "Any work?" });
    const { transport, sent } = captureTransport();
    const [a, b] = await Promise.all([t.run(id, { transport }), t.run(id, { transport })]);
    expect([a?.status, b?.status].sort()).toEqual(["already", "replied"]);
    expect(sent).toHaveLength(1);
    expect(await t.replies(id)).toHaveLength(1);
  });
});

describe("to a person unsorted", () => {
  it(`stored more than ${STALE_HOURS} hours before it could be sorted`, async () => {
    const t = await inboxFirm({ repliesOn: true });
    const id = await t.store({ subject: "Cancel", text: "cancel my shift" });
    await su.query(
      "update inbound_emails set created_at = now() - interval '4 hours' where id = $1",
      [id],
    );
    const { transport, sent } = captureTransport();
    expect(await t.run(id, { transport })).toMatchObject({ status: "person", why: "stale" });
    expect(sent).toEqual([]);
    expect(await t.row(id)).toMatchObject({ handled_as: "office", intent: "office" });
    expect((await t.logged(id))[0]).toMatchObject({
      actor_type: "worker",
      data: { handledAs: "office", stale: true, workerId: t.priya },
    });
  });

  it("from someone who isn't active any more", async () => {
    const t = await inboxFirm({ repliesOn: true });
    const id = await t.store({ subject: "Shifts", text: "Any work?" });
    await su.query("update workers set status = 'inactive' where id = $1", [t.priya]);
    expect(await t.run(id)).toMatchObject({ status: "person", why: "former" });
    expect((await t.logged(id))[0]).toMatchObject({
      actor_type: "system",
      data: { formerWorker: true, workerId: t.priya },
    });
  });

  it("the last try fails: passed to a person with the code, and the job still fails", async () => {
    const t = await inboxFirm();
    const id = await t.store({ subject: "Hello", text: "Hello" });
    const exploding = createFakeAi(() => "office");
    // The read works; the claim's transaction fails (the database lost), then marking it works.
    let calls = 0;
    const boom: WithFirm = (firmId, fn) => {
      calls += 1;
      if (calls === 2) return Promise.reject(Object.assign(new Error("lost"), { code: "08006" }));
      return withFirm(firmId, fn);
    };
    await expect(
      runInboundEmailWithLastTry(
        t.payload(id),
        boom,
        { transport: captureTransport().transport, ai: exploding, baseDomain: "shiftdesk.test" },
        { retryCount: 3, retryLimit: 3 },
      ),
    ).rejects.toThrow("lost");
    expect(await t.row(id)).toMatchObject({ handled_as: "office", intent: "office" });
    expect((await t.logged(id))[0]?.data).toMatchObject({ answerFailed: "08006" });
  });
});

describe("one firm, and the queue", () => {
  it("another firm's email is gone to this firm's job", async () => {
    const t = await inboxFirm();
    const other = await inboxFirm();
    const id = await other.store({ text: "Any work?" });
    const result = await runInboundEmail({ ...t.payload(id), firmId: t.f.firmId }, withFirm, {
      transport: captureTransport().transport,
      ai: noAi,
      baseDomain: "shiftdesk.test",
    });
    expect(result).toEqual({ status: "gone" });
    expect((await other.row(id))?.handled_at).toBeNull();
  });

  it("each handled email queues its slot's summary, once a slot", async () => {
    const t = await inboxFirm();
    for (const text of ["Hello", "Hi again"]) await t.run(await t.store({ text }));
    const { rows } = await su.query<{ data: Record<string, unknown>; start_after: Date }>(
      `select data, start_after from pgboss.job
        where name = 'inbox-summary' and data ->> 'firmId' = $1`,
      [t.f.firmId],
    );
    expect(rows).toHaveLength(1);
    const end = new Date(String(rows[0]?.data.slotEnd));
    expect(rows[0]?.start_after.getTime()).toBe(end.getTime() + 60_000);
    expect(Object.keys(rows[0]?.data ?? {}).sort()).toEqual([
      "firmId",
      "idempotencyKey",
      "slotEnd",
      "slotStart",
    ]);
  });

  it("the hourly sweep queues a firm's emails left unhandled 10 minutes on, and only those", async () => {
    const t = await inboxFirm();
    const lost = await t.store({ text: "lost" });
    const fresh = await t.store({ text: "fresh" });
    const done = await t.store({ text: "done" });
    await t.run(done);
    await su.query(
      "update inbound_emails set created_at = now() - interval '20 minutes' where id = any($1)",
      [[lost, done]],
    );
    await su.query(
      "delete from pgboss.job where name = 'inbound-email' and data ->> 'firmId' = $1",
      [t.f.firmId],
    );
    await runInboundEmailTick({ listFirmIds: async () => [t.f.firmId], run: withFirm });
    // Again within the hour: queued once.
    await runInboundEmailTick({ listFirmIds: async () => [t.f.firmId], run: withFirm });
    const { rows } = await su.query<{ data: Record<string, unknown> }>(
      "select data from pgboss.job where name = 'inbound-email' and data ->> 'firmId' = $1",
      [t.f.firmId],
    );
    expect(rows.map((r) => r.data.emailId)).toEqual([lost]);
    expect(fresh).not.toBe(lost);
  });
});
