import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { MINUTE } from "../auth/clock";
import { hitLimit, type Limit } from "../auth/throttle";
import { firms } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { getTransport, type MessagingTransport } from "../messaging";
import { inboxSummaryEmail } from "../messaging/templates";
import { needsPerson } from "../office/enquiry-sql";
import { officeAlertRecipients } from "../inbound/alerts-combined";
import { portalUrl } from "../tenancy/portal-url";
import { signOffFor } from "../tenancy/sign-off";
import { nextDay, wallTimeOf, zonedToUtc } from "../time/zoned";

// The staffing inbox's summary for the office (P7.5's "a summary every 3 hours"; Phase 25.5;
// docs/messaging-templates.md `inbox_summary`). The firm's day is cut into 3-hour slots in its own
// time zone (00:00, 03:00 … 21:00). Each email's handling (src/lib/email/sort.ts) queues this job
// for a minute after its slot ends (once a slot: a pg-boss singleton key), so a slot with no email
// sends nothing. The job, at most once per firm and slot (claim → send → record, like the combined
// alert, src/lib/inbound/alerts-combined.ts):
//   1. a short transaction claims the slot (an auth_throttle row keyed by its start) and counts its
//      emails by what came of them; none, or already claimed: nothing more;
//   2. the email goes to each active admin and resourcer, no transaction open;
//   3. a short transaction logs `message.inbox_summary {slotStart, from, to, received, recipients,
//      failed, skipped}` (counts, never an address, a name or anyone's words).

export const INBOX_SUMMARY_QUEUE = "inbox-summary";
export const SLOT_HOURS = 3;
const GRACE_MS = MINUTE; // a minute after the slot ends, so a claim made in its last moments counts

export const inboxSummaryPayload = firmJobEnvelope.extend({
  idempotencyKey: z.string().regex(/^inbox-summary:\d+$/),
  slotStart: z.iso.datetime(),
  slotEnd: z.iso.datetime(),
});
export type InboxSummaryPayload = z.infer<typeof inboxSummaryPayload>;
export const inboxSummaryJob = { queue: INBOX_SUMMARY_QUEUE, schema: inboxSummaryPayload };

// The slot an instant falls in, in the firm's time zone: its start and end as instants. A slot
// across a clock change is 2 or 4 hours long, never shifted.
export function summarySlotOf(now: Date, timeZone: string): { start: Date; end: Date } {
  const wall = wallTimeOf(now, timeZone);
  const hour = Math.floor(wall.hour / SLOT_HOURS) * SLOT_HOURS;
  const start = zonedToUtc({ ...wall, hour, minute: 0 }, timeZone);
  const end = zonedToUtc(
    hour + SLOT_HOURS >= 24
      ? { ...nextDay(wall), hour: 0, minute: 0 }
      : { ...wall, hour: hour + SLOT_HOURS, minute: 0 },
    timeZone,
  );
  return { start, end };
}

// Queues the slot's summary (once a slot), from inside an email's claim.
export async function queueInboxSummary(tx: FirmTx, now: Date, timeZone: string): Promise<void> {
  const slot = summarySlotOf(now, timeZone);
  const key = `inbox-summary:${slot.start.getTime()}`;
  await sendFirmJob(
    tx,
    inboxSummaryJob,
    { idempotencyKey: key, slotStart: slot.start.toISOString(), slotEnd: slot.end.toISOString() },
    {
      startAfter: new Date(slot.end.getTime() + GRACE_MS),
      singletonKey: key,
      singletonSeconds: SLOT_HOURS * 3_600,
    },
  );
}

// One claim per slot: a row keyed by the slot's start (slots start on the hour, so the minute's
// window is the slot's own).
const SUMMARY_CLAIM: Limit = { name: "inbox:summary", max: 1, windowMs: MINUTE };

export interface InboxSummaryDeps {
  transport: MessagingTransport;
  baseDomain: string;
}

export interface SummaryCounts {
  emails: number;
  linked: number;
  waiting: number;
  office: number;
  pay: number;
  notCasuals: number;
}

export type InboxSummaryResult =
  | { status: "already" }
  | { status: "none" }
  | { status: "sent"; counts: SummaryCounts; emailed: number; failed: number }
  | { status: "no_recipients"; counts: SummaryCounts };

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (at: Date, timeZone: string) => {
  const w = wallTimeOf(at, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};

// The slot's emails by what came of them now. Pay questions are counted as pay only, whatever came
// of them (an email held for a person was sorted as pay when its `email.received` says so); one not
// from a casual as that only; the rest as answered with a link, waiting for a person, or already
// answered by the office (handled, neither of those). One not handled yet is in none of them.
export async function slotCounts(tx: FirmTx, start: Date, end: Date): Promise<SummaryCounts> {
  const { rows } = await tx.execute<{
    emails: number;
    not_casuals: number;
    pay: number;
    linked: number;
    waiting: number;
    office: number;
  }>(sql`
    with slot as (
      select e.id, e.firm_id, e.handled_at, e.handled_as, e.intent, 'email'::text as channel,
             (e.intent = 'pay' or exists (
                select 1 from events r
                 where r.firm_id = e.firm_id and r.entity_id = e.id
                   and r.action = 'email.received' and r.data ->> 'sortedAs' = 'pay')) as pay,
             exists (select 1 from events x
                      where x.firm_id = e.firm_id and x.entity_id = e.id
                        and x.action = 'email.replied') as linked
        from inbound_emails e
       where e.created_at >= ${start} and e.created_at < ${end}
    )
    select count(*)::int as emails,
           count(*) filter (where s.handled_as = 'unknown')::int as not_casuals,
           count(*) filter (where s.handled_as is distinct from 'unknown' and s.pay)::int as pay,
           count(*) filter (where s.handled_as is distinct from 'unknown' and not s.pay
                              and s.linked)::int as linked,
           count(*) filter (where s.handled_as is distinct from 'unknown' and not s.pay
                              and not s.linked and ${needsPerson("s")})::int as waiting,
           count(*) filter (where s.handled_at is not null and s.handled_as <> 'unknown'
                              and not s.pay and not s.linked and not ${needsPerson("s")})::int
             as office
      from slot s
  `);
  const r = rows[0];
  return {
    emails: r?.emails ?? 0,
    linked: r?.linked ?? 0,
    waiting: r?.waiting ?? 0,
    office: r?.office ?? 0,
    pay: r?.pay ?? 0,
    notCasuals: r?.not_casuals ?? 0,
  };
}

export async function runInboxSummary(
  payload: InboxSummaryPayload,
  run: WithFirm,
  deps: InboxSummaryDeps,
): Promise<InboxSummaryResult> {
  const start = new Date(payload.slotStart);
  const end = new Date(payload.slotEnd);
  const claim = await run(payload.firmId, async (tx) => {
    const hit = await hitLimit(tx, {
      limit: SUMMARY_CLAIM,
      value: "firm",
      now: start,
      secret: "inbox-summary",
    });
    if (!hit.allowed) return { status: "already" as const };
    const counts = await slotCounts(tx, start, end);
    if (counts.emails === 0) return { status: "none" as const };
    const [firm] = await tx
      .select({
        name: firms.name,
        slug: firms.slug,
        timezone: firms.timezone,
        settings: firms.settings,
      })
      .from(firms)
      .where(eq(firms.id, sql`app_current_firm_id()`));
    if (!firm) throw new Error("firm not visible inside its own transaction");
    const slot = {
      slotStart: payload.slotStart,
      from: clock(start, firm.timezone),
      to: clock(end, firm.timezone),
    };
    const { recipients, skipped } = await officeAlertRecipients(tx);
    if (recipients.length === 0) {
      await recordEvent(tx, {
        actorType: "system",
        action: "message.inbox_summary",
        entityType: "firm",
        entityId: payload.firmId,
        data: { ...slot, received: counts.emails, recipients: 0, failed: 0, skipped },
      });
      return { status: "no_recipients" as const, counts };
    }
    const voice = { name: firm.name, signOff: signOffFor(firm.name, firm.settings.sign_off) };
    return {
      status: "send" as const,
      slot,
      counts,
      recipients,
      skipped,
      email: inboxSummaryEmail(voice, `${portalUrl(firm.slug, deps.baseDomain)}/office/enquiries`, {
        from: slot.from,
        to: slot.to,
        ...counts,
      }),
    };
  });
  if (claim.status !== "send") return claim;

  let emailed = 0;
  let failed = 0;
  for (const to of claim.recipients) {
    try {
      await deps.transport.send({ channel: "email", to, ...claim.email });
      emailed += 1;
    } catch {
      failed += 1;
    }
  }
  await run(payload.firmId, (tx) =>
    recordEvent(tx, {
      actorType: "system",
      action: "message.inbox_summary",
      entityType: "firm",
      entityId: payload.firmId,
      data: {
        ...claim.slot,
        received: claim.counts.emails,
        recipients: emailed,
        failed,
        skipped: claim.skipped,
      },
    }),
  );
  return { status: "sent", counts: claim.counts, emailed, failed };
}

export function createInboxSummaryTask(
  deps: () => InboxSummaryDeps,
): FirmTask<InboxSummaryPayload> {
  return { ...inboxSummaryJob, task: (payload, run) => runInboxSummary(payload, run, deps()) };
}

export const inboxSummaryTask = createInboxSummaryTask(() => {
  const env = workerEnv();
  return { transport: getTransport(env), baseDomain: env.APP_BASE_DOMAIN };
});
