import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import {
  CANCELLED_ASSIGNMENT_STATUSES,
  events,
  firms,
  officeUsers,
  offers,
  shifts,
  sites,
} from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { noticeHours } from "../roster/notice";
import { recordEvent } from "../events/record";
import { errorCode, firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { log } from "../log";
import { getTransport } from "../messaging";
import {
  shiftEscalationEmail,
  shiftUrgentMessage,
  shiftUrgentSms,
  shiftUrgentEmailSubject,
  urgentPush,
} from "../messaging/templates";
import { dayWords, shiftWhen } from "../portal/format";
import { eachAtMost, oneAtATime } from "../notify/parallel";
import { deliverToWorker, recordPushes, type NotifyDeps } from "../notify/send";
import { getPushTransport } from "../push/transport";
import { parseAllocationSettings, type AllocationSettings } from "../roster/allocation-input";
import { previewBooking } from "../roster/book";
import { rankForFairRotation } from "../rules/allocation";
import { mayMessageNow, quietHours } from "../rules/quiet-hours";
import { hoursToStart } from "../rules/urgent";
import { isVisibleToCasuals } from "../roster/visibility";
import { portalUrl } from "../tenancy/portal-url";
import { signOffFor } from "../tenancy/sign-off";
import { wallTimeOf } from "../time/zoned";
import { offerLimit } from "./offer-limit";
import { lockOfferCounts, waveCandidates, type WaveCandidate } from "./candidates";
import { closeOpenOffers } from "./close";
import { lockOfferOutcome, logUnconfirmedOffers } from "./unconfirmed";
import { lockLiveContact, type LiveContact } from "./reachable";
import { travelSettings } from "../travel/settings";

// Offer waves and escalation (docs/api-and-jobs.md, "Job catalogue" and "Offer-wave ranking";
// docs/architecture.md, "Offer waves"). Two firm jobs:
//
// - offer-wave {shiftId, wave}: while the shift is open, not started, shown to casuals (its switch
//   and its event's: src/lib/roster/visibility.ts) and has a place free, send
//   the urgent offer to the next workers the rules allow (candidates.ts), best first by
//   rankForFairRotation, then the next wave `wave_minutes` later while anyone is left: under fair
//   rotation the firm's `wave_size` a wave; under first come, first served `wave_per_place` per free
//   place (default 5), at most 50 (PLAN.md P4.3, "Connecting the firm's systems" 10: everyone at
//   once was about 1,500 texts for one place at a big firm). First come still means the first yes
//   wins: the Open shifts board shows the shift to everyone eligible. Each offer is an `offers` row
//   and an `offer.sent` event; a wave already sent sends nothing (a retry, or a second chain after
//   another dropout).
//   When there's no one left, or the shift filled, started, closed or was hidden, the chain stops
//   (`offer.waves_stopped`); a filled shift's unanswered offers become "filled_elsewhere".
// - escalate-shift {shiftId}: at the start minus `escalate_hours_before_start` (default 3), if a
//   place is still free and the shift hasn't started, email the office's active admins and
//   resourcers once (`shift.escalated`, which the dashboard's urgent cards read).
//
// startOfferWaves() queues both, in the transaction that caused them (a place reopened inside the
// urgent window, the office marking the shift urgent: src/lib/roster/urgent.ts, or showing an
// urgent session to casuals again: src/lib/office/showing.ts). A session hidden from casuals gets
// no wave, only the office's escalation check.
// Each offer goes first as a push to the worker's subscribed phones (PUSH_TRANSPORT: webpush once
// the keys are set, console in development and tests), else through the configured transport by
// their channel (console in development and tests), else by email (deliverToWorker, P2.4). Quiet hours hold a wave unless the firm lets urgent override them; a
// WhatsApp that won't send goes by SMS. Workers come only from waveCandidates() (the rules, and the
// daily cap, which never holds back an urgent offer).
//
// Both are firm tasks: several short transactions, never one held across a message (the shift
// reminders' claim → send → record, src/lib/reminders/send.ts). A worker who taps "Take shift" while
// a wave is going out, or the office pressing "Assign", waits for one worker's claim at most
// (milliseconds), never for the messages (tests/integration/offers.waves.lock.test.ts). A wave:
//   1. checks the shift under its lock: stop, hold for quiet hours, or go on;
//   2. reads the candidates, with no locks held;
//   3. per worker, claims: re-locks the shift and re-checks it's still open, urgent, has a place,
//      is the same shift (role, times, site: if the office changed them, the wave starts again
//      from the shift as it is now) and the wave isn't full (first come: by the places free now,
//      so a place taken mid-wave shrinks it); then the worker as they are now: still reachable and
//      wanting offers, not offered or booked it since the list was read, and allowed by the rules;
//      then writes their `offers` row and commits. Only then the message (to their contact as read
//      in the claim) and the push, each outside any transaction, then `offer.sent` (or
//      `offer.send_failed`) in a short one. Up to 4 messages go at once (P4.4), but the claims are
//      made one after another. A row claimed but never recorded (a crash just after the claim)
//      means the message may have gone: like a `sending` reminder, it's never sent again. If the
//      shift fills while the wave is going out, the rest aren't messaged;
//   4. queues the next wave, in either mode (once: a pg-boss singleton key).
// A retried or doubled wave carries on with whoever the rules still allow and nobody has offered
// it to yet, up to the wave's size; everyone already offered is left out by the candidate rules.

export const OFFER_WAVE_QUEUE = "offer-wave";
export const ESCALATE_SHIFT_QUEUE = "escalate-shift";
export const DEFAULT_ESCALATE_HOURS = 3;

export const offerWavePayload = firmJobEnvelope.extend({
  shiftId: z.uuid(),
  wave: z.number().int().min(1).max(1000),
});
export type OfferWavePayload = z.infer<typeof offerWavePayload>;
export const escalateShiftPayload = firmJobEnvelope.extend({ shiftId: z.uuid() });
export type EscalateShiftPayload = z.infer<typeof escalateShiftPayload>;

const escalateSchema = z.object({
  escalate_hours_before_start: z.number().min(0).max(72).default(DEFAULT_ESCALATE_HOURS),
});

// The firm's escalation hours. A value that makes no sense gives the default: it's read while
// recording a cancellation (startOfferWaves), which must never fail.
export function escalateHours(settings: Record<string, unknown>): number {
  const parsed = escalateSchema.safeParse(settings);
  return parsed.success ? parsed.data.escalate_hours_before_start : DEFAULT_ESCALATE_HOURS;
}

// First come, first served's waves (P4.3): `wave_per_place` casuals per free place, at most
// WAVE_MAX a wave, `wave_minutes` apart. Read while a wave runs, so a value that makes no sense gives
// the default instead of failing it.
export const DEFAULT_WAVE_PER_PLACE = 5;
export const WAVE_MAX = 50;
export const DEFAULT_WAVE_MINUTES = 15;
// A wave's messages at once (P4.4): 50 at 300 ms each take about 4 seconds, not 15. Each lane holds
// at most one database connection at a time (claims are short and one at a time; the messages go
// with none).
export const WAVE_SENDS_AT_ONCE = 4;
const perPlaceSchema = z.number().int().min(1).max(20);
const minutesSchema = z.number().int().min(1).max(240);

export function firstComeWaves(settings: Record<string, unknown>): {
  perPlace: number;
  minutes: number;
} {
  const perPlace = perPlaceSchema.safeParse(settings.wave_per_place);
  const minutes = minutesSchema.safeParse(settings.wave_minutes);
  return {
    perPlace: perPlace.success ? perPlace.data : DEFAULT_WAVE_PER_PLACE,
    minutes: minutes.success ? minutes.data : DEFAULT_WAVE_MINUTES,
  };
}

// How many a wave goes to (pure): fair rotation's fixed size; first come's per free place, at most
// WAVE_MAX, so a place taken shrinks it and a filled shift's is 0.
export function waveCap(
  settings: AllocationSettings,
  firstCome: { perPlace: number },
  freePlaces: number,
): number {
  if (settings.mode === "fair_rotation") return settings.groupSize;
  return Math.min(WAVE_MAX, firstCome.perPlace * Math.max(0, freePlaces));
}

// Who this wave goes to (pure): the best `waveSize` by fair rotation's order (fewest hours this
// week, then longest since their last offer), in both modes. `seed` (the shift and wave) fixes how
// ties are broken (rankForFairRotation).
export function pickWave<C extends WaveCandidate>(
  candidates: C[],
  waveSize: number,
  seed?: string,
): C[] {
  return rankForFairRotation(candidates, seed).slice(0, Math.max(0, waveSize));
}

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));
const HOUR = 3_600_000;

const jobs = {
  wave: { queue: OFFER_WAVE_QUEUE, schema: offerWavePayload },
  escalate: { queue: ESCALATE_SHIFT_QUEUE, schema: escalateShiftPayload },
};

// Queues the next wave now (only for a session shown to casuals), and the escalation check for the
// start minus the firm's hours (at once if that time has passed). Inside the caller's withFirm
// transaction. True when a wave was queued.
export async function startOfferWaves(
  tx: FirmTx,
  input: { shiftId: string; now: Date },
): Promise<boolean> {
  const [shift] = await tx
    .select({ startsAt: shifts.startsAt, settings: firms.settings })
    .from(shifts)
    .innerJoin(firms, eq(firms.id, shifts.firmId))
    .where(eq(shifts.id, input.shiftId));
  if (!shift) return false;
  // The event share-locked: an event being shown or hidden at this moment finishes first, so a
  // gap made urgent while its event is switched back on still gets its wave (showing.ts can't see
  // this uncommitted change). Every caller holds the shift's lock already, or is that switch.
  const showing = await isVisibleToCasuals(tx, input.shiftId, { lock: true });
  if (showing) {
    const { rows } = await tx.execute<{ next: number }>(
      sql`select coalesce(max(wave), 0)::int + 1 as next from offers where shift_id = ${input.shiftId}`,
    );
    const wave = rows[0]?.next ?? 1;
    await sendFirmJob(tx, jobs.wave, {
      idempotencyKey: `offer-wave:${input.shiftId}:${wave}`,
      shiftId: input.shiftId,
      wave,
    });
  }
  const escalateAt = new Date(shift.startsAt.getTime() - escalateHours(shift.settings) * HOUR);
  await sendFirmJob(
    tx,
    jobs.escalate,
    { idempotencyKey: `escalate-shift:${input.shiftId}`, shiftId: input.shiftId },
    escalateAt.getTime() > input.now.getTime() ? { startAfter: escalateAt } : undefined,
  );
  return showing;
}

export interface OfferDeps extends NotifyDeps {
  baseDomain: string;
  clock: Clock;
  // Before a session's first wave: its missing travel estimates (12G.2), best-effort. Absent: none.
  travelBeforeFirstWave?: (run: WithFirm, firmId: string, shiftId: string) => Promise<void>;
}

export interface LockedShift {
  id: string;
  firmId: string;
  role: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  isUrgent: boolean;
  siteName: string | null;
  freePlaces: number;
  showing: boolean; // shown to casuals: its switch and its event's (src/lib/roster/visibility.ts)
}

// The shift, locked (the same shift-first order as booking), with its places still free and
// whether casuals see it (its event share-locked, as a booking does: switching the event off
// waits for this transaction).
export async function lockShift(tx: FirmTx, shiftId: string): Promise<LockedShift | null> {
  const [row] = await tx
    .select({
      id: shifts.id,
      firmId: shifts.firmId,
      role: shifts.role,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      status: shifts.status,
      headcount: shifts.headcount,
      isUrgent: shifts.isUrgent,
      siteName: sites.name,
    })
    .from(shifts)
    .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
    .where(eq(shifts.id, shiftId))
    .for("no key update", { of: shifts });
  if (!row) return null;
  const { rows } = await tx.execute<{ taken: number }>(sql`
    select count(*)::int as taken from assignments
     where shift_id = ${shiftId} and worker_id is not null
       and status not in (${CANCELLED}) and slot <= ${row.headcount}
  `);
  return {
    ...row,
    freePlaces: Math.max(0, row.headcount - (rows[0]?.taken ?? 0)),
    showing: await isVisibleToCasuals(tx, shiftId, { lock: true }),
  };
}

export async function firmVoice(tx: FirmTx, firmId: string) {
  const [firm] = await tx
    .select({
      name: firms.name,
      slug: firms.slug,
      timezone: firms.timezone,
      settings: firms.settings,
      line: firms.shiftsLineE164, // the firm's shifts line: messages go from it
    })
    .from(firms)
    .where(eq(firms.id, firmId));
  if (!firm) throw new Error("firm not visible inside its own transaction");
  return {
    ...firm,
    voice: { name: firm.name, signOff: signOffFor(firm.name, firm.settings.sign_off) },
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
export const timeOf = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};

export type StopReason =
  | "filled"
  | "started"
  | "not_open"
  | "hidden"
  | "not_urgent"
  | "no_candidates"
  // The most casuals for its free places have been offered it (Phase 25.3: offer-limit.ts).
  | "offer_limit";

export type WaveResult =
  | { status: "sent"; sent: number; next: number | null }
  | { status: "held"; until: Date } // quiet hours
  | { status: "already_sent" }
  // `sent`: offers this run sent before the shift filled, started, closed or was hidden (absent when
  // none).
  | { status: "stopped"; reason: StopReason | "gone"; sent?: number }
  // The shift's role, times or site changed mid-wave: queued again from the shift as it is now.
  | { status: "restarted"; sent: number };

// Why the shift can't be offered now (null: it can).
function notOfferable(
  shift: LockedShift,
  now: Date,
): Exclude<StopReason, "no_candidates" | "offer_limit"> | null {
  if (shift.startsAt.getTime() <= now.getTime()) return "started";
  if (shift.status !== "open" && shift.status !== "filled") return "not_open";
  // No place free, or the office marked it filled (it found someone another way: closeShift()).
  if (shift.freePlaces === 0 || shift.status === "filled") return "filled";
  // The office hid the session or its event from casuals: no offers while it's hidden.
  if (!shift.showing) return "hidden";
  // The office cleared the urgent mark: no more urgent offers.
  if (!shift.isUrgent) return "not_urgent";
  return null;
}

// Ends the chain. A filled shift's offers still waiting are closed (usually already, by whatever
// filled it: src/lib/offers/close.ts).
// At the offer limit, how many were offered it and for how many free places.
async function stopWaves(
  tx: FirmTx,
  shiftId: string,
  wave: number,
  reason: StopReason,
  now: Date,
  limit?: { offered: number; places: number },
): Promise<void> {
  if (reason === "filled") await closeOpenOffers(tx, shiftId, now);
  await recordEvent(tx, {
    actorType: "system",
    action: "offer.waves_stopped",
    entityType: "shift",
    entityId: shiftId,
    data: { reason, wave, ...(limit ?? {}) },
  });
}

// How many casuals have been offered the shift, in any wave or by the office (one whose offer
// couldn't be sent doesn't count: they can be offered it again).
async function offeredSoFar(tx: FirmTx, shiftId: string): Promise<number> {
  const { rows } = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from offers
         where shift_id = ${shiftId} and response is distinct from 'failed'`,
  );
  return rows[0]?.n ?? 0;
}

// How many workers this wave has been offered to so far (a failed send counts: it was this wave's).
async function offersInWave(tx: FirmTx, shiftId: string, wave: number): Promise<number> {
  const { rows } = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from offers where shift_id = ${shiftId} and wave = ${wave}`,
  );
  return rows[0]?.n ?? 0;
}

type Claim =
  | { kind: "claimed"; offerId: string; contact: LiveContact }
  | { kind: "skip" } // offered or booked since the list was read, unreachable, or the rules say no
  | { kind: "full" } // the wave has its workers (its size now: waveCap)
  | { kind: "restart" } // the shift changed: this wave queued again from the shift as it is now
  | { kind: "stop"; reason: StopReason | "gone" };

// Whether the role, times or site differ from what this run read (the message would be wrong).
function changedSince(read: LockedShift, now: LockedShift): boolean {
  return (
    read.role !== now.role ||
    read.startsAt.getTime() !== now.startsAt.getTime() ||
    read.endsAt.getTime() !== now.endsAt.getTime() ||
    read.siteName !== now.siteName
  );
}

// The candidate list's per-worker exclusions (candidates.ts), checked again under the shift lock:
// a place on the shift now or before (a cancellation is a "no"), or an offer of it that didn't fail.
async function offeredOrHeld(tx: FirmTx, shiftId: string, workerId: string): Promise<boolean> {
  const { rows } = await tx.execute(sql`
    select 1 from assignments where shift_id = ${shiftId} and worker_id = ${workerId}
    union all
    select 1 from offers where shift_id = ${shiftId} and worker_id = ${workerId}
                           and response is distinct from 'failed'
    limit 1
  `);
  return rows.length > 0;
}

export async function runOfferWave(
  payload: OfferWavePayload,
  run: WithFirm,
  deps: OfferDeps,
): Promise<WaveResult> {
  const now = deps.clock.now();
  const inFirm = <T>(fn: (tx: FirmTx) => Promise<T>) => run(payload.firmId, fn);

  // 1. The check, under the shift lock (held only for this short transaction).
  const checked = await inFirm(async (tx) => {
    const shift = await lockShift(tx, payload.shiftId);
    if (!shift) return { done: { status: "stopped", reason: "gone" } as WaveResult };
    const already = await offersInWave(tx, shift.id, payload.wave);
    // Run again after it stopped part-way: offers it claimed but never logged are logged now, as
    // sent and unconfirmed (src/lib/offers/unconfirmed.ts).
    if (already > 0) await logUnconfirmedOffers(tx, shift, { wave: payload.wave });
    const blocked = notOfferable(shift, now);
    // A wave already sent that the shift has since outgrown: nothing more, and nothing to record.
    if (blocked && already > 0) return { done: { status: "already_sent" } as WaveResult };
    if (blocked) {
      await stopWaves(tx, shift.id, payload.wave, blocked, now);
      return { done: { status: "stopped", reason: blocked } as WaveResult };
    }
    // The most for its free places already offered it (Phase 25.3): the chain stops here. (A wave
    // already sent that reached it stopped its own claims, or queued this one to say so.)
    const offered = await offeredSoFar(tx, shift.id);
    if (offered >= offerLimit(shift.freePlaces)) {
      if (already > 0) return { done: { status: "already_sent" } as WaveResult };
      await stopWaves(tx, shift.id, payload.wave, "offer_limit", now, {
        offered,
        places: shift.freePlaces,
      });
      return { done: { status: "stopped", reason: "offer_limit" } as WaveResult };
    }
    const firm = await firmVoice(tx, shift.firmId);
    // Quiet hours: an urgent wave goes now if the firm lets urgent override them; otherwise it's
    // held until they end, and queued for then (nothing is written or sent before that). A wave
    // retried after it had begun is held too: the rest go when quiet hours end.
    const timing = mayMessageNow({
      now,
      timeZone: firm.timezone,
      quiet: quietHours(firm.settings),
      urgent: true,
    });
    // (Within a minute of the end, it just goes: the job queue's clock and ours can differ a little.)
    if (!timing.ok && timing.until.getTime() - now.getTime() > 60_000) {
      await sendFirmJob(
        tx,
        jobs.wave,
        {
          idempotencyKey: `offer-wave:${shift.id}:${payload.wave}:after-quiet`,
          shiftId: shift.id,
          wave: payload.wave,
        },
        { startAfter: timing.until },
      );
      await recordEvent(tx, {
        actorType: "system",
        action: "offer.wave_held",
        entityType: "shift",
        entityId: shift.id,
        data: { wave: payload.wave, until: timing.until.toISOString(), reason: "quiet_hours" },
      });
      return { done: { status: "held", until: timing.until } as WaveResult };
    }
    return { shift, firm, already, offered };
  });
  if (checked.done) return checked.done;
  const { shift, firm, already, offered } = checked;
  const settings = parseAllocationSettings(firm.settings);
  const firstCome = firstComeWaves(firm.settings);
  const minutesApart =
    settings.mode === "fair_rotation" ? settings.priorityMinutes : firstCome.minutes;

  // The first wave of a session (an urgent one made close to the start may have none yet): its
  // travel estimates first, outside any transaction, so they're there before anyone is offered it.
  // Best-effort: a travel service that doesn't answer never holds the offers back. None where the
  // firm has travel areas off (13.4).
  if (
    payload.wave === 1 &&
    already === 0 &&
    deps.travelBeforeFirstWave &&
    travelSettings(firm.settings).enabled
  ) {
    try {
      await deps.travelBeforeFirstWave(run, payload.firmId, shift.id);
    } catch (error) {
      log.warn("travel estimates before a wave failed", { firmId: payload.firmId, error });
    }
  }

  // 2. Who it goes to: read with no locks held (the rules for every active worker with the role can
  // take a while). Waves only run for urgent shifts (checked above), so the daily cap doesn't hold
  // them back. Workers already offered this shift (this wave included) aren't candidates.
  const candidates = await inFirm((tx) => waveCandidates(tx, shift.id, now));
  // The wave's size, and never past the offer limit (Phase 25.3).
  const room = Math.max(
    0,
    Math.min(
      waveCap(settings, firstCome, shift.freePlaces) - already,
      offerLimit(shift.freePlaces) - offered,
    ),
  );
  const chosen = pickWave(candidates, room, `${shift.id}:${payload.wave}`);
  // The next wave after the firm's minutes, if anyone may be left after this one (either mode):
  // someone not chosen, or chosen but not reached because the wave filled first (a place taken
  // mid-wave shrinks it; the next wave finds who's left, or stops with no_candidates). Queued
  // once whichever copy of this wave gets here (a pg-boss singleton key on the shift and wave, in
  // pg-boss's day-long slot), so a retried or doubled wave doesn't start a second chain; a duplicate
  // across the slot's edge would only find the next wave already sent.
  let full = false;
  const queueNext = async (): Promise<number | null> => {
    if (!full && candidates.length <= chosen.length) return null;
    const next = payload.wave + 1;
    await inFirm((tx) =>
      sendFirmJob(
        tx,
        jobs.wave,
        { idempotencyKey: `offer-wave:${shift.id}:${next}`, shiftId: shift.id, wave: next },
        {
          startAfter: new Date(now.getTime() + minutesApart * 60_000),
          singletonKey: `offer-wave-next:${shift.id}:${next}`,
          singletonSeconds: 86_400,
        },
      ),
    );
    return next;
  };
  if (chosen.length === 0) {
    if (already > 0) {
      await queueNext();
      return { status: "already_sent" };
    }
    await inFirm((tx) => stopWaves(tx, shift.id, payload.wave, "no_candidates", now));
    return { status: "stopped", reason: "no_candidates" };
  }

  const link = `${portalUrl(firm.slug, deps.baseDomain)}/shifts/${shift.id}`;
  const day = dayWords(shift.startsAt, now, firm.timezone);
  const start = timeOf(shift.startsAt, firm.timezone);
  // The WhatsApp template, or the short SMS version when it goes by text.
  const body = {
    whatsapp: shiftUrgentMessage(firm.voice, {
      role: shift.role,
      site: shift.siteName,
      day,
      start,
      end: timeOf(shift.endsAt, firm.timezone),
      link,
    }),
    sms: shiftUrgentSms(firm.voice, { role: shift.role, site: shift.siteName, day, start, link }),
  };
  // By email (P2.4), the WhatsApp words under the approved subject.
  const subject = shiftUrgentEmailSubject({ role: shift.role, day });
  // An urgent offer goes at high urgency, and is no use once the shift has started.
  const pushed = {
    ...urgentPush({ role: shift.role, site: shift.siteName, day, start }),
    url: `/shifts/${shift.id}`,
    urgent: true,
    until: shift.startsAt,
  };

  // 3. Up to WAVE_SENDS_AT_ONCE workers at a time (P4.4): each claimed alone, then its message and
  // its record while the next is claimed. The claims run one after another, here as well as under
  // the shift's lock: once one finds the wave full or the shift filled, changed or gone, or anything
  // fails, no more are claimed. The messages already claimed still go and are recorded.
  let sent = 0;
  const outcome: { ended?: Extract<Claim, { kind: "stop" | "restart" }>; halted: boolean } = {
    halted: false,
  };
  const inTurn = oneAtATime();
  const claimFor = (c: WaveCandidate) =>
    inTurn(async (): Promise<Claim | null> => {
      if (outcome.halted) return null;
      try {
        const claim = await inFirm(async (tx): Promise<Claim> => {
          // The same shift-first lock order as booking and the office's offer, held for this claim only:
          // every writer of offers and assignments for this shift waits for it, so the checks below
          // can't race them.
          const current = await lockShift(tx, shift.id);
          if (!current) return { kind: "stop", reason: "gone" };
          const at = deps.clock.now();
          const blocked = notOfferable(current, at);
          if (blocked) {
            await stopWaves(tx, shift.id, payload.wave, blocked, now);
            return { kind: "stop", reason: blocked };
          }
          // The office changed what the shift is (its role, times or site) since this run read it: the
          // message and the candidate list are out of date. This wave starts again at once from the
          // shift as it is now; everyone already offered it is left out.
          if (changedSince(shift, current)) {
            await sendFirmJob(tx, jobs.wave, {
              idempotencyKey: `offer-wave:${shift.id}:${payload.wave}:changed`,
              shiftId: shift.id,
              wave: payload.wave,
            });
            return { kind: "restart" };
          }
          // The wave's size now: under first come, by the places still free (one taken mid-wave
          // shrinks it).
          if (
            (await offersInWave(tx, shift.id, payload.wave)) >=
            waveCap(settings, firstCome, current.freePlaces)
          ) {
            return { kind: "full" };
          }
          // The offer limit, as things are now (the office may have offered it meanwhile, or a
          // place been taken): the chain stops (Phase 25.3).
          const offeredNow = await offeredSoFar(tx, shift.id);
          if (offeredNow >= offerLimit(current.freePlaces)) {
            await stopWaves(tx, shift.id, payload.wave, "offer_limit", now, {
              offered: offeredNow,
              places: current.freePlaces,
            });
            return { kind: "stop", reason: "offer_limit" };
          }
          // Urgent, so the cap doesn't limit this offer; the lock makes an office offer being counted
          // at the same moment wait for it (candidates.ts).
          await lockOfferCounts(tx, [c.workerId]);
          // The worker as they are now: anyone erased, made inactive or who turned offers off since the
          // list was read gets none, and a STOP or a changed channel is honoured.
          const contact = await lockLiveContact(tx, c.workerId);
          if (!contact) return { kind: "skip" };
          // The candidate rules again, for this worker, now: not offered this shift since the list was
          // read (by the office, or another copy of a wave), never on it (a booking or a cancellation
          // since), and the rules still allow them (a licence suspended mid-wave, say).
          if (await offeredOrHeld(tx, shift.id, c.workerId)) return { kind: "skip" };
          const verdict = await previewBooking(tx, {
            shiftId: shift.id,
            workerId: c.workerId,
            now: at,
          });
          if (!verdict?.ok) return { kind: "skip" };
          const [offer] = await tx
            .insert(offers)
            .values({
              firmId: shift.firmId,
              shiftId: shift.id,
              workerId: c.workerId,
              wave: payload.wave,
              channel: contact.channel,
              sentAt: now,
            })
            .onConflictDoNothing()
            .returning({ id: offers.id });
          return offer ? { kind: "claimed", offerId: offer.id, contact } : { kind: "skip" };
        });
        if (claim.kind === "stop" || claim.kind === "restart") {
          outcome.ended = claim;
          outcome.halted = true;
        }
        if (claim.kind === "full") {
          full = true;
          outcome.halted = true;
        }
        return claim;
      } catch (error) {
        outcome.halted = true;
        throw error;
      }
    });
  await eachAtMost(chosen, WAVE_SENDS_AT_ONCE, async (c) => {
    try {
      const claim = await claimFor(c);
      if (claim?.kind === "skip") return;
      if (claim?.kind !== "claimed") return "stop";

      // The offer, outside any transaction: a push to their phones, else by their channel, else
      // email (src/lib/notify/send.ts deliverToWorker; P2.4).
      const contact = claim.contact;
      const result = await deliverToWorker(inFirm, deps, {
        workerId: c.workerId,
        push: pushed,
        text: {
          mobile: contact.mobile,
          channel: contact.channel,
          smsAllowed: contact.smsAllowed,
          body,
          from: firm.line,
        },
        email: contact.email ? { to: contact.email, subject, body: body.whatsapp } : null,
      });

      // The outcome. A failure doesn't stop the wave: that offer is marked failed and logged, the
      // rest still go, and the worker can be offered it again in a later wave.
      await inFirm(async (tx) => {
        // A phone the push service says is gone is forgotten whatever came of the offer.
        const pushes = await recordPushes(tx, result.push);
        if (!result.ok) {
          // Kept as evidence of the attempt (offers are never deleted), marked failed: unless the
          // worker answered it while it was going out (it may have arrived after all). A close
          // because the shift filled meanwhile is overwritten: this message never arrived, so the
          // worker can be offered it again if the shift reopens. Nothing could carry it at all
          // (no_channel): its channel stays as claimed.
          await tx
            .update(offers)
            .set({
              channel: result.channel ?? contact.channel,
              response: "failed",
              respondedAt: now,
            })
            .where(
              and(
                eq(offers.id, claim.offerId),
                or(isNull(offers.response), eq(offers.response, "filled_elsewhere")),
              ),
            );
          await recordEvent(tx, {
            actorType: "system",
            action: "offer.send_failed",
            entityType: "shift",
            entityId: shift.id,
            data: {
              offerId: claim.offerId,
              workerId: c.workerId,
              wave: payload.wave,
              channel: result.channel,
              code: result.code,
            },
          });
          return;
        }
        if (result.channel !== contact.channel) {
          await tx
            .update(offers)
            .set({ channel: result.channel })
            .where(eq(offers.id, claim.offerId));
        }
        // Logged once: another copy of this wave may have caught it up already, as unconfirmed.
        if (await lockOfferOutcome(tx, claim.offerId)) return;
        await recordEvent(tx, {
          actorType: "system",
          action: "offer.sent",
          entityType: "offer",
          entityId: claim.offerId,
          data: {
            shiftId: shift.id,
            workerId: c.workerId,
            wave: payload.wave,
            // The notice they had of the shift (the notice report counts from this, not a later start).
            noticeHours: noticeHours(shift.startsAt, now),
            channel: result.channel,
            providerMessageId: result.providerMessageId,
            pushes,
            ...(result.fellBackFrom ? { fellBackFrom: result.fellBackFrom } : {}),
          },
        });
      });
      if (result.ok) sent += 1;
    } catch (error) {
      outcome.halted = true;
      throw error;
    }
  });
  const ended = outcome.ended;
  if (ended?.kind === "stop") {
    return sent > 0
      ? { status: "stopped", reason: ended.reason, sent }
      : { status: "stopped", reason: ended.reason };
  }
  if (ended?.kind === "restart") return { status: "restarted", sent };

  // 4. The next wave.
  return { status: "sent", sent, next: await queueNext() };
}

export type EscalateResult =
  { status: "escalated"; notified: number } | { status: "not_needed" } | { status: "already" };

// Escalation, the reminders' way: (1) checked, and `shift.escalated` recorded once (the dashboard's
// "needs attention"; `notified` is how many office users it goes to); (2) per office user, a claim
// (`shift.escalation_emailed` {officeUserId}, committed) and only then the email, with no
// transaction open. A retry or a second copy emails only the office users not yet claimed, so
// nobody is emailed twice; an email that fails is logged (`shift.escalation_failed`) and not tried
// again (it may have arrived), and the rest still go.
export async function runEscalation(
  payload: EscalateShiftPayload,
  run: WithFirm,
  deps: OfferDeps,
): Promise<EscalateResult> {
  const now = deps.clock.now();
  const inFirm = <T>(fn: (tx: FirmTx) => Promise<T>) => run(payload.firmId, fn);
  const checked = await inFirm(async (tx) => {
    const shift = await lockShift(tx, payload.shiftId);
    if (
      !shift ||
      !shift.isUrgent ||
      shift.freePlaces === 0 ||
      shift.status !== "open" || // filled (by bookings or by the office), cancelled or draft
      shift.startsAt.getTime() <= now.getTime()
    ) {
      return { done: { status: "not_needed" } as EscalateResult };
    }
    const [escalated] = await tx
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.action, "shift.escalated"), eq(events.entityId, shift.id)))
      .limit(1);
    const firm = await firmVoice(tx, shift.firmId);
    const recipients = await tx
      .select({ id: officeUsers.id, email: officeUsers.email })
      .from(officeUsers)
      .where(
        and(eq(officeUsers.status, "active"), inArray(officeUsers.role, ["admin", "resourcer"])),
      );
    const { rows } = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from offers where shift_id = ${shift.id}`,
    );
    const offersSent = rows[0]?.n ?? 0;
    const email = shiftEscalationEmail(firm.voice, {
      role: shift.role,
      site: shift.siteName,
      when: shiftWhen(shift.startsAt, shift.endsAt, firm.timezone),
      freePlaces: shift.freePlaces,
      offersSent,
      link: `${portalUrl(firm.slug, deps.baseDomain)}/office`,
    });
    if (!escalated) {
      await recordEvent(tx, {
        actorType: "system",
        action: "shift.escalated",
        entityType: "shift",
        entityId: shift.id,
        data: {
          freePlaces: shift.freePlaces,
          offersSent,
          notified: recipients.length, // office users it goes to ("email" keys are refused in events)
          hoursToStart: hoursToStart(shift.startsAt, now),
        },
      });
    }
    return { shiftId: shift.id, recipients, email, resumed: !!escalated };
  });
  if (checked.done) return checked.done;
  const { shiftId, recipients, email, resumed } = checked;

  let claimed = 0;
  let notified = 0;
  for (const r of recipients) {
    const mine = await inFirm(async (tx) => {
      // Two copies take turns on the shift's lock, so each office user is claimed once.
      await lockShift(tx, shiftId);
      const [done] = await tx
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            eq(events.action, "shift.escalation_emailed"),
            eq(events.entityId, shiftId),
            sql`${events.data} ->> 'officeUserId' = ${r.id}`,
          ),
        )
        .limit(1);
      if (done) return false;
      await recordEvent(tx, {
        actorType: "system",
        action: "shift.escalation_emailed",
        entityType: "shift",
        entityId: shiftId,
        data: { officeUserId: r.id },
      });
      return true;
    });
    if (!mine) continue;
    claimed += 1;
    try {
      await deps.transport.send({ channel: "email", to: r.email, ...email });
      notified += 1;
    } catch (err) {
      await inFirm((tx) =>
        recordEvent(tx, {
          actorType: "system",
          action: "shift.escalation_failed",
          entityType: "shift",
          entityId: shiftId,
          data: { officeUserId: r.id, code: errorCode(err) },
        }),
      );
    }
  }
  // Already done by an earlier run (or another copy): nothing left to email.
  if (resumed && claimed === 0) return { status: "already" };
  return { status: "escalated", notified };
}

export function createOfferWaveTask(deps: () => OfferDeps): FirmTask<OfferWavePayload> {
  return {
    queue: OFFER_WAVE_QUEUE,
    schema: offerWavePayload,
    task: (payload, run) => runOfferWave(payload, run, deps()),
  };
}

export function createEscalateShiftTask(deps: () => OfferDeps): FirmTask<EscalateShiftPayload> {
  return {
    queue: ESCALATE_SHIFT_QUEUE,
    schema: escalateShiftPayload,
    task: (payload, run) => runEscalation(payload, run, deps()),
  };
}

// The worker's wiring. Deps are read when a job runs, so the web (which only queues) never needs
// the worker's configuration. Exported for its test (tests/unit/offers.worker-deps.test.ts).
export const offerWorkerDeps = (): OfferDeps => {
  const env = workerEnv();
  return {
    transport: getTransport(env),
    // The real web push sender is parked (an outside service): console or none until then.
    push: getPushTransport(env),
    baseDomain: env.APP_BASE_DOMAIN,
    clock: systemClock,
    // Loaded only here, in the worker: the web app, which queues waves, never loads the travel
    // service's code (tests/unit/travel.boundary.test.ts).
    travelBeforeFirstWave: async (run, firmId, shiftId) =>
      (await import("../travel/estimates")).estimatesBeforeWave(run, firmId, shiftId),
  };
};
export const offerWaveTask = createOfferWaveTask(offerWorkerDeps);
export const escalateShiftTask = createEscalateShiftTask(offerWorkerDeps);
