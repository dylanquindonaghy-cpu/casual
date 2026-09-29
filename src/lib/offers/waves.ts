import { and, eq, inArray, isNull, sql } from "drizzle-orm";
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
import type { FirmTx } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { defineFirmJob, firmJobEnvelope, sendFirmJob } from "../jobs/firm-job";
import { getTransport, type MessagingTransport } from "../messaging";
import { shiftEscalationEmail, shiftUrgentMessage, urgentPush } from "../messaging/templates";
import { shiftWhen } from "../portal/format";
import { forgetPushTarget, pushTargets } from "../push/subscriptions";
import { getPushTransport, type PushTransport } from "../push/transport";
import { parseAllocationSettings } from "../roster/allocation-input";
import { rankForFairRotation } from "../rules/allocation";
import { dayLabel } from "../rules/reasons";
import { hoursToStart } from "../rules/urgent";
import { portalUrl } from "../tenancy/portal-url";
import { signOffFor } from "../tenancy/sign-off";
import { addDays, localDateOf, wallTimeOf } from "../time/zoned";
import { waveCandidates, type WaveCandidate } from "./candidates";

// Offer waves and escalation (docs/api-and-jobs.md, "Job catalogue" and "Offer-wave ranking";
// docs/architecture.md, "Offer waves"). Two firm jobs:
//
// - offer-wave {shiftId, wave}: while the shift is open, not started and has a place free, send
//   the urgent offer to the next workers the rules allow (candidates.ts): under fair rotation the
//   firm's `wave_size` best by rankForFairRotation, then the next wave `wave_minutes` later; under
//   first come, first served everyone at once. Each offer is an `offers` row and an `offer.sent`
//   event; a wave already sent sends nothing (a retry, or a second chain after another dropout).
//   When there's no one left, or the shift filled, started or closed, the chain stops
//   (`offer.waves_stopped`); a filled shift's unanswered offers become "filled_elsewhere".
// - escalate-shift {shiftId}: at the start minus `escalate_hours_before_start` (default 3), if a
//   place is still free and the shift hasn't started, email the office's active admins and
//   resourcers once (`shift.escalated`, which the Today view reads as "needs attention").
//
// startOfferWaves() queues both, in the transaction that caused them (a place reopened inside the
// urgent window, or the office marking the shift urgent: src/lib/roster/urgent.ts).
// Messages go through the configured transport (console in development and tests); each offer is
// also pushed to the worker's subscribed phones (PUSH_TRANSPORT: console or none until the real
// sender is connected). Quiet hours, the daily cap and the SMS fallback are later Phase 4 tasks.

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

// Who this wave goes to (pure): fair rotation's order, the firm's wave size; first come, first
// served: everyone.
export function pickWave<C extends WaveCandidate>(
  candidates: C[],
  mode: "first_come_first_served" | "fair_rotation",
  waveSize: number,
): C[] {
  if (mode === "first_come_first_served") return [...candidates];
  return rankForFairRotation(candidates).slice(0, waveSize);
}

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));
const HOUR = 3_600_000;

const jobs = {
  wave: { queue: OFFER_WAVE_QUEUE, schema: offerWavePayload },
  escalate: { queue: ESCALATE_SHIFT_QUEUE, schema: escalateShiftPayload },
};

// Queues the next wave now, and the escalation check for the start minus the firm's hours (at
// once if that time has passed). Inside the caller's withFirm transaction.
export async function startOfferWaves(
  tx: FirmTx,
  input: { shiftId: string; now: Date },
): Promise<void> {
  const [shift] = await tx
    .select({ startsAt: shifts.startsAt, settings: firms.settings })
    .from(shifts)
    .innerJoin(firms, eq(firms.id, shifts.firmId))
    .where(eq(shifts.id, input.shiftId));
  if (!shift) return;
  const { rows } = await tx.execute<{ next: number }>(
    sql`select coalesce(max(wave), 0)::int + 1 as next from offers where shift_id = ${input.shiftId}`,
  );
  const wave = rows[0]?.next ?? 1;
  await sendFirmJob(tx, jobs.wave, {
    idempotencyKey: `offer-wave:${input.shiftId}:${wave}`,
    shiftId: input.shiftId,
    wave,
  });
  const escalateAt = new Date(shift.startsAt.getTime() - escalateHours(shift.settings) * HOUR);
  await sendFirmJob(
    tx,
    jobs.escalate,
    { idempotencyKey: `escalate-shift:${input.shiftId}`, shiftId: input.shiftId },
    escalateAt.getTime() > input.now.getTime() ? { startAfter: escalateAt } : undefined,
  );
}

export interface OfferDeps {
  transport: MessagingTransport;
  push: PushTransport;
  baseDomain: string;
  clock: Clock;
}

interface LockedShift {
  id: string;
  firmId: string;
  role: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  isUrgent: boolean;
  siteName: string | null;
  freePlaces: number;
}

// The shift, locked (the same shift-first order as booking), with its places still free.
async function lockShift(tx: FirmTx, shiftId: string): Promise<LockedShift | null> {
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
  return { ...row, freePlaces: Math.max(0, row.headcount - (rows[0]?.taken ?? 0)) };
}

async function firmVoice(tx: FirmTx, firmId: string) {
  const [firm] = await tx
    .select({
      name: firms.name,
      slug: firms.slug,
      timezone: firms.timezone,
      settings: firms.settings,
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
const timeOf = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};
// "today", "tomorrow" or "on Sat 7 Nov", in the firm's time zone.
export function dayWords(startsAt: Date, now: Date, timeZone: string): string {
  const day = localDateOf(startsAt, timeZone);
  const today = localDateOf(now, timeZone);
  if (day === today) return "today";
  if (day === addDays(today, 1)) return "tomorrow";
  return `on ${dayLabel(day)}`;
}

export type WaveResult =
  | { status: "sent"; sent: number; next: number | null }
  | { status: "already_sent" }
  | {
      status: "stopped";
      reason: "filled" | "started" | "not_open" | "not_urgent" | "no_candidates" | "gone";
    };

export async function runOfferWave(
  payload: OfferWavePayload,
  tx: FirmTx,
  deps: OfferDeps,
): Promise<WaveResult> {
  const now = deps.clock.now();
  const shift = await lockShift(tx, payload.shiftId);
  if (!shift) return { status: "stopped", reason: "gone" };
  const [sent] = await tx
    .select({ id: offers.id })
    .from(offers)
    .where(and(eq(offers.shiftId, shift.id), eq(offers.wave, payload.wave)))
    .limit(1);
  if (sent) return { status: "already_sent" };

  const stop = async (
    reason: "filled" | "started" | "not_open" | "not_urgent" | "no_candidates",
  ) => {
    if (reason === "filled") {
      // Offered workers who ended up with a place (the office placed them, or the sheet named
      // them) took it; everyone else's offer was filled by someone else.
      const holders = sql`(select a.worker_id from assignments a
        where a.shift_id = ${shift.id} and a.worker_id is not null and a.status not in (${CANCELLED}))`;
      await tx
        .update(offers)
        .set({ response: "accepted", respondedAt: now })
        .where(
          and(
            eq(offers.shiftId, shift.id),
            isNull(offers.response),
            sql`${offers.workerId} in ${holders}`,
          ),
        );
      await tx
        .update(offers)
        .set({ response: "filled_elsewhere", respondedAt: now })
        .where(and(eq(offers.shiftId, shift.id), isNull(offers.response)));
    }
    await recordEvent(tx, {
      actorType: "system",
      action: "offer.waves_stopped",
      entityType: "shift",
      entityId: shift.id,
      data: { reason, wave: payload.wave },
    });
    return { status: "stopped" as const, reason };
  };
  if (shift.startsAt.getTime() <= now.getTime()) return stop("started");
  if (shift.status !== "open" && shift.status !== "filled") return stop("not_open");
  if (shift.freePlaces === 0) return stop("filled");
  // The office cleared the urgent mark: no more urgent offers.
  if (!shift.isUrgent) return stop("not_urgent");

  const firm = await firmVoice(tx, shift.firmId);
  const settings = parseAllocationSettings(firm.settings);
  const candidates = await waveCandidates(
    tx,
    { id: shift.id, role: shift.role, startsAt: shift.startsAt, timeZone: firm.timezone },
    now,
  );
  const chosen = pickWave(
    candidates,
    settings.mode,
    settings.mode === "fair_rotation" ? settings.groupSize : candidates.length,
  );
  if (chosen.length === 0) return stop("no_candidates");

  const link = `${portalUrl(firm.slug, deps.baseDomain)}/shifts/${shift.id}`;
  const body = shiftUrgentMessage(firm.voice, {
    role: shift.role,
    site: shift.siteName,
    day: dayWords(shift.startsAt, now, firm.timezone),
    start: timeOf(shift.startsAt, firm.timezone),
    end: timeOf(shift.endsAt, firm.timezone),
    link,
  });
  // Every offer row first, then the messages: if the transaction is going to fail (a lock
  // conflict, say), it fails before anyone has been messaged.
  const recorded: { offerId: string; candidate: WaveCandidate }[] = [];
  for (const c of chosen) {
    const [offer] = await tx
      .insert(offers)
      .values({
        firmId: shift.firmId,
        shiftId: shift.id,
        workerId: c.workerId,
        wave: payload.wave,
        channel: c.channel,
        sentAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: offers.id });
    if (offer) recorded.push({ offerId: offer.id, candidate: c });
  }
  const pushed = urgentPush({
    role: shift.role,
    site: shift.siteName,
    day: dayWords(shift.startsAt, now, firm.timezone),
    start: timeOf(shift.startsAt, firm.timezone),
  });
  for (const { offerId, candidate: c } of recorded) {
    const result = await deps.transport.send({ channel: c.channel, to: c.mobile, body });
    // Push as well, to each phone the worker turned notifications on for (free; the docs send
    // urgent offers by push and WhatsApp). One the push service says is gone is forgotten.
    let pushes = 0;
    for (const target of await pushTargets(tx, c.workerId)) {
      // The path only: the service worker opens it on whichever address the phone subscribed on
      // (a firm's custom domain included).
      const sent = await deps.push.send(target, { ...pushed, url: `/shifts/${shift.id}` });
      if (sent.status === "gone") {
        await forgetPushTarget(tx, target.id);
        await recordEvent(tx, {
          actorType: "system",
          action: "push.forgotten",
          entityType: "push_subscription",
          entityId: target.id,
          data: { reason: "gone" },
        });
      } else if (sent.status === "sent") pushes += 1;
    }
    await recordEvent(tx, {
      actorType: "system",
      action: "offer.sent",
      entityType: "offer",
      entityId: offerId,
      data: {
        shiftId: shift.id,
        workerId: c.workerId,
        wave: payload.wave,
        channel: c.channel,
        providerMessageId: result.providerMessageId,
        pushes,
      },
    });
  }
  const count = recorded.length;

  // Fair rotation: the next wave after the firm's minutes. First come, first served: everyone
  // eligible has it already.
  let next: number | null = null;
  if (settings.mode === "fair_rotation" && candidates.length > chosen.length) {
    next = payload.wave + 1;
    await sendFirmJob(
      tx,
      jobs.wave,
      { idempotencyKey: `offer-wave:${shift.id}:${next}`, shiftId: shift.id, wave: next },
      { startAfter: new Date(now.getTime() + settings.priorityMinutes * 60_000) },
    );
  }
  return { status: "sent", sent: count, next };
}

export type EscalateResult =
  { status: "escalated"; notified: number } | { status: "not_needed" } | { status: "already" };

export async function runEscalation(
  payload: EscalateShiftPayload,
  tx: FirmTx,
  deps: OfferDeps,
): Promise<EscalateResult> {
  const now = deps.clock.now();
  const shift = await lockShift(tx, payload.shiftId);
  if (
    !shift ||
    !shift.isUrgent ||
    shift.freePlaces === 0 ||
    (shift.status !== "open" && shift.status !== "filled") ||
    shift.startsAt.getTime() <= now.getTime()
  ) {
    return { status: "not_needed" };
  }
  const [done] = await tx
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.action, "shift.escalated"), eq(events.entityId, shift.id)))
    .limit(1);
  if (done) return { status: "already" };

  const firm = await firmVoice(tx, shift.firmId);
  const recipients = await tx
    .select({ email: officeUsers.email })
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
  for (const r of recipients) {
    await deps.transport.send({ channel: "email", to: r.email, ...email });
  }
  await recordEvent(tx, {
    actorType: "system",
    action: "shift.escalated",
    entityType: "shift",
    entityId: shift.id,
    data: {
      freePlaces: shift.freePlaces,
      offersSent,
      notified: recipients.length, // office users told ("email" keys are refused in events)
      hoursToStart: hoursToStart(shift.startsAt, now),
    },
  });
  return { status: "escalated", notified: recipients.length };
}

export function createOfferWaveJob(deps: () => OfferDeps) {
  return defineFirmJob({
    queue: OFFER_WAVE_QUEUE,
    schema: offerWavePayload,
    handler: (payload, tx) => runOfferWave(payload, tx, deps()),
  });
}

export function createEscalateShiftJob(deps: () => OfferDeps) {
  return defineFirmJob({
    queue: ESCALATE_SHIFT_QUEUE,
    schema: escalateShiftPayload,
    handler: (payload, tx) => runEscalation(payload, tx, deps()),
  });
}

// The worker's wiring. Deps are read when a job runs, so the web (which only queues) never needs
// the worker's configuration.
const workerDeps = (): OfferDeps => {
  const env = workerEnv();
  return {
    transport: getTransport(env),
    // The real web push sender is parked (an outside service): console or none until then.
    push: getPushTransport(env),
    baseDomain: env.APP_BASE_DOMAIN,
    clock: systemClock,
  };
};
export const offerWaveJob = createOfferWaveJob(workerDeps);
export const escalateShiftJob = createEscalateShiftJob(workerDeps);
