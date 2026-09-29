import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { assignments, events, firms, shifts, sites, workers } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { getTransport } from "../messaging";
import {
  changeWords,
  firmChangePush,
  shiftCancelledByFirmMessage,
  shiftChangedByFirmMessage,
} from "../messaging/templates";
import {
  pushToWorker,
  sendToWorker,
  type NotifyDeps,
  type WorkerChannel,
  smsAllowedFor,
} from "../notify/send";
import { getPushTransport } from "../push/transport";
import { dayLabel } from "../rules/reasons";
import { mayMessageNow, quietHours } from "../rules/quiet-hours";
import { insideUrgentWindow, urgentWindowHours } from "../rules/urgent";
import { portalUrl } from "../tenancy/portal-url";
import { signOffFor } from "../tenancy/sign-off";
import { localDateOf, wallTimeOf } from "../time/zoned";

// Telling a worker the office changed their booked shift (docs/api-and-jobs.md, "Firm-initiated
// changes", step 3): one firm-change-notice job per worker and change, queued in the transaction
// that logged the change (shift.cancelled by the firm, shift.moved, shift.curtailed). The payload
// is ids only: the change event's id and the booking.
//
// At most once, like shift reminders: (1) a short transaction claims the notice (the
// shift.change_notice event, under an advisory lock on the booking) and commits; (2) the message goes
// outside any transaction, by the worker's channel with the WhatsApp-to-text fallback; (3) a second
// short transaction pushes to their phones and logs shift.change_notice_sent or _failed. A job that
// stops part-way leaves the claim: the notice may have gone, so it's never sent again.
//
// Quiet hours: a change to a shift starting within the firm's urgent window (as it was, or as it is
// now: the earlier of the two), or already under way, is urgent (it must reach them before they travel), sent at night if
// the firm lets urgent through; otherwise it waits for the quiet hours to end. A held notice is
// logged (shift.change_notice_held, with whether it will arrive after the start) and queued again
// for when they end; never dropped.
//
// Out of date: a later change to the same booking supersedes this one, and only the latest is
// sent, describing the shift as the worker last knew it (from their last notice) and as it is now.
// A move notice for someone no longer booked, or for a shift moved back to what they knew, isn't
// sent. All are logged (shift.change_notice_skipped {reason}).

export const FIRM_CHANGE_NOTICE_QUEUE = "firm-change-notice";

export const firmChangeNoticePayload = firmJobEnvelope.extend({
  idempotencyKey: z.string().regex(/^firm-change:\d{1,18}(:after-quiet)?$/),
  eventId: z.number().int().positive(),
  assignmentId: z.uuid(),
});
export type FirmChangeNoticePayload = z.infer<typeof firmChangeNoticePayload>;

const job = { queue: FIRM_CHANGE_NOTICE_QUEUE, schema: firmChangeNoticePayload };
const CHANGE_ACTIONS = ["shift.cancelled", "shift.moved", "shift.curtailed"] as const;

// Queued by the change, in its transaction.
export async function queueFirmChangeNotice(
  tx: FirmTx,
  change: { eventId: number; assignmentId: string },
): Promise<void> {
  await sendFirmJob(tx, job, {
    idempotencyKey: `firm-change:${change.eventId}`,
    eventId: change.eventId,
    assignmentId: change.assignmentId,
  });
}

export interface NoticeDeps extends NotifyDeps {
  baseDomain: string;
  clock: Clock;
}

export type NoticeResult =
  | { status: "sent"; channel: WorkerChannel }
  | { status: "failed" }
  | { status: "held"; until: Date }
  | { status: "already" }
  | { status: "skipped"; reason: "superseded" | "not_booked" | "unchanged" } // out of date: logged
  | { status: "gone" }; // no such change for this booking

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};
const iso = z.iso.datetime();
const dateOf = (v: unknown): Date | null => (iso.safeParse(v).success ? new Date(String(v)) : null);

async function siteName(tx: FirmTx, id: unknown): Promise<string | null> {
  if (typeof id !== "string" || !z.uuid().safeParse(id).success) return null;
  const [site] = await tx.select({ name: sites.name }).from(sites).where(eq(sites.id, id));
  return site?.name ?? null;
}

type Claim =
  | {
      status: "send";
      workerId: string;
      mobile: string;
      channel: WorkerChannel;
      smsAllowed: boolean;
      body: string;
      from: string | null; // the firm's shifts line
      push: { title: string; body: string; url: string };
    }
  | Exclude<NoticeResult, { status: "sent" } | { status: "failed" }>;

async function claimNotice(
  tx: FirmTx,
  payload: FirmChangeNoticePayload,
  deps: NoticeDeps,
  now: Date,
): Promise<Claim> {
  await tx.execute(
    // One lock per booking: its notices are claimed one at a time, so each sees the last one
    // claimed (what the worker was told) and a newer change's claim.
    sql`select pg_advisory_xact_lock(hashtextextended('firm-change-notice:' || app_current_firm_id()::text || ':' || ${payload.assignmentId}, 0))`,
  );
  const { rows: done } = await tx.execute(sql`
    select 1 from events
     where entity_id = ${payload.assignmentId} and action = 'shift.change_notice'
       and (data ->> 'changeEventId')::bigint = ${payload.eventId}
     limit 1
  `);
  if (done.length > 0) return { status: "already" };
  const [change] = await tx
    .select({ action: events.action, data: events.data })
    .from(events)
    .where(and(eq(events.id, payload.eventId), eq(events.entityId, payload.assignmentId)));
  if (!change || !(CHANGE_ACTIONS as readonly string[]).includes(change.action)) {
    return { status: "gone" };
  }
  const [row] = await tx
    .select({
      bookingStatus: assignments.status,
      workerId: workers.id,
      mobile: workers.mobileE164,
      channel: workers.notifyChannel,
      smsOptedOutAt: workers.smsOptedOutAt,
      shiftId: shifts.id,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      siteId: shifts.siteId,
      firmName: firms.name,
      line: firms.shiftsLineE164,
      slug: firms.slug,
      timezone: firms.timezone,
      settings: firms.settings,
    })
    .from(assignments)
    .innerJoin(
      workers,
      and(eq(workers.firmId, assignments.firmId), eq(workers.id, assignments.workerId)),
    )
    .innerJoin(
      shifts,
      and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
    )
    .innerJoin(firms, eq(firms.id, assignments.firmId))
    .where(eq(assignments.id, payload.assignmentId));
  if (!row) return { status: "gone" };
  const tz = row.timezone;

  const skip = async (reason: "superseded" | "not_booked" | "unchanged") => {
    await recordEvent(tx, {
      actorType: "system",
      action: "shift.change_notice_skipped",
      entityType: "assignment",
      entityId: payload.assignmentId,
      data: { changeEventId: payload.eventId, workerId: row.workerId, reason },
    });
    return { status: "skipped" as const, reason };
  };
  const { rows: later } = await tx.execute(sql`
    select 1 from events
     where entity_id = ${payload.assignmentId} and id > ${payload.eventId}
       and action in ('shift.cancelled', 'shift.moved', 'shift.curtailed')
     limit 1
  `);
  if (later.length > 0) return skip("superseded");
  if (change.action !== "shift.cancelled" && row.bookingStatus !== "confirmed") {
    return skip("not_booked");
  }

  // What the worker was last told: the "as it was" of the earliest move on this booking since the
  // last notice they were sent (moves after it were skipped as superseded and never reached them).
  // With none, the shift as it stands (a cancellation doesn't change its times). So one message
  // takes them from what they know to what's true now.
  const { rows: unsent } = await tx.execute<{ data: Record<string, unknown> }>(sql`
    select e.data from events e
     where e.entity_id = ${payload.assignmentId} and e.id <= ${payload.eventId}
       and e.action in ('shift.moved', 'shift.curtailed')
       and e.id > coalesce((select max((c.data ->> 'changeEventId')::bigint) from events c
                             where c.entity_id = ${payload.assignmentId}
                               and c.action = 'shift.change_notice'), 0)
     order by e.id
     limit 1
  `);
  const first = unsent[0]?.data;
  const told = {
    start: (first && dateOf(first.oldStartsAt)) || row.startsAt,
    end: (first && dateOf(first.oldEndsAt)) || row.endsAt,
    // A Google Sheet's moves don't log the site (the sheet can't change it).
    siteId:
      first && "oldSiteId" in first ? ((first.oldSiteId as string | null) ?? null) : row.siteId,
  };
  const timesChanged =
    told.start.getTime() !== row.startsAt.getTime() || told.end.getTime() !== row.endsAt.getTime();
  const siteChanged = told.siteId !== row.siteId;
  // Moved and moved back before they were told: nothing to tell.
  if (change.action !== "shift.cancelled" && !timesChanged && !siteChanged)
    return skip("unchanged");

  // Quiet hours: urgent when the shift, as they knew it or as it is now, starts within the window
  // (the soonest start still ahead), or is already under way.
  const ahead = [told.start, row.startsAt].filter((t) => t.getTime() > now.getTime());
  const soonest = ahead.sort((a, b) => a.getTime() - b.getTime())[0] ?? row.startsAt;
  const urgent =
    ahead.length === 0 || insideUrgentWindow(soonest, now, urgentWindowHours(row.settings));
  const timing = mayMessageNow({ now, timeZone: tz, quiet: quietHours(row.settings), urgent });
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
    await recordEvent(tx, {
      actorType: "system",
      action: "shift.change_notice_held",
      entityType: "assignment",
      entityId: payload.assignmentId,
      data: {
        changeEventId: payload.eventId,
        workerId: row.workerId,
        until: timing.until.toISOString(),
        // It will reach them after the shift starts: the office should phone.
        afterStart: timing.until.getTime() >= soonest.getTime(),
      },
    });
    return { status: "held", until: timing.until };
  }

  const voice = { name: row.firmName, signOff: signOffFor(row.firmName, row.settings.sign_off) };
  const base = portalUrl(row.slug, deps.baseDomain);
  const date = dayLabel(localDateOf(told.start, tz));
  const toldSite = await siteName(tx, told.siteId);
  let body: string;
  let push: { title: string; body: string; url: string };
  if (change.action === "shift.cancelled") {
    const start = hhmm(told.start, tz);
    body = shiftCancelledByFirmMessage(voice, {
      date,
      site: toldSite,
      start,
      end: hhmm(told.end, tz),
      link: `${base}/shifts/open`,
    });
    push = { ...firmChangePush({ kind: "cancelled", date, start }), url: "/shifts/open" };
  } else {
    const curtailed =
      !siteChanged &&
      row.startsAt.getTime() >= told.start.getTime() &&
      row.endsAt.getTime() <= told.end.getTime();
    const change_ = changeWords({
      curtailed,
      timesChanged,
      siteChanged,
      newSite: siteChanged ? await siteName(tx, row.siteId) : null,
    });
    const otherDay = localDateOf(row.startsAt, tz) !== localDateOf(told.start, tz);
    body = shiftChangedByFirmMessage(voice, {
      date,
      site: toldSite,
      change: change_,
      start: `${otherDay ? `${dayLabel(localDateOf(row.startsAt, tz))} ` : ""}${hhmm(row.startsAt, tz)}`,
      end: hhmm(row.endsAt, tz),
      link: `${base}/shifts/${row.shiftId}`,
    });
    push = {
      ...firmChangePush({ kind: "changed", date, change: change_ }),
      url: `/shifts/${row.shiftId}`,
    };
  }

  await recordEvent(tx, {
    actorType: "system",
    action: "shift.change_notice",
    entityType: "assignment",
    entityId: payload.assignmentId,
    data: { changeEventId: payload.eventId, workerId: row.workerId, status: "sending" },
  });
  return {
    status: "send",
    workerId: row.workerId,
    mobile: row.mobile,
    channel: row.channel,
    smsAllowed: smsAllowedFor(row),
    body,
    from: row.line,
    push,
  };
}

export async function runFirmChangeNotice(
  payload: FirmChangeNoticePayload,
  run: WithFirm,
  deps: NoticeDeps,
): Promise<NoticeResult> {
  const now = deps.clock.now();
  const claim = await run(payload.firmId, (tx) => claimNotice(tx, payload, deps, now));
  if (claim.status !== "send") return claim;
  const sent = await sendToWorker(deps, {
    mobile: claim.mobile,
    channel: claim.channel,
    smsAllowed: claim.smsAllowed,
    body: { whatsapp: claim.body, sms: claim.body },
    from: claim.from,
  });
  await run(payload.firmId, async (tx) => {
    if (!sent.ok) {
      await recordEvent(tx, {
        actorType: "system",
        action: "shift.change_notice_failed",
        entityType: "assignment",
        entityId: payload.assignmentId,
        data: {
          changeEventId: payload.eventId,
          workerId: claim.workerId,
          channel: sent.channel,
          code: sent.code,
        },
      });
      return;
    }
    const pushes = await pushToWorker(tx, deps, claim.workerId, claim.push);
    await recordEvent(tx, {
      actorType: "system",
      action: "shift.change_notice_sent",
      entityType: "assignment",
      entityId: payload.assignmentId,
      data: {
        changeEventId: payload.eventId,
        workerId: claim.workerId,
        channel: sent.channel,
        providerMessageId: sent.providerMessageId,
        pushes,
        ...(sent.fellBackFrom ? { fellBackFrom: sent.fellBackFrom } : {}),
      },
    });
  });
  return sent.ok ? { status: "sent", channel: sent.channel } : { status: "failed" };
}

export function createFirmChangeNoticeTask(
  deps: () => NoticeDeps,
): FirmTask<FirmChangeNoticePayload> {
  return {
    queue: FIRM_CHANGE_NOTICE_QUEUE,
    schema: firmChangeNoticePayload,
    task: (payload, run) => runFirmChangeNotice(payload, run, deps()),
  };
}

const workerDeps = (): NoticeDeps => {
  const env = workerEnv();
  return {
    transport: getTransport(env),
    push: getPushTransport(env),
    baseDomain: env.APP_BASE_DOMAIN,
    clock: systemClock,
  };
};
export const firmChangeNoticeTask = createFirmChangeNoticeTask(workerDeps);
