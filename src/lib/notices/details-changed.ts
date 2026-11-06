import { and, asc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { events, firms, shifts, sites } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { getTransport } from "../messaging";
import {
  detailsChangedEmailSubject,
  detailsChangedMessage,
  detailsChangedPush,
  detailsChangedSms,
} from "../messaging/templates";
import { reachOf } from "../offers/reach";
import { eachAtMost } from "../notify/parallel";
import {
  deliverToWorker,
  recordPushes,
  smsAllowedFor,
  type DeliveryChannel,
  type NotifyDeps,
  type WorkerChannel,
} from "../notify/send";
import { getPushTransport } from "../push/transport";
import { dayLabel } from "../rules/reasons";
import { mayMessageNow, quietHours } from "../rules/quiet-hours";
import { insideUrgentWindow, urgentWindowHours } from "../rules/urgent";
import { portalUrl } from "../tenancy/portal-url";
import { signOffFor } from "../tenancy/sign-off";
import { localDateOf, wallTimeOf } from "../time/zoned";
import {
  BRIEFING_FIELDS,
  briefingFieldsOf,
  briefingWords,
  type BriefingField,
} from "./briefing-fields";
import { FIRM_SYSTEM_BOOKINGS, firmSystemSends } from "./who-sends";

// Telling booked casuals that their shift's briefing changed (Phase 28.3; docs/api-and-jobs.md
// `details-notice`; words `shift_details_changed` in docs/messaging-templates.md). Before, only a
// move or a cancellation reached them (src/lib/notices/firm-change.ts), so a casual could turn up
// with an old meeting point.
//
// Each of the four writers of a session's briefing calls queueDetailsNotice() in its transaction,
// after logging `shift.changed` {fields}: the office's editor (src/lib/office/shift-editor.ts), the
// firm's planner (src/lib/integrations/sessions.ts), the rota sheet's sync
// (src/lib/roster/sheets/sync.ts) and a file import (src/lib/imports/import.ts). Only the briefing's
// fields count (briefing-fields.ts): a change to the places, the event's name, the times, the site
// or the sheet's override codes queues nothing (a move has its own notice).
//
// One message per booking for a burst of saves: the job starts DETAILS_NOTICE_DELAY_SECONDS after
// the first, with a per-session singleton key, and reads every change it finds then. The payload is
// ids only: the session and the `shift.changed` entry that queued it.
//
// At most once, like the other notices: (1) one short transaction, under an advisory lock on the
// session, works out for each booking the changes it hasn't been told of (after its last
// `shift.details_notice` or `_skipped`, and made since it was booked), decides in code who is told
// (detailsNoticeDecision, pure: never an AI), logs each skip and claims each message
// (`shift.details_notice` {status: sending}), and commits; (2) each message goes with no transaction
// open (deliverToWorker: a push, else their chosen text or email); (3) a short transaction logs
// `shift.details_notice_sent` or `_failed`. A job that stops part-way leaves its claims: those may
// have gone, so they're never sent again.
//
// Quiet hours hold it unless the session starts within the firm's urgent window: held, logged
// (`shift.details_notice_held` for each booking to tell) and queued again for when they end.
//
// No value is ever in a message or the log: the casual's words for the parts that changed
// ("meeting point and uniform"), and the field codes.

export const DETAILS_NOTICE_QUEUE = "details-notice";
// How long after the first save the job starts: a burst of saves is one message.
export const DETAILS_NOTICE_DELAY_SECONDS = 120;
// The singleton's slot (pg-boss's `singletonSeconds`), shorter than the delay: a save that joins a
// job already queued is at least a minute ahead of it, so its transaction has long committed when
// the job reads the changes. A save in the next slot queues a job of its own, which finds nothing
// left to tell when the first has told it.
export const DETAILS_NOTICE_SLOT_SECONDS = 60;
const SENDS_AT_ONCE = 5;

export const detailsNoticePayload = firmJobEnvelope.extend({
  idempotencyKey: z.string().regex(/^details-notice:\d{1,18}(:after-quiet)?$/),
  shiftId: z.uuid(),
  changeEventId: z.number().int().positive(),
});
export type DetailsNoticePayload = z.infer<typeof detailsNoticePayload>;

const job = { queue: DETAILS_NOTICE_QUEUE, schema: detailsNoticePayload };

// Called by each writer of `shift.changed`, in its transaction, right after it logged it (the
// session's row is locked by the writer: its changes are one at a time). Queues the notice only when
// `fields` names a briefing field; true when it did.
export async function queueDetailsNotice(
  tx: FirmTx,
  shiftId: string,
  fields: readonly string[],
): Promise<boolean> {
  if (briefingFieldsOf(fields).length === 0) return false;
  // The entry just written: the newest `shift.changed` for this session.
  const { rows } = await tx.execute<{ id: string | null }>(sql`
    select max(id)::text as id from events
     where entity_type = 'shift' and entity_id = ${shiftId} and action = 'shift.changed'
  `);
  const changeEventId = Number(rows[0]?.id ?? 0);
  if (!Number.isSafeInteger(changeEventId) || changeEventId <= 0) {
    throw new Error("queueDetailsNotice must follow the shift.changed entry it tells about");
  }
  await sendFirmJob(
    tx,
    job,
    { idempotencyKey: `details-notice:${changeEventId}`, shiftId, changeEventId },
    {
      startAfter: DETAILS_NOTICE_DELAY_SECONDS,
      singletonKey: `details-notice:${shiftId}`,
      singletonSeconds: DETAILS_NOTICE_SLOT_SECONDS,
    },
  );
  return true;
}

// --- Who is told: code decides (golden rule 1) ------------------------------------------------

export const DETAILS_SKIP_REASONS = ["started", "firm_sends", "move_notice", "no_way"] as const;
export type DetailsSkipReason = (typeof DETAILS_SKIP_REASONS)[number];

export interface UntoldChange {
  fields: readonly BriefingField[];
  // Logged in the same transaction as a move or shortening of this booking that sends its own
  // notice: the office's or the planner's (src/lib/roster/firm-change.ts queues firm-change-notice).
  // A rota sheet's move sends none (its entries say `source: sheets`), so it doesn't count.
  withMoveNotice: boolean;
  // Made by the firm's own system: the rota sheet's sync, or the planner through the API.
  firmSystem: boolean;
}

export type DetailsDecision =
  | { action: "none" }
  | { action: "skip"; reason: DetailsSkipReason }
  | { action: "send"; fields: BriefingField[] };

// For one confirmed booking (a cancelled one isn't booked any more: nothing to tell, nothing
// logged; the office's cancellation sends its own notice).
export function detailsNoticeDecision(b: {
  untold: readonly UntoldChange[]; // briefing changes they haven't been told of, oldest first
  started: boolean; // the session has started
  firmSystemSends: boolean; // the firm's `firm_system_sends` (who-sends.ts)
  bookedByFirmSystem: boolean; // assignments.booked_via sheet or api
  reach: "push" | "sms" | "email" | "none"; // reachOf() (src/lib/offers/reach.ts)
}): DetailsDecision {
  if (b.untold.length === 0) return { action: "none" };
  // The parts the move's own notice didn't cover (it says what moved, and links to the shift).
  const rest = b.untold.filter((c) => !c.withMoveNotice);
  const named = new Set(rest.flatMap((c) => c.fields));
  const fields = BRIEFING_FIELDS.filter((f) => named.has(f));
  if (fields.length === 0) return { action: "skip", reason: "move_notice" };
  if (b.started) return { action: "skip", reason: "started" };
  if (b.firmSystemSends && b.bookedByFirmSystem && rest.every((c) => c.firmSystem)) {
    return { action: "skip", reason: "firm_sends" };
  }
  if (b.reach === "none") return { action: "skip", reason: "no_way" };
  return { action: "send", fields };
}

// A `shift.changed` entry made by the firm's own system: the rota sheet's (`source: sheets`) or the
// planner's through its key or a connector (`via: api`). The office's editor and a file import are
// the office's own.
const byFirmSystem = (data: Record<string, unknown>) =>
  data.source === "sheets" || data.via === "api";

// --- The office's confirmation ----------------------------------------------------------------

// How many casuals booked on the session a briefing change the office just saved will reach, for
// the editor's "Saved. 3 booked casuals will be told." (the session hasn't started: the editor
// refuses one that has). The same reach as the job's (reachOf). An office change is never the firm
// system's own, so `firm_sends` doesn't apply; nor does a move notice (the editor can't move a
// booked session).
export async function casualsToTell(
  tx: FirmTx,
  shiftId: string,
  textSender: boolean,
): Promise<number> {
  const rows = await bookingFacts(tx, shiftId);
  return rows.filter((b) => reachOf(reachInput(b), textSender).how !== "none").length;
}

interface BookingFacts {
  id: string;
  confirmedAt: Date | null;
  bookedVia: string | null;
  workerId: string;
  mobile: string | null;
  channel: WorkerChannel;
  smsOptedOutAt: Date | null;
  email: string | null;
  phones: number;
  toldThrough: number; // the newest change its last notice or skip covered (0: none)
}

const reachInput = (b: BookingFacts) => ({
  phones: b.phones,
  channel: b.channel,
  // No number (erased): no text can go.
  smsAllowed: b.mobile !== null && smsAllowedFor(b),
  hasEmail: b.email !== null,
});

// The session's confirmed bookings, with how each casual can be reached and what they were last
// told of.
async function bookingFacts(tx: FirmTx, shiftId: string): Promise<BookingFacts[]> {
  const { rows } = await tx.execute<{
    id: string;
    confirmed_at: string | Date | null;
    booked_via: string | null;
    worker_id: string;
    mobile: string | null;
    channel: WorkerChannel;
    sms_opted_out_at: string | Date | null;
    email: string | null;
    phones: number;
    told_through: string;
  }>(sql`
    select a.id::text as id, a.confirmed_at, a.booked_via,
           w.id::text as worker_id, w.mobile_e164 as mobile, w.notify_channel as channel,
           w.sms_opted_out_at, w.email,
           (select count(*)::int from push_subscriptions p
             where p.firm_id = w.firm_id and p.worker_id = w.id) as phones,
           coalesce((select max((e.data ->> 'changeEventId')::bigint) from events e
                      where e.entity_id = a.id
                        and e.action in ('shift.details_notice', 'shift.details_notice_skipped')),
                    0)::text as told_through
      from assignments a
      join workers w on w.firm_id = a.firm_id and w.id = a.worker_id
     where a.shift_id = ${shiftId} and a.worker_id is not null and a.status = 'confirmed'
     order by a.slot, a.id
  `);
  const date = (v: string | Date | null) => (v === null ? null : new Date(v));
  return rows.map((r) => ({
    id: r.id,
    confirmedAt: date(r.confirmed_at),
    bookedVia: r.booked_via,
    workerId: r.worker_id,
    mobile: r.mobile,
    channel: r.channel,
    smsOptedOutAt: date(r.sms_opted_out_at),
    email: r.email,
    phones: Number(r.phones),
    toldThrough: Number(r.told_through),
  }));
}

// --- The job ----------------------------------------------------------------------------------

export interface DetailsNoticeDeps extends NotifyDeps {
  baseDomain: string;
  clock: Clock;
  textSender: boolean; // whether texts can go at all (MESSAGING_TRANSPORT isn't "none")
}

export type DetailsNoticeResult =
  | { status: "done"; sent: number; failed: number; skipped: number }
  | { status: "held"; until: Date; skipped: number }
  | { status: "nothing" } // no briefing change left to tell anyone
  | { status: "gone" }; // no such session

interface Send {
  assignmentId: string;
  workerId: string;
  fields: BriefingField[];
  changeEventId: number;
  mobile: string;
  channel: WorkerChannel;
  smsAllowed: boolean;
  email: string | null;
}

type Claim = { status: "send"; sends: Send[]; skipped: number; words: Words } | DetailsNoticeResult;

interface Words {
  voice: { name: string; signOff: string };
  date: string;
  start: string;
  site: string | null;
  path: string;
  link: string;
  from: string | null; // the firm's shifts line
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};

async function claimNotices(
  tx: FirmTx,
  payload: DetailsNoticePayload,
  deps: DetailsNoticeDeps,
  now: Date,
): Promise<Claim> {
  await tx.execute(
    // One lock per session: its notices are worked out one job at a time, each seeing the last
    // one's claims and skips.
    sql`select pg_advisory_xact_lock(hashtextextended('details-notice:' || app_current_firm_id()::text || ':' || ${payload.shiftId}, 0))`,
  );
  const [shift] = await tx
    .select({
      startsAt: shifts.startsAt,
      site: sites.name,
      firmName: firms.name,
      line: firms.shiftsLineE164,
      slug: firms.slug,
      timezone: firms.timezone,
      settings: firms.settings,
    })
    .from(shifts)
    .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
    .innerJoin(firms, eq(firms.id, shifts.firmId))
    .where(eq(shifts.id, payload.shiftId));
  if (!shift) return { status: "gone" };
  const bookings = await bookingFacts(tx, payload.shiftId);
  if (bookings.length === 0) return { status: "nothing" };

  // The session's briefing changes after the oldest one a booking's notice or skip covered, oldest
  // first; not only from the one that queued this job (payload.changeEventId: its trigger and key).
  // Jobs can run out of order (two held by quiet hours wake together; a claim that failed is retried
  // after a later job's), and a notice's changeEventId says every change up to it was told: a later
  // job reading only its own changes would set that past an earlier change it never named.
  const floor = Math.min(...bookings.map((b) => b.toldThrough));
  const changes = (
    await tx
      .select({ id: events.id, at: events.createdAt, data: events.data })
      .from(events)
      .where(
        and(
          eq(events.entityType, "shift"),
          eq(events.entityId, payload.shiftId),
          eq(events.action, "shift.changed"),
          gt(events.id, floor),
        ),
      )
      .orderBy(asc(events.id))
  )
    .map((c) => ({ ...c, fields: briefingFieldsOf(c.data.fields) }))
    .filter((c) => c.fields.length > 0);
  if (changes.length === 0) return { status: "nothing" };

  // Which of them came in the same transaction as a move or shortening of a booking on this session
  // that sent its own notice (the same moment: Postgres's now() is the transaction's start): the
  // office's or the planner's (src/lib/roster/firm-change.ts), never the rota sheet's, which sends
  // none (its entries say `source: sheets`).
  const { rows: moves } = await tx.execute<{ assignment_id: string; change_id: string }>(sql`
    select distinct m.entity_id::text as assignment_id, c.id::text as change_id
      from events c
      join events m on m.firm_id = c.firm_id and m.created_at = c.created_at
     where c.entity_type = 'shift' and c.entity_id = ${payload.shiftId}
       and c.action = 'shift.changed' and c.id > ${floor}
       and m.entity_type = 'assignment'
       and m.action in ('shift.moved', 'shift.curtailed')
       and (m.data ->> 'source') is distinct from 'sheets'
       and m.entity_id in (select a.id from assignments a where a.shift_id = ${payload.shiftId})
  `);
  const withMove = new Set(moves.map((m) => `${m.assignment_id}|${m.change_id}`));

  const started = shift.startsAt.getTime() <= now.getTime();
  const firmSends = firmSystemSends(shift.settings);
  const sends: Send[] = [];
  let skipped = 0;
  for (const b of bookings) {
    const untold = changes.filter(
      (c) =>
        c.id > b.toldThrough &&
        (b.confirmedAt === null || c.at.getTime() >= b.confirmedAt.getTime()),
    );
    const decision = detailsNoticeDecision({
      untold: untold.map((c) => ({
        fields: c.fields,
        withMoveNotice: withMove.has(`${b.id}|${c.id}`),
        firmSystem: byFirmSystem(c.data),
      })),
      started,
      firmSystemSends: firmSends,
      bookedByFirmSystem: (FIRM_SYSTEM_BOOKINGS as readonly string[]).includes(b.bookedVia ?? ""),
      reach: reachOf(reachInput(b), deps.textSender).how,
    });
    const changeEventId = Math.max(0, ...untold.map((c) => c.id));
    if (decision.action === "skip") {
      await recordEvent(tx, {
        actorType: "system",
        action: "shift.details_notice_skipped",
        entityType: "assignment",
        entityId: b.id,
        data: {
          shiftId: payload.shiftId,
          workerId: b.workerId,
          assignmentId: b.id,
          reason: decision.reason,
          changeEventId,
        },
      });
      skipped += 1;
    } else if (decision.action === "send") {
      sends.push({
        assignmentId: b.id,
        workerId: b.workerId,
        fields: decision.fields,
        changeEventId,
        mobile: b.mobile ?? "",
        channel: b.channel,
        smsAllowed: reachInput(b).smsAllowed,
        email: b.email,
      });
    }
  }
  if (sends.length === 0) {
    return skipped > 0 ? { status: "done", sent: 0, failed: 0, skipped } : { status: "nothing" };
  }

  // Quiet hours: urgent when the session starts within the firm's urgent window.
  const tz = shift.timezone;
  const urgent = insideUrgentWindow(shift.startsAt, now, urgentWindowHours(shift.settings));
  const timing = mayMessageNow({ now, timeZone: tz, quiet: quietHours(shift.settings), urgent });
  if (!timing.ok && timing.until.getTime() - now.getTime() > 60_000) {
    await sendFirmJob(
      tx,
      job,
      {
        ...payload,
        idempotencyKey: payload.idempotencyKey.endsWith(":after-quiet")
          ? payload.idempotencyKey
          : `${payload.idempotencyKey}:after-quiet`,
      },
      { startAfter: timing.until },
    );
    for (const s of sends) {
      await recordEvent(tx, {
        actorType: "system",
        action: "shift.details_notice_held",
        entityType: "assignment",
        entityId: s.assignmentId,
        data: {
          shiftId: payload.shiftId,
          workerId: s.workerId,
          assignmentId: s.assignmentId,
          until: timing.until.toISOString(),
          // It will reach them after the session starts: the office should phone.
          afterStart: timing.until.getTime() >= shift.startsAt.getTime(),
        },
      });
    }
    return { status: "held", until: timing.until, skipped };
  }

  for (const s of sends) {
    await recordEvent(tx, {
      actorType: "system",
      action: "shift.details_notice",
      entityType: "assignment",
      entityId: s.assignmentId,
      data: {
        shiftId: payload.shiftId,
        workerId: s.workerId,
        assignmentId: s.assignmentId,
        fields: s.fields,
        changeEventId: s.changeEventId,
        status: "sending",
      },
    });
  }
  const path = `/shifts/${payload.shiftId}`;
  return {
    status: "send",
    sends,
    skipped,
    words: {
      voice: { name: shift.firmName, signOff: signOffFor(shift.firmName, shift.settings.sign_off) },
      date: dayLabel(localDateOf(shift.startsAt, tz)),
      start: hhmm(shift.startsAt, tz),
      site: shift.site,
      path,
      link: `${portalUrl(shift.slug, deps.baseDomain)}${path}`,
      from: shift.line,
    },
  };
}

export async function runDetailsNotice(
  payload: DetailsNoticePayload,
  run: WithFirm,
  deps: DetailsNoticeDeps,
): Promise<DetailsNoticeResult> {
  const now = deps.clock.now();
  const claim = await run(payload.firmId, (tx) => claimNotices(tx, payload, deps, now));
  if (claim.status !== "send") return claim;
  const { words } = claim;
  const inFirm: <T>(fn: (tx: FirmTx) => Promise<T>) => Promise<T> = (fn) => run(payload.firmId, fn);
  const tally = { sent: 0, failed: 0 };
  await eachAtMost(claim.sends, SENDS_AT_ONCE, async (s) => {
    const changes = briefingWords(s.fields);
    const shift = { site: words.site, date: words.date, start: words.start, changes };
    const body = detailsChangedMessage(words.voice, { ...shift, link: words.link });
    const sent = await deliverToWorker((fn) => run(payload.firmId, fn), deps, {
      workerId: s.workerId,
      push: {
        ...detailsChangedPush({ site: words.site, date: words.date, start: words.start }),
        url: words.path,
      },
      text: {
        mobile: s.mobile,
        channel: s.channel,
        smsAllowed: s.smsAllowed,
        body: {
          whatsapp: body,
          sms: detailsChangedSms(words.voice, { ...shift, link: words.link }),
        },
        from: words.from,
      },
      email: s.email
        ? { to: s.email, subject: detailsChangedEmailSubject({ date: words.date }), body }
        : null,
    });
    await recordOutcome(inFirm, payload.shiftId, s, sent);
    if (sent.ok) tally.sent += 1;
    else tally.failed += 1;
  });
  return { status: "done", ...tally, skipped: claim.skipped };
}

async function recordOutcome(
  inFirm: <T>(fn: (tx: FirmTx) => Promise<T>) => Promise<T>,
  shiftId: string,
  s: Send,
  sent: Awaited<ReturnType<typeof deliverToWorker>>,
): Promise<void> {
  await inFirm(async (tx) => {
    // A phone the push service says is gone is forgotten whatever came of the message.
    const pushes = await recordPushes(tx, sent.push);
    const ids = { shiftId, workerId: s.workerId, assignmentId: s.assignmentId };
    if (!sent.ok) {
      await recordEvent(tx, {
        actorType: "system",
        action: "shift.details_notice_failed",
        entityType: "assignment",
        entityId: s.assignmentId,
        data: { ...ids, channel: sent.channel, code: sent.code },
      });
      return;
    }
    const channel: DeliveryChannel = sent.channel;
    await recordEvent(tx, {
      actorType: "system",
      action: "shift.details_notice_sent",
      entityType: "assignment",
      entityId: s.assignmentId,
      data: {
        ...ids,
        channel,
        providerMessageId: sent.providerMessageId,
        pushes,
        ...(sent.fellBackFrom ? { fellBackFrom: sent.fellBackFrom } : {}),
      },
    });
  });
}

export function createDetailsNoticeTask(
  deps: () => DetailsNoticeDeps,
): FirmTask<DetailsNoticePayload> {
  return {
    queue: DETAILS_NOTICE_QUEUE,
    schema: detailsNoticePayload,
    task: (payload, run) => runDetailsNotice(payload, run, deps()),
  };
}

const workerDeps = (): DetailsNoticeDeps => {
  const env = workerEnv();
  return {
    transport: getTransport(env),
    push: getPushTransport(env),
    baseDomain: env.APP_BASE_DOMAIN,
    clock: systemClock,
    textSender: env.MESSAGING_TRANSPORT !== "none",
  };
};
export const detailsNoticeTask = createDetailsNoticeTask(workerDeps);
