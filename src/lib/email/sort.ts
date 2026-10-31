import { eq, sql } from "drizzle-orm";
import { getAi } from "../ai/anthropic";
import { sortMessage, type AiFallback } from "../ai/classify-message";
import type { AiClient } from "../ai/client";
import { draftEmailReply } from "../ai/draft-reply";
import { emailReplies, inboundEmails } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { errorCode, sendFirmJob, type FirmTask, type JobAttempt } from "../jobs/firm-job";
import { log } from "../log";
import { getTransport, type MessagingTransport } from "../messaging";
import { inboxAnswerEmail, type InboxAnswer } from "../messaging/templates";
import { autoRepliesOn } from "../inbound/limits";
import { keywordIntent, type Intent } from "../inbound/keywords";
import { portalUrl } from "../tenancy/portal-url";
import { signOffFor } from "../tenancy/sign-off";
import { INBOUND_EMAIL_RETRY_LIMIT, inboundEmailJob, type InboundEmailPayload } from "./job";
import { queueInboxSummary } from "./summary";

// Sorting an email to the firm's staffing inbox (P7.4 and P7.5; docs/api-and-jobs.md
// `inbound-email`; docs/messaging-templates.md "The staffing inbox's emails"). One job per stored
// email (src/lib/email/receive.ts), as the shifts line's message (src/lib/inbound/reply.ts), whose
// rules it keeps: the AI only sorts (and drafts for the office), code decides; nothing is written
// before the claim, so a failure before it is simply retried, and after it nothing goes twice:
//   1. a read: the email, its casual (an active worker here) and the firm. Not from a casual: left
//      for the firm's own inbox (where it already is), with no words kept. From someone who isn't
//      active any more, or stored more than STALE_HOURS before this job could sort it (a stale
//      "cancel me" isn't one): the office's, unsorted;
//   2. a keyword in its subject and words, else the AI's label, outside any transaction, else the
//      office (src/lib/inbound/keywords.ts, src/lib/ai/classify-message.ts);
//   3. the claim, in one transaction: the email locked and, if no one has handled it yet, marked
//      handled; a link email's row (`email_replies`) when one goes; `email.received` (labels and
//      ids only); the slot's office summary queued (src/lib/email/summary.ts);
//   4. with the firm's automatic replies on (P4.7), a shifts, cancel or pay email gets its link,
//      by email, to the address the firm holds for them (never the one it came from: a sender can
//      be faked), outside any transaction, at most AUTOMATIC_PER_DAY a casual in 24 hours; then
//      `email.replied` or `email.reply_failed` (never retried). With them off, or past that, it
//      waits for a person (`replyHeld` / `replyLimit` / `nothingOnFile`, with what it was sorted
//      as: `sortedAs`);
//   5. an email for a person gets the AI's draft of a reply for the office to check (never one
//      sorted as pay, nor one whose words are about pay or money: golden rule 9), saved on the
//      email; none when there's no AI or no usable draft.
// The link email is always the app's fixed text (inboxAnswerEmail()): nothing the AI writes reaches
// the casual from here. A failure before the claim is retried by the queue; on its last try the
// email is passed to a person, and the job still fails (runInboundEmailWithLastTry, below).

export const STALE_HOURS = 3;
export const AUTOMATIC_PER_DAY = 3;

// Words about pay or money (golden rule 9): an email with any gets no AI draft, whatever it was
// sorted as, and a draft with any is thrown away. Whole words, any case; "£" or "€" anywhere. Wide
// on purpose: a word missed lets a pay question get a draft, a word too many only leaves the office
// to write its own.
const MONEY =
  /\b(pay|paid|paying|payment|payments|payroll|payslips?|paye|underpaid|overpaid|unpaid|wages?|salary|money|owed|owe|owes|owing|overtime|tax|hmrc|p45|p60|invoices?|refunds?|deductions?|deducted|rates?|hourly|hours|timesheets?|expenses|bonus|mileage|bacs|bank|pension|ssp|sick pay|holiday pay|cash)\b|[£€]/i;
export const aboutMoney = (text: string): boolean => MONEY.test(text);

export interface InboundEmailDeps {
  transport: MessagingTransport;
  ai: AiClient;
  baseDomain: string;
  aiTimeoutMs?: number; // tests pass a short one
  draftTimeoutMs?: number;
}

export type InboundEmailResult =
  | { status: "already" }
  | { status: "gone" }
  | { status: "not_casual" } // left for the firm's own inbox
  // For a person: why, what it was sorted as (when it was), and whether the AI drafted a reply.
  | {
      status: "person";
      why: "office" | "held" | "limit" | "no_address" | "stale" | "former";
      sortedAs: Intent | null;
      handledAs: "keyword" | "ai" | "office";
      drafted: boolean;
    }
  | { status: "replied"; answer: InboxAnswer; replyId: string }
  | { status: "reply_failed"; answer: InboxAnswer; replyId: string; code: string };

type Firm = { name: string; slug: string; signOff: string; timezone: string; inbox: string | null };

type Read =
  | { kind: "done"; result: InboundEmailResult }
  | { kind: "not_casual" }
  | { kind: "former"; workerId: string }
  | { kind: "stale"; workerId: string }
  | {
      kind: "known";
      workerId: string;
      firstName: string;
      address: string | null; // the address the firm holds for them now
      subject: string | null;
      body: string | null;
      firm: Firm;
      autoReplies: boolean;
      repliedToday: number; // link emails that went to them in the last 24 hours
    };

// Step 1: reads only. "Stale" and "today" by the database's clock, as the email's `created_at`.
async function read(tx: FirmTx, emailId: string): Promise<Read> {
  const { rows } = await tx.execute<{
    handled_at: string | Date | null;
    worker_id: string | null;
    subject: string | null;
    body: string | null;
    stale: boolean;
    status: string | null;
    erased_at: string | Date | null;
    first_name: string | null;
    email: string | null;
    firm_name: string;
    slug: string;
    timezone: string;
    settings: Record<string, unknown>;
    inbox_address: string | null;
    replied_today: number;
  }>(sql`
    select e.handled_at, e.worker_id, e.subject, e.body,
           e.created_at < now() - make_interval(hours => ${STALE_HOURS}) as stale,
           w.status, w.erased_at, w.first_name, w.email,
           f.name as firm_name, f.slug, f.timezone, f.settings, f.inbox_address,
           (select count(*)::int from events x
             where x.firm_id = e.firm_id and x.worker_ref = e.worker_id::text
               and x.action = 'email.replied' and x.created_at > now() - interval '24 hours')
             as replied_today
      from inbound_emails e
      join firms f on f.id = e.firm_id
      left join workers w on w.firm_id = e.firm_id and w.id = e.worker_id
     where e.id = ${emailId}
  `);
  const e = rows[0];
  if (!e) return { kind: "done", result: { status: "gone" } };
  if (e.handled_at !== null) return { kind: "done", result: { status: "already" } };
  if (!e.worker_id) return { kind: "not_casual" };
  if (e.status !== "active" || e.erased_at !== null) {
    return { kind: "former", workerId: e.worker_id };
  }
  if (e.stale) return { kind: "stale", workerId: e.worker_id };
  return {
    kind: "known",
    workerId: e.worker_id,
    firstName: e.first_name ?? "",
    address: e.email,
    subject: e.subject,
    body: e.body,
    firm: {
      name: e.firm_name,
      slug: e.slug,
      signOff: signOffFor(e.firm_name, e.settings.sign_off),
      timezone: e.timezone,
      inbox: e.inbox_address,
    },
    autoReplies: autoRepliesOn(e.settings),
    repliedToday: e.replied_today,
  };
}

// Locks the email: when it came in if this run is the one handling it (nobody has yet), else null.
async function lockUnhandled(tx: FirmTx, emailId: string): Promise<Date | null> {
  const [e] = await tx
    .select({ handledAt: inboundEmails.handledAt, createdAt: inboundEmails.createdAt })
    .from(inboundEmails)
    .where(eq(inboundEmails.id, emailId))
    .for("update");
  return e !== undefined && e.handledAt === null ? e.createdAt : null;
}

async function firmTimeZone(tx: FirmTx): Promise<string> {
  const { rows } = await tx.execute<{ timezone: string }>(sql`
    select timezone from firms where id = app_current_firm_id()
  `);
  return rows[0]?.timezone ?? "Europe/London";
}

// Marks it handled with no reply and logs `email.received`, in one claim: not from a casual, or
// the office's unsorted (someone not active any more, a stale email, the last try's failure).
async function claimPlain(
  run: WithFirm,
  payload: InboundEmailPayload,
  how: {
    handledAs: "unknown" | "office";
    workerId: string | null;
    active: boolean;
    data: Record<string, unknown>;
  },
): Promise<boolean> {
  return run(payload.firmId, async (tx) => {
    const came = await lockUnhandled(tx, payload.emailId);
    if (!came) return false;
    const intent = how.handledAs === "office" ? ("office" as const) : null;
    await tx
      .update(inboundEmails)
      .set({ handledAt: new Date(), handledAs: how.handledAs, intent })
      .where(eq(inboundEmails.id, payload.emailId));
    await recordEvent(tx, {
      ...(how.workerId && how.active
        ? { actorType: "worker", actorId: how.workerId }
        : { actorType: "system" }),
      action: "email.received",
      entityType: "inbound_email",
      entityId: payload.emailId,
      data: {
        handledAs: how.handledAs,
        intent,
        ...how.data,
        ...(how.workerId ? { workerId: how.workerId } : {}),
      },
    });
    // The summary of the slot it came in (the one that counts it).
    await queueInboxSummary(tx, came, await firmTimeZone(tx));
    return true;
  });
}

const LINKS: Record<InboxAnswer, string> = {
  shifts: "/shifts/open",
  cancel: "/shifts",
  pay: "/pay",
};

export async function runInboundEmail(
  payload: InboundEmailPayload,
  run: WithFirm,
  deps: InboundEmailDeps,
): Promise<InboundEmailResult> {
  const c = await run(payload.firmId, (tx) => read(tx, payload.emailId));
  if (c.kind === "done") return c.result;
  if (c.kind === "not_casual") {
    const claimed = await claimPlain(run, payload, {
      handledAs: "unknown",
      workerId: null,
      active: false,
      data: {},
    });
    return claimed ? { status: "not_casual" } : { status: "already" };
  }
  if (c.kind === "former" || c.kind === "stale") {
    const claimed = await claimPlain(run, payload, {
      handledAs: "office",
      workerId: c.workerId,
      active: c.kind === "stale",
      data: c.kind === "former" ? { formerWorker: true } : { stale: true },
    });
    if (!claimed) return { status: "already" };
    return { status: "person", why: c.kind, sortedAs: null, handledAs: "office", drafted: false };
  }

  // Step 2: what they asked, from the subject and their words.
  const text = [c.subject, c.body].filter((t): t is string => !!t?.trim()).join("\n");
  let intent: Intent;
  let handledAs: "keyword" | "ai" | "office";
  let aiFallback: AiFallback | "no_text" | null = null;
  const keyword = text ? keywordIntent(text) : null;
  if (keyword) {
    intent = keyword;
    handledAs = "keyword";
  } else if (!text) {
    intent = "office";
    handledAs = "office";
    aiFallback = "no_text";
  } else {
    const sorted = await sortMessage(text, deps.ai, { timeoutMs: deps.aiTimeoutMs, via: "email" });
    intent = sorted.label ?? "office";
    handledAs = sorted.label ? "ai" : "office";
    if (!sorted.label) aiFallback = sorted.why;
  }

  // Whether its link goes (step 4), else why it waits for a person.
  const sortedAs = intent;
  const answer: InboxAnswer | null = intent === "office" ? null : intent;
  const held: "held" | "limit" | "no_address" | null =
    answer === null
      ? null
      : !c.autoReplies
        ? "held"
        : c.repliedToday >= AUTOMATIC_PER_DAY
          ? "limit"
          : !c.address
            ? "no_address"
            : null;
  if (held) intent = "office";
  const link =
    answer && !held ? `${portalUrl(c.firm.slug, deps.baseDomain)}${LINKS[answer]}` : null;
  const voice = { name: c.firm.name, signOff: c.firm.signOff };

  // Step 3: the claim, the link email's row, the event and the summary, together.
  const claimed = await run(payload.firmId, async (tx) => {
    const came = await lockUnhandled(tx, payload.emailId);
    if (!came) return null;
    await tx
      .update(inboundEmails)
      .set({ handledAt: new Date(), handledAs, intent })
      .where(eq(inboundEmails.id, payload.emailId));
    let reply: { id: string; to: string; subject: string; body: string } | null = null;
    if (answer && link && c.address) {
      const email = inboxAnswerEmail(voice, answer, {
        firstName: c.firstName,
        subject: c.subject,
        link,
      });
      const [row] = await tx
        .insert(emailReplies)
        .values({
          firmId: sql`app_current_firm_id()`,
          inboundEmailId: payload.emailId,
          workerId: c.workerId,
          kind: "automatic",
          template: answer,
          toAddress: c.address,
          subject: email.subject,
          body: email.body,
        })
        .returning({ id: emailReplies.id });
      if (!row) throw new Error("email reply insert returned nothing");
      reply = { id: row.id, to: c.address, ...email };
    }
    await recordEvent(tx, {
      actorType: "worker",
      actorId: c.workerId,
      action: "email.received",
      entityType: "inbound_email",
      entityId: payload.emailId,
      data: {
        handledAs,
        intent,
        ...(aiFallback ? { aiFallback } : {}),
        ...(held === "held" ? { replyHeld: true, sortedAs } : {}),
        ...(held === "limit" ? { replyLimit: true, sortedAs } : {}),
        ...(held === "no_address" ? { nothingOnFile: true, sortedAs } : {}),
        workerId: c.workerId,
      },
    });
    await queueInboxSummary(tx, came, c.firm.timezone);
    return { reply };
  });
  if (claimed === null) return { status: "already" };

  // Step 4: the link email, outside any transaction, then what came of it.
  const reply = claimed.reply;
  if (answer && reply) {
    // Their reply comes back to the firm's staffing inbox, so to Enquiries.
    const replyTo = c.firm.inbox ? { replyTo: c.firm.inbox } : {};
    try {
      await deps.transport.send({
        channel: "email",
        to: reply.to,
        ...replyTo,
        subject: reply.subject,
        body: reply.body,
      });
    } catch (err) {
      // It didn't go: the email waits for a person (its intent the office's, so Need a person
      // lists it), as an automatic answer held back would.
      const code = safeCode(errorCode(err));
      await run(payload.firmId, async (tx) => {
        await tx
          .update(inboundEmails)
          .set({ intent: "office" })
          .where(eq(inboundEmails.id, payload.emailId));
        await recordEvent(tx, {
          actorType: "system",
          action: "email.reply_failed",
          entityType: "inbound_email",
          entityId: payload.emailId,
          data: { replyId: reply.id, answer, code, workerId: c.workerId },
        });
      });
      return { status: "reply_failed", answer, replyId: reply.id, code };
    }
    await run(payload.firmId, (tx) =>
      recordEvent(tx, {
        actorType: "system",
        action: "email.replied",
        entityType: "inbound_email",
        entityId: payload.emailId,
        data: { replyId: reply.id, answer, workerId: c.workerId },
      }),
    );
    return { status: "replied", answer, replyId: reply.id };
  }

  // Step 5: for a person. The AI's draft for the office: never about pay or money (its words or
  // the draft's), and not when there's no address on file to answer by email. Saved only while it
  // still waits as the office's, and logged `email.drafted` (ids only).
  let drafted = false;
  if (sortedAs !== "pay" && held !== "no_address" && text && !aboutMoney(text)) {
    const draft = await draftEmailReply({ subject: c.subject, body: c.body }, deps.ai, {
      timeoutMs: deps.draftTimeoutMs,
    });
    if (draft && !aboutMoney(draft)) {
      drafted = await run(payload.firmId, async (tx) => {
        const saved = await tx
          .update(inboundEmails)
          .set({ draftReply: draft })
          .where(
            sql`${inboundEmails.id} = ${payload.emailId} and ${inboundEmails.intent} = 'office'
                and ${inboundEmails.draftReply} is null`,
          )
          .returning({ id: inboundEmails.id });
        if (saved.length === 0) return false;
        await recordEvent(tx, {
          actorType: "system",
          action: "email.drafted",
          entityType: "inbound_email",
          entityId: payload.emailId,
          data: { workerId: c.workerId },
        });
        return true;
      });
    }
  }
  return {
    status: "person",
    why: held ?? "office",
    sortedAs: held ? sortedAs : null,
    handledAs,
    drafted,
  };
}

// An error's code as the log and the office see it (as the shifts line's: a SQLSTATE or an error
// class's name, never anything longer or stranger).
const safeCode = (code: string) =>
  /^[0-9A-Z]{5}$/.test(code) || /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(code) ? code : "unknown";

// The last try: sorting failed on every try (a bug, or the database failing), so the email is
// passed to a person, once (the same claim as an answer), and the job still fails. Not covered: a
// worker killed in the middle of the last try, or the mark failing too.
export async function runInboundEmailWithLastTry(
  payload: InboundEmailPayload,
  run: WithFirm,
  deps: InboundEmailDeps,
  attempt: JobAttempt,
): Promise<InboundEmailResult> {
  try {
    return await runInboundEmail(payload, run, deps);
  } catch (err) {
    if (attempt.retryCount < (attempt.retryLimit ?? INBOUND_EMAIL_RETRY_LIMIT)) throw err;
    const code = safeCode(errorCode(err));
    try {
      const worker = await run(payload.firmId, async (tx) => {
        const { rows } = await tx.execute<{ worker_id: string | null; active: boolean | null }>(
          sql`select e.worker_id, w.status = 'active' as active
                from inbound_emails e
                left join workers w on w.firm_id = e.firm_id and w.id = e.worker_id
               where e.id = ${payload.emailId}`,
        );
        return rows[0] ?? null;
      });
      if (worker) {
        await claimPlain(run, payload, {
          handledAs: worker.worker_id ? "office" : "unknown",
          workerId: worker.worker_id,
          active: worker.active === true,
          data: worker.worker_id ? { answerFailed: code } : {},
        });
      }
      log.warn("inbound email: the last try failed", {
        firmId: payload.firmId,
        entityId: payload.emailId,
        code,
      });
    } catch (markErr) {
      log.error("inbound email: the last try failed, and so did passing it to a person", {
        firmId: payload.firmId,
        entityId: payload.emailId,
        code,
        markCode: errorCode(markErr),
      });
    }
    throw err;
  }
}

export function inboundEmailTask(deps: () => InboundEmailDeps): FirmTask<InboundEmailPayload> {
  return {
    ...inboundEmailJob,
    task: (payload, run, attempt) => runInboundEmailWithLastTry(payload, run, deps(), attempt),
  };
}

// The worker's wiring: the AI is Claude once AI_TRANSPORT=anthropic; until then every email no
// keyword matches goes to a person, with no draft.
export const inboundEmailFirmTask = inboundEmailTask(() => {
  const env = workerEnv();
  return { transport: getTransport(env), ai: getAi(env), baseDomain: env.APP_BASE_DOMAIN };
});

// --- The hourly sweep -----------------------------------------------------------------------------

// Emails stored but not handled after SWEEP_AFTER_MINUTES (their job lost, or stored before the job
// existed) are queued again, once an hour at most each, a firm's oldest first and at most
// SWEEP_LIMIT a run. One stored more than STALE_HOURS before goes to a person unsorted (step 1);
// one still unhandled at the firm's message retention age is purged as the rest are.
const SWEEP_AFTER_MINUTES = 10;
const SWEEP_LIMIT = 200;

export interface InboundEmailTickDeps {
  listFirmIds: () => Promise<string[]>;
  run: WithFirm;
  logger?: typeof log;
}

export async function runInboundEmailTick(deps: InboundEmailTickDeps): Promise<{ queued: number }> {
  const logger = deps.logger ?? log;
  let queued = 0;
  for (const firmId of await deps.listFirmIds()) {
    try {
      queued += await deps.run(firmId, async (tx) => {
        const { rows } = await tx.execute<{ id: string; worker_id: string | null }>(sql`
          select e.id::text as id, e.worker_id::text as worker_id from inbound_emails e
           where e.handled_at is null
             and e.created_at < now() - make_interval(mins => ${SWEEP_AFTER_MINUTES})
           order by e.created_at, e.id
           limit ${SWEEP_LIMIT}
        `);
        let n = 0;
        for (const r of rows) {
          const id = await sendFirmJob(
            tx,
            inboundEmailJob,
            { idempotencyKey: `inbound-email:${r.id}`, emailId: r.id },
            {
              group: { id: r.worker_id ? `w:${r.worker_id}` : `e:${r.id}` },
              singletonKey: `inbound-email:${r.id}`,
              singletonSeconds: 3_600,
            },
          );
          if (id !== null) n += 1;
        }
        return n;
      });
    } catch (err) {
      logger.error("inbound email tick failed for a firm", { firmId, error: err });
    }
  }
  return { queued };
}
