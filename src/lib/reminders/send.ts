import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { firms, shiftReminders } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { log, type Logger } from "../log";
import { getTransport } from "../messaging";
import {
  reminderPush,
  shiftReminder24hMessage,
  shiftReminder2hMessage,
} from "../messaging/templates";
import { pushToWorker, sendToWorker, type NotifyDeps, type WorkerChannel } from "../notify/send";
import { dayWords } from "../portal/format";
import { getPushTransport } from "../push/transport";
import { quietHours } from "../rules/quiet-hours";
import {
  REMINDER_LOOKAHEAD_MS,
  REMINDER_TICK_MINUTES,
  reminderDecision,
  type ReminderDecision,
  type ReminderKind,
} from "../rules/reminders";
import { portalUrl } from "../tenancy/portal-url";
import { signOffFor } from "../tenancy/sign-off";
import { wallTimeOf } from "../time/zoned";

// Shift reminders (docs/api-and-jobs.md, `shift-reminders`; copy in docs/messaging-templates.md;
// ADR-017): 24 hours and 2 hours before the start, to every worker with a confirmed booking on an
// open or filled shift. The rules for when (and quiet hours) are src/lib/rules/reminders.ts.
//
// - shift-reminder-tick: a cron every 5 minutes. For each firm with a reminder due, it queues one
//   shift-reminders job (a firm-scoped singleton per slot).
// - shift-reminders (a firm task: several short transactions, never one held across a send). Per
//   due reminder: (1) claim it: its shift_reminders row, `sending`, if the booking is still there
//   (unique per booking, reminder and start time), committed before anything is sent; (2) send it by
//   the worker's channel (src/lib/notify/send.ts), outside any transaction; (3) record `sent` with
//   the push, or `failed`, and the event. A job that stops after a send (a crash, a failed record)
//   leaves the row `sending`: it may have gone, so it's never sent again. A retried or doubled job
//   finds the row and sends nothing. A failed send is never retried either (it may have arrived).
//   One quiet hours would hold past its window is recorded `skipped`. Logged shift.reminder_sent /
//   shift.reminder_failed / shift.reminder_skipped.

export const SHIFT_REMINDERS_QUEUE = "shift-reminders";
export const SHIFT_REMINDER_TICK_QUEUE = "shift-reminder-tick";
export const SHIFT_REMINDER_TICK_CRON = `*/${REMINDER_TICK_MINUTES} * * * *`;
const SLOT_MS = REMINDER_TICK_MINUTES * 60_000;

export const shiftRemindersPayload = firmJobEnvelope.extend({
  idempotencyKey: z.string().regex(/^shift-reminders:\d{1,12}$/),
});
export type ShiftRemindersPayload = z.infer<typeof shiftRemindersPayload>;

const job = { queue: SHIFT_REMINDERS_QUEUE, schema: shiftRemindersPayload };

export interface ReminderDeps extends NotifyDeps {
  baseDomain: string;
  clock: Clock;
}

interface Booking {
  assignmentId: string;
  workerId: string;
  shiftId: string;
  startsAt: Date;
  endsAt: Date;
  siteName: string | null;
  mobile: string;
  channel: WorkerChannel;
  smsAllowed: boolean; // false: they replied STOP to a text
}

type Due = Booking & { decision: Extract<ReminderDecision, { action: "send" | "skip" }> };

async function firmOf(tx: FirmTx) {
  const [firm] = await tx
    .select({
      name: firms.name,
      slug: firms.slug,
      timezone: firms.timezone,
      settings: firms.settings,
      line: firms.shiftsLineE164, // the firm's shifts line: reminders go from it
    })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  if (!firm) throw new Error("firm not visible inside its own transaction");
  return firm;
}

// The reminders due now in this firm: confirmed bookings on open or filled shifts starting within
// 24 hours, the reminder the rules say is due (or to skip), and not already recorded. Reads only.
export async function dueReminders(
  tx: FirmTx,
  firm: { timezone: string; settings: Record<string, unknown> },
  now: Date,
): Promise<Due[]> {
  const until = new Date(now.getTime() + REMINDER_LOOKAHEAD_MS);
  const { rows } = await tx.execute<{
    assignment_id: string;
    worker_id: string;
    confirmed_at: string | Date | null;
    shift_id: string;
    starts_at: string | Date;
    ends_at: string | Date;
    site_name: string | null;
    mobile: string;
    channel: WorkerChannel;
    sms_allowed: boolean;
    has_24h: boolean;
    has_2h: boolean;
  }>(sql`
    select a.id as assignment_id, a.worker_id, a.confirmed_at,
           s.id as shift_id, s.starts_at, s.ends_at, si.name as site_name,
           w.mobile_e164 as mobile, w.notify_channel as channel,
           w.sms_opted_out_at is null as sms_allowed,
           exists (select 1 from shift_reminders r
                    where r.firm_id = a.firm_id and r.assignment_id = a.id and r.kind = '24h'
                      and r.starts_at = s.starts_at) as has_24h,
           exists (select 1 from shift_reminders r
                    where r.firm_id = a.firm_id and r.assignment_id = a.id and r.kind = '2h'
                      and r.starts_at = s.starts_at) as has_2h
      from assignments a
      join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
      join workers w on w.firm_id = a.firm_id and w.id = a.worker_id
      left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
     where a.status = 'confirmed' and a.worker_id is not null
       and s.status in ('open', 'filled')
       and s.starts_at > ${now} and s.starts_at <= ${until}
     order by s.starts_at, a.id
  `);
  const quiet = quietHours(firm.settings);
  const due: Due[] = [];
  for (const r of rows) {
    const startsAt = new Date(r.starts_at);
    const decision = reminderDecision({
      startsAt,
      confirmedAt: r.confirmed_at ? new Date(r.confirmed_at) : null,
      now,
      timeZone: firm.timezone,
      quiet,
    });
    if (decision.action !== "send" && decision.action !== "skip") continue;
    if (decision.kind === "24h" ? r.has_24h : r.has_2h) continue;
    due.push({
      assignmentId: r.assignment_id,
      workerId: r.worker_id,
      shiftId: r.shift_id,
      startsAt,
      endsAt: new Date(r.ends_at),
      siteName: r.site_name,
      mobile: r.mobile,
      channel: r.channel,
      smsAllowed: r.sms_allowed,
      decision,
    });
  }
  return due;
}

const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};

// Writes the reminder's row, if the booking is still confirmed on an open or filled shift at that
// start time (to the millisecond: a JavaScript date has no microseconds) (it may have been cancelled or moved since the list was read) and no row exists yet.
// Its id, or null: nothing to send or record.
async function claim(
  tx: FirmTx,
  b: Booking,
  kind: ReminderKind,
  status: "sending" | "skipped",
  now: Date,
): Promise<string | null> {
  const channel = status === "sending" ? b.channel : null;
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into shift_reminders (firm_id, assignment_id, kind, starts_at, status, channel, recorded_at)
    select a.firm_id, a.id, ${kind}, s.starts_at, ${status}, ${channel}, ${now}
      from assignments a
      join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
     where a.id = ${b.assignmentId} and a.worker_id = ${b.workerId} and a.status = 'confirmed'
       and s.status in ('open', 'filled')
       and date_trunc('milliseconds', s.starts_at) = ${b.startsAt}
    on conflict do nothing
    returning id::text as id
  `);
  return rows[0]?.id ?? null;
}

export type RemindersResult = { sent: number; failed: number; skipped: number };

export async function runShiftReminders(
  payload: ShiftRemindersPayload,
  run: WithFirm,
  deps: ReminderDeps,
): Promise<RemindersResult> {
  const now = deps.clock.now();
  const inFirm = <T>(fn: (tx: FirmTx) => Promise<T>) => run(payload.firmId, fn);
  const { firm, due } = await inFirm(async (tx) => {
    const f = await firmOf(tx);
    return { firm: f, due: await dueReminders(tx, f, now) };
  });
  const voice = { name: firm.name, signOff: signOffFor(firm.name, firm.settings.sign_off) };
  const base = portalUrl(firm.slug, deps.baseDomain);
  const result: RemindersResult = { sent: 0, failed: 0, skipped: 0 };

  for (const { decision, ...b } of due) {
    if (decision.action === "skip") {
      const skipped = await inFirm(async (tx) => {
        const id = await claim(tx, b, decision.kind, "skipped", now);
        if (!id) return false;
        await recordEvent(tx, {
          actorType: "system",
          action: "shift.reminder_skipped",
          entityType: "shift_reminder",
          entityId: id,
          data: {
            shiftId: b.shiftId,
            workerId: b.workerId,
            kind: decision.kind,
            reason: decision.reason,
          },
        });
        return true;
      });
      if (skipped) result.skipped += 1;
      continue;
    }

    const kind = decision.kind;
    // (1) Claimed and committed before anything is sent.
    const id = await inFirm((tx) => claim(tx, b, kind, "sending", now));
    if (!id) continue;

    // (2) The message, outside any transaction.
    const link = `${base}/shifts/${b.shiftId}`;
    const start = timeOf(b.startsAt, firm.timezone);
    const end = timeOf(b.endsAt, firm.timezone);
    const day = dayWords(b.startsAt, now, firm.timezone);
    const body =
      kind === "24h"
        ? shiftReminder24hMessage(voice, { site: b.siteName, day, start, end, link })
        : shiftReminder2hMessage(voice, { site: b.siteName, start, link });
    // The doc has no separate SMS version of the reminders: the same text either way.
    const sent = await sendToWorker(deps, {
      mobile: b.mobile,
      channel: b.channel,
      smsAllowed: b.smsAllowed,
      body: { whatsapp: body, sms: body },
      from: firm.line,
    });

    // (3) The outcome, the push and the event.
    await inFirm(async (tx) => {
      if (!sent.ok) {
        await tx
          .update(shiftReminders)
          .set({ status: "failed", channel: sent.channel })
          .where(eq(shiftReminders.id, id));
        await recordEvent(tx, {
          actorType: "system",
          action: "shift.reminder_failed",
          entityType: "shift_reminder",
          entityId: id,
          data: {
            shiftId: b.shiftId,
            workerId: b.workerId,
            kind,
            channel: sent.channel,
            code: sent.code,
          },
        });
        return;
      }
      const pushes = await pushToWorker(tx, deps, b.workerId, {
        ...reminderPush({ kind, site: b.siteName, day, start, end }),
        url: `/shifts/${b.shiftId}`,
      });
      await tx
        .update(shiftReminders)
        .set({ status: "sent", channel: sent.channel })
        .where(eq(shiftReminders.id, id));
      await recordEvent(tx, {
        actorType: "system",
        action: "shift.reminder_sent",
        entityType: "shift_reminder",
        entityId: id,
        data: {
          shiftId: b.shiftId,
          workerId: b.workerId,
          kind,
          channel: sent.channel,
          providerMessageId: sent.providerMessageId,
          pushes,
          ...(sent.fellBackFrom ? { fellBackFrom: sent.fellBackFrom } : {}),
        },
      });
    });
    if (sent.ok) result.sent += 1;
    else result.failed += 1;
  }
  return result;
}

export function createShiftRemindersTask(
  deps: () => ReminderDeps,
): FirmTask<ShiftRemindersPayload> {
  return {
    queue: SHIFT_REMINDERS_QUEUE,
    schema: shiftRemindersPayload,
    task: (payload, run) => runShiftReminders(payload, run, deps()),
  };
}

// The worker's wiring. Deps are read when a job runs, so the web never needs the worker's
// configuration.
const workerDeps = (): ReminderDeps => {
  const env = workerEnv();
  return {
    transport: getTransport(env),
    push: getPushTransport(env),
    baseDomain: env.APP_BASE_DOMAIN,
    clock: systemClock,
  };
};
export const shiftRemindersTask = createShiftRemindersTask(workerDeps);

export interface ReminderTickDeps {
  listFirmIds: () => Promise<string[]>;
  run: WithFirm;
  clock?: Clock;
  logger?: Logger;
}

// Queues a firm's reminder job only when something is due (so pg-boss isn't filled with empty
// jobs every 5 minutes). One firm's failure never stops the others.
export async function runShiftReminderTick(deps: ReminderTickDeps): Promise<{ queued: number }> {
  const now = (deps.clock ?? systemClock).now();
  const logger = deps.logger ?? log;
  const slot = Math.floor(now.getTime() / SLOT_MS);
  let queued = 0;
  for (const firmId of await deps.listFirmIds()) {
    try {
      const sent = await deps.run(firmId, async (tx) => {
        const firm = await firmOf(tx);
        if ((await dueReminders(tx, firm, now)).length === 0) return false;
        const id = await sendFirmJob(
          tx,
          job,
          { idempotencyKey: `shift-reminders:${slot}` },
          { singletonKey: "shift-reminders", singletonSeconds: 240 },
        );
        return id !== null;
      });
      if (sent) queued += 1;
    } catch (err) {
      logger.error("shift reminder tick failed for a firm", { firmId, error: err });
    }
  }
  return { queued };
}
