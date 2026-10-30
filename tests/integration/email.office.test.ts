import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeAi, noAi } from "@/lib/ai/client";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { receiveEmail } from "@/lib/email/receive";
import { runInboundEmail } from "@/lib/email/sort";
import { runInboxSummary, summarySlotOf } from "@/lib/email/summary";
import type { MessagingTransport } from "@/lib/messaging/transport";
import { runEnquiryEmailReply } from "@/lib/notices/email-reply";
import { loadEmailEnquiry, loadEnquiries, needPersonCount } from "@/lib/office/enquiries";
import { closeEnquiry, replyToEmail } from "@/lib/office/enquiry-actions";
import { captureTransport } from "../helpers/auth";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The office and the staffing inbox (P7.5; Phase 25.5) on the real database as the app role: the
// office answers a casual's email by email, from the AI's draft or in their own words, to the
// address on file (`email_replies`, `enquiry.answered` with ids and codes only), sent at most once
// by its job (Reply-To the inbox; a failure puts it back in Need a person); or closes it; one not
// from a casual is never answered or closed here; another firm's is never found. And the inbox's
// summary every 3 hours: once a slot, counts only, to active admins and resourcers. Made-up people
// and addresses only.

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

async function inboxFirm(o: { repliesOn?: true } = {}) {
  const f = await bookingFirm(su, withFirm, {
    settings: o.repliesOn ? { auto_replies: true } : {},
  });
  const inbox = `staffing-${randomBytes(4).toString("hex")}@inbound.example.test`;
  await su.query("update firms set inbox_address = $2 where id = $1", [f.firmId, inbox]);
  const priya = await f.worker({ first: "Priya" });
  const address = `priya.${randomBytes(3).toString("hex")}@example.com`;
  await su.query("update workers set email = $2 where id = $1", [priya, address]);
  const resourcer = await f.office("resourcer");
  const ctx = (officeUserId = resourcer) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
  });
  // Stored as the webhook would, then sorted by its job (no AI unless given).
  const email = async (
    e: { from?: string; subject?: string; text?: string },
    o: { draft?: string; label?: string; failSend?: true } = {},
  ) => {
    const messageId = `<${randomBytes(6).toString("hex")}@mail.example.test>`;
    await receiveEmail(
      f.firmId,
      {
        messageId,
        from: e.from ?? address,
        authenticated: true,
        to: inbox,
        subject: e.subject ?? "Training",
        text: e.text ?? "Can I bring my own boots?",
        attachments: 0,
      },
      { run: withFirm },
    );
    const { rows } = await su.query<{ id: string }>(
      "select id::text as id from inbound_emails where firm_id = $1 and provider_message_id = $2",
      [f.firmId, messageId],
    );
    const id = rows[0]?.id ?? "";
    const failing: MessagingTransport = {
      name: "failing",
      send: async () => {
        throw new Error("down");
      },
    };
    const ai =
      o.draft || o.label
        ? createFakeAi((r) =>
            r.purpose === "draft_reply" ? (o.draft ?? "") : (o.label ?? "office"),
          )
        : noAi;
    await runInboundEmail(
      { firmId: f.firmId, idempotencyKey: `inbound-email:${id}`, emailId: id },
      withFirm,
      {
        transport: o.failSend ? failing : captureTransport().transport,
        ai,
        baseDomain: "shiftdesk.test",
      },
    );
    return id;
  };
  const replyJob = (replyId: string, transport: MessagingTransport) =>
    runEnquiryEmailReply(
      { firmId: f.firmId, idempotencyKey: `enquiry-email-reply:${replyId}`, replyId },
      withFirm,
      { transport },
    );
  const logged = async (id: string) =>
    (
      await su.query<{ action: string; actor_type: string; data: Record<string, unknown> }>(
        "select action, actor_type, data from events where entity_id = $1 order by id",
        [id],
      )
    ).rows;
  const replyRows = async (id: string) =>
    (
      await su.query<{
        id: string;
        kind: string;
        sent_by: string | null;
        from_draft: boolean;
        to_address: string;
        subject: string;
        body: string;
      }>(
        `select id::text as id, kind, sent_by::text as sent_by, from_draft, to_address, subject, body
           from email_replies where inbound_email_id = $1 order by created_at`,
        [id],
      )
    ).rows;
  return { f, inbox, priya, address, resourcer, ctx, email, replyJob, logged, replyRows };
}

describe("the office answers a casual's email", () => {
  it("from the AI's draft: stored to the address on file, logged with ids, sent once with Reply-To the inbox", async () => {
    const t = await inboxFirm();
    const id = await t.email({}, { draft: "The office will check and come back to you." });
    const page = await withFirm(t.f.firmId, (tx) => loadEmailEnquiry(tx, id, new Date()));
    expect(page).toMatchObject({
      waiting: true,
      draft: "The office will check and come back to you.",
    });

    // The person changes it before sending.
    const words = "Yes, bring your own boots.\n\nSee you Saturday.";
    expect(await replyToEmail(t.ctx(), id, `  ${words}  `)).toEqual({ status: "queued" });
    const [reply] = await t.replyRows(id);
    expect(reply).toMatchObject({
      kind: "office",
      sent_by: t.resourcer,
      from_draft: true,
      to_address: t.address,
      subject: "Re: Training",
      body: `Hi Priya,\n\n${words}\n\n— ${await firmName(t.f.firmId)} Shift Team`,
    });
    const answered = (await t.logged(id)).find((e) => e.action === "enquiry.answered");
    expect(answered).toEqual({
      action: "enquiry.answered",
      actor_type: "office",
      data: { replyId: reply?.id, channel: "email", form: "edited", workerId: t.priya },
    });
    // No longer waiting: answered (while its job sends it).
    expect(await withFirm(t.f.firmId, (tx) => needPersonCount(tx, new Date()))).toBe(0);
    expect(await replyToEmail(t.ctx(), id, "Again")).toEqual({ status: "not_waiting" });

    // The job sends it once.
    const { transport, sent } = captureTransport();
    expect(await t.replyJob(reply?.id ?? "", transport)).toEqual({ status: "sent" });
    expect(await t.replyJob(reply?.id ?? "", transport)).toEqual({ status: "already" });
    expect(sent).toEqual([
      {
        channel: "email",
        to: t.address,
        replyTo: t.inbox,
        subject: "Re: Training",
        body: reply?.body,
      },
    ]);
    expect((await t.logged(id)).map((e) => e.action)).toEqual([
      "email.received",
      "email.drafted",
      "enquiry.answered",
      "enquiry.reply_sending",
      "enquiry.reply_sent",
    ]);
    const after = await withFirm(t.f.firmId, (tx) => loadEmailEnquiry(tx, id, new Date()));
    expect(after).toMatchObject({
      outcome: "person_answered",
      waiting: false,
      draft: null,
      replies: [{ automatic: false, state: "sent", body: reply?.body }],
      timeline: {
        then: [{ kind: "office_reply", channel: "email", form: "edited", state: "sent" }],
      },
    });
  });

  it("the office's reply job never sends an automatic reply", async () => {
    const t = await inboxFirm({ repliesOn: true });
    const id = await t.email({ subject: "Shifts", text: "Any work?" });
    const [automatic] = await t.replyRows(id);
    expect(automatic?.kind).toBe("automatic");
    const { transport, sent } = captureTransport();
    expect(await t.replyJob(automatic?.id ?? "", transport)).toEqual({ status: "gone" });
    expect(sent).toEqual([]);
  });

  it("the AI's draft sent as it was: logged as the draft, checked", async () => {
    const t = await inboxFirm();
    const draft = "The office will check and come back to you.";
    const id = await t.email({}, { draft });
    expect(await replyToEmail(t.ctx(), id, draft)).toEqual({ status: "queued" });
    expect((await t.logged(id)).find((e) => e.action === "enquiry.answered")?.data).toMatchObject({
      form: "draft",
    });
    expect((await t.replyRows(id))[0]?.from_draft).toBe(true);
  });

  it("in their own words (no draft); a failed send puts it back in Need a person", async () => {
    const t = await inboxFirm();
    const id = await t.email({});
    expect(await replyToEmail(t.ctx(), id, "Yes.")).toEqual({ status: "queued" });
    const [reply] = await t.replyRows(id);
    expect(reply?.from_draft).toBe(false);
    expect((await t.logged(id)).find((e) => e.action === "enquiry.answered")?.data).toMatchObject({
      form: "free_text",
    });
    const broken: MessagingTransport = {
      name: "broken",
      send: async () => {
        throw Object.assign(new Error("no"), { name: "SmtpRefused" });
      },
    };
    expect(await t.replyJob(reply?.id ?? "", broken)).toEqual({
      status: "failed",
      code: "SmtpRefused",
    });
    expect(await withFirm(t.f.firmId, (tx) => needPersonCount(tx, new Date()))).toBe(1);
    const page = await withFirm(t.f.firmId, (tx) => loadEmailEnquiry(tx, id, new Date()));
    expect(page).toMatchObject({
      waiting: true,
      replies: [{ state: "failed" }],
      timeline: { then: [{ kind: "office_reply", state: "failed", code: "SmtpRefused" }] },
    });
  });

  it("refused: empty, too long, no address on file, not allowed; another firm's isn't found", async () => {
    const t = await inboxFirm();
    const id = await t.email({});
    expect(await replyToEmail(t.ctx(), id, "  \n ")).toEqual({ status: "empty" });
    expect(await replyToEmail(t.ctx(), id, "x".repeat(2001))).toEqual({ status: "too_long" });
    expect((await replyToEmail(t.ctx(), id, "x".repeat(2000))).status).toBe("queued");
    const second = await t.email({ subject: "Boots" });
    await su.query("update workers set email = null where id = $1", [t.priya]);
    expect(await replyToEmail(t.ctx(), second, "Yes")).toEqual({ status: "no_address" });
    const payroll = await t.f.office("payroll");
    expect(await replyToEmail(t.ctx(payroll), second, "Yes")).toEqual({ status: "not_allowed" });
    const other = await inboxFirm();
    const theirs = await other.email({});
    expect(await replyToEmail(t.ctx(), theirs, "Yes")).toEqual({ status: "not_found" });
    expect(await closeEnquiry(t.ctx(), theirs, "spam")).toEqual({ status: "not_found" });
    expect(await other.replyRows(theirs)).toEqual([]);
  });

  it("closed without a reply; one not from a casual is never the office's here", async () => {
    const t = await inboxFirm();
    const id = await t.email({});
    expect(await closeEnquiry(t.ctx(), id, "by_phone")).toEqual({ status: "closed" });
    expect(await closeEnquiry(t.ctx(), id, "by_phone")).toEqual({ status: "not_waiting" });
    expect((await t.logged(id)).at(-1)).toEqual({
      action: "enquiry.closed",
      actor_type: "office",
      data: { reason: "by_phone", channel: "email", workerId: t.priya },
    });
    const stranger = await t.email({ from: "venue@example.org" });
    expect(await closeEnquiry(t.ctx(), stranger, "spam")).toEqual({ status: "not_waiting" });
    expect(await replyToEmail(t.ctx(), stranger, "Hi")).toEqual({ status: "not_waiting" });
  });
});

async function firmName(firmId: string): Promise<string> {
  const { rows } = await su.query<{ name: string }>("select name from firms where id = $1", [
    firmId,
  ]);
  return rows[0]?.name ?? "";
}

describe("Enquiries with the inbox's emails", () => {
  it("lists them beside the shifts line's, newest first, counted; Need a person oldest first", async () => {
    const t = await inboxFirm();
    const a = await t.email({ subject: "First", text: "Is Tuesday still on?" });
    const b = await t.email({ from: "venue@example.org" });
    const c = await t.email({ subject: "Third", text: "Can I bring a friend?" });
    await su.query(
      `update inbound_emails set created_at = now() - make_interval(mins => case id
         when $1::uuid then 30 when $2::uuid then 20 else 10 end)
        where id = any($3)`,
      [a, b, [a, b, c]],
    );
    const all = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "all", new Date()));
    expect(all.rows.map((r) => r.messageId)).toEqual([c, b, a]);
    expect(all.rows[0]).toMatchObject({
      channel: "email",
      subject: "Third",
      text: "Can I bring a friend?",
      outcome: "person_waiting",
      who: { kind: "casual", name: expect.stringMatching(/^Priya/) },
    });
    expect(all.needPerson.count).toBe(2);
    const person = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "person", new Date()));
    expect(person.rows.map((r) => r.messageId)).toEqual([a, c]);
  });

  it("a firm with no inbox reads as before", async () => {
    const f = await bookingFirm(su, withFirm);
    const page = await withFirm(f.firmId, (tx) => loadEnquiries(tx, "all", new Date()));
    expect(page).toMatchObject({ inbox: false, rows: [] });
  });
});

describe("the inbox's summary every 3 hours", () => {
  it("once a slot, counts by what came of them, to active admins and resourcers", async () => {
    const t = await inboxFirm({ repliesOn: true });
    const admin = await t.f.office("admin");
    await t.f.office("payroll");
    await t.f.office("resourcer", "disabled");
    await t.email({ subject: "Shifts", text: "Any work?" }); // a link
    await t.email({ subject: "Training", text: "Is Tuesday still on?" }); // waiting
    await t.email({ subject: "Payslip", text: "My payslip is wrong" }); // pay (a link)
    const closed = await t.email({ subject: "Boots", text: "Is Friday still on?" });
    await closeEnquiry(t.ctx(), closed, "by_phone"); // the office's
    await t.email({ from: "venue@example.org" }); // not a casual
    // A link email that failed: back with a person, so waiting (never "answered by your office").
    await t.email({ subject: "Work", text: "Any work going?" }, { failSend: true });
    // One whose job stopped part-way (no word on whether it went): counted nowhere.
    const unsure = await t.email({ subject: "More", text: "Any more work?" });
    await su.query("delete from events where entity_id = $1 and action = 'email.replied'", [
      unsure,
    ]);
    const slot = summarySlotOf(new Date(), "Europe/London");
    const payload = {
      firmId: t.f.firmId,
      idempotencyKey: `inbox-summary:${slot.start.getTime()}`,
      slotStart: slot.start.toISOString(),
      slotEnd: slot.end.toISOString(),
    };
    const { transport, sent } = captureTransport();
    const result = await runInboxSummary(payload, withFirm, {
      transport,
      baseDomain: "shiftdesk.test",
    });
    expect(result).toMatchObject({
      status: "sent",
      counts: { emails: 7, linked: 1, waiting: 2, office: 1, pay: 1, notCasuals: 1 },
      emailed: 2,
      failed: 0,
    });
    const { rows: office } = await su.query<{ email: string }>(
      "select email from office_users where id = any($1) order by email",
      [[admin, t.resourcer]],
    );
    expect(sent.map((m) => m.to).sort()).toEqual(office.map((o) => o.email).sort());
    const body = sent[0]?.channel === "email" ? sent[0].body : "";
    expect(body).toContain("got 7 emails:");
    expect(body).not.toMatch(/Priya|example\.com|example\.org|boots|payslip/i);
    // Again: claimed, nothing more.
    expect(
      await runInboxSummary(payload, withFirm, { transport, baseDomain: "shiftdesk.test" }),
    ).toEqual({ status: "already" });
    expect(sent).toHaveLength(2);
    const { rows: entries } = await su.query<{ data: Record<string, unknown> }>(
      "select data from events where firm_id = $1 and action = 'message.inbox_summary'",
      [t.f.firmId],
    );
    expect(entries.map((e) => e.data)).toEqual([
      expect.objectContaining({ received: 7, recipients: 2, failed: 0, skipped: 0 }),
    ]);
  });

  it("a slot with no email sends nothing; with nobody to send to, it says so", async () => {
    const t = await inboxFirm();
    const empty = summarySlotOf(new Date(Date.now() - 86_400_000), "Europe/London");
    const { transport, sent } = captureTransport();
    expect(
      await runInboxSummary(
        {
          firmId: t.f.firmId,
          idempotencyKey: `inbox-summary:${empty.start.getTime()}`,
          slotStart: empty.start.toISOString(),
          slotEnd: empty.end.toISOString(),
        },
        withFirm,
        { transport, baseDomain: "shiftdesk.test" },
      ),
    ).toEqual({ status: "none" });
    await t.email({});
    await su.query("update office_users set status = 'disabled' where firm_id = $1", [t.f.firmId]);
    const slot = summarySlotOf(new Date(), "Europe/London");
    expect(
      await runInboxSummary(
        {
          firmId: t.f.firmId,
          idempotencyKey: `inbox-summary:${slot.start.getTime()}`,
          slotStart: slot.start.toISOString(),
          slotEnd: slot.end.toISOString(),
        },
        withFirm,
        { transport, baseDomain: "shiftdesk.test" },
      ),
    ).toMatchObject({ status: "no_recipients", counts: { emails: 1, waiting: 1 } });
    expect(sent).toEqual([]);
  });
});
