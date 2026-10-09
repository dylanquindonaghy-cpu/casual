import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { offers, shifts, workers } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { noticeHours } from "../roster/notice";
import { recordEvent } from "../events/record";
import { firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { getTransport } from "../messaging";
import {
  offerPush,
  shiftOfferMessage,
  shiftOfferSms,
  shiftUrgentMessage,
  shiftUrgentSms,
  urgentPush,
} from "../messaging/templates";
import { pushToWorker, sendToWorker } from "../notify/send";
import { dayWords } from "../portal/format";
import { getPushTransport } from "../push/transport";
import { officeCanPlace } from "../roster/book";
import { isVisibleToCasuals } from "../roster/visibility";
import { dayLabel } from "../rules/reasons";
import { mayMessageNow, quietHours } from "../rules/quiet-hours";
import { portalUrl } from "../tenancy/portal-url";
import { localDateOf } from "../time/zoned";
import { lockOfferCounts, waveCandidates, type WaveCandidate } from "./candidates";
import { lockReachableWorkers } from "./reachable";
import { lockOfferOutcome, logUnconfirmedOffers } from "./unconfirmed";
import { firmVoice, lockShift, timeOf, type OfferDeps } from "./waves";

// The office offering a shift to one worker ("Offer to someone" on Today, docs/screens.md). The
// same checks as every offer: the worker must be on the shift's candidate list (waveCandidates:
// the booking rules, offer messages on, never offered it, the daily cap unless the shift is
// urgent). The office chooses who, never whether the rules allow it (that's "manual assign"). A
// casual's travel area doesn't limit it (`byHand`; D2): the office may offer outside it.
//
// - queueOfficeOffer (a server action calls it): an active admin or resourcer, an open shift that
//   hasn't started and is shown to casuals (an offer shows the shift to the worker, and taking it
//   would be refused: src/lib/roster/visibility.ts), a worker on the candidate list now. Queues the office-offer job in the same
//   transaction and logs offer.office_queued {shiftId, workerId}.
// - The office-offer job, under the shift lock (the same order as booking): checks it all again,
//   holds for quiet hours unless the shift is urgent and the firm lets urgent through, writes the
//   offer (`offered_by`, no wave: one per worker per shift) and sends shift_offer, or shift_urgent
//   for an urgent shift, through the shared sender (src/lib/notify/send.ts). Logged offer.sent
//   {offeredBy, ...}, offer.send_failed, offer.office_held or offer.office_not_sent {reason}.

export const OFFICE_OFFER_QUEUE = "office-offer";

export const officeOfferPayload = firmJobEnvelope.extend({
  shiftId: z.uuid(),
  workerId: z.uuid(),
  officeUserId: z.uuid(),
});
export type OfficeOfferPayload = z.infer<typeof officeOfferPayload>;

const job = { queue: OFFICE_OFFER_QUEUE, schema: officeOfferPayload };
const uuid = z.uuid();

// Who the office could offer a shift to now: the candidate list, with names, in fair-rotation
// data order (fewest hours this week first). Reads only.
export interface OfficeCandidate extends WaveCandidate {
  name: string;
}

export async function officeOfferCandidates(
  tx: FirmTx,
  shiftId: string,
  now: Date,
): Promise<OfficeCandidate[]> {
  // An office offer that failed to send leaves the worker on the candidate list (a wave may try
  // again), but the office can't send them a second one: it may have arrived.
  const officeOffered = new Set(
    (
      await tx
        .select({ workerId: offers.workerId })
        .from(offers)
        .where(and(eq(offers.shiftId, shiftId), isNull(offers.wave)))
    ).map((o) => o.workerId),
  );
  const candidates = (await waveCandidates(tx, shiftId, now, { byHand: true })).filter(
    (c) => !officeOffered.has(c.workerId),
  );
  if (candidates.length === 0) return [];
  const names = await tx
    .select({ id: workers.id, first: workers.firstName, last: workers.lastName })
    .from(workers)
    .where(
      inArray(
        workers.id,
        candidates.map((c) => c.workerId),
      ),
    );
  const nameOf = new Map(names.map((n) => [n.id, `${n.first} ${n.last}`]));
  return candidates
    .map((c) => ({ ...c, name: nameOf.get(c.workerId) ?? "" }))
    .sort((a, b) => a.hoursThisWeek - b.hoursThisWeek || a.name.localeCompare(b.name));
}

export const officeOfferRequestSchema = z.strictObject({
  shiftId: z.string(),
  workerId: z.string(),
  by: z.strictObject({ type: z.literal("office"), id: z.uuid() }),
});

export type QueueOfficeOfferResult =
  | { status: "queued" }
  | { status: "already_offered" }
  | { status: "failed_before" } // the office's earlier offer to them couldn't be sent
  | { status: "not_candidate" } // the rules, their settings or the daily cap leave them out
  | { status: "not_open" } // filled, closed, cancelled, a draft, or started
  | { status: "hidden" } // hidden from casuals (the session's switch or its event's)
  | { status: "not_found" }
  | { status: "not_allowed" };

// A non-failed offer of this shift to this worker already exists (a wave's or the office's).
async function offeredBefore(tx: FirmTx, shiftId: string, workerId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: offers.id })
    .from(offers)
    .where(
      and(
        eq(offers.shiftId, shiftId),
        eq(offers.workerId, workerId),
        or(isNull(offers.response), ne(offers.response, "failed")),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function queueOfficeOffer(
  run: WithFirm,
  firmId: string,
  raw: z.input<typeof officeOfferRequestSchema>,
  deps: { clock?: Clock } = {},
): Promise<QueueOfficeOfferResult> {
  const request = officeOfferRequestSchema.parse(raw);
  if (!uuid.safeParse(request.shiftId).success || !uuid.safeParse(request.workerId).success) {
    return { status: "not_found" };
  }
  const now = (deps.clock ?? systemClock).now();
  return run(firmId, async (tx) => {
    if (!(await officeCanPlace(tx, request.by.id))) return { status: "not_allowed" };
    const [shift] = await tx
      .select({ status: shifts.status, startsAt: shifts.startsAt })
      .from(shifts)
      .where(eq(shifts.id, request.shiftId));
    if (!shift) return { status: "not_found" };
    if (shift.status !== "open" || shift.startsAt.getTime() <= now.getTime()) {
      return { status: "not_open" };
    }
    if (!(await isVisibleToCasuals(tx, request.shiftId))) return { status: "hidden" };
    // One office offer per worker per shift, even one that failed (it may have arrived).
    const [byOffice] = await tx
      .select({ response: offers.response })
      .from(offers)
      .where(
        and(
          eq(offers.shiftId, request.shiftId),
          eq(offers.workerId, request.workerId),
          isNull(offers.wave),
        ),
      )
      .limit(1);
    if (byOffice) {
      return { status: byOffice.response === "failed" ? "failed_before" : "already_offered" };
    }
    if (await offeredBefore(tx, request.shiftId, request.workerId)) {
      return { status: "already_offered" };
    }
    const candidates = await waveCandidates(tx, request.shiftId, now, {
      only: [request.workerId],
      byHand: true,
    });
    if (!candidates.some((c) => c.workerId === request.workerId)) {
      return { status: "not_candidate" };
    }
    await sendFirmJob(tx, job, {
      idempotencyKey: `office-offer:${request.shiftId}:${request.workerId}`,
      shiftId: request.shiftId,
      workerId: request.workerId,
      officeUserId: request.by.id,
    });
    await recordEvent(tx, {
      actorType: "office",
      actorId: request.by.id,
      action: "offer.office_queued",
      entityType: "shift",
      entityId: request.shiftId,
      data: { shiftId: request.shiftId, workerId: request.workerId },
    });
    return { status: "queued" };
  });
}

export type OfficeOfferResult =
  | { status: "sent"; channel: "whatsapp" | "sms" }
  | { status: "failed" }
  | { status: "held"; until: Date }
  | { status: "already" }
  | {
      status: "not_sent";
      reason: NotSentReason;
    };

type NotSentReason =
  "gone" | "started" | "not_open" | "filled" | "hidden" | "not_candidate" | "not_allowed";

type OfficeClaim =
  | { done: OfficeOfferResult }
  | {
      offerId: string;
      shiftId: string;
      startsAt: Date;
      candidate: OfficeCandidate | WaveCandidate;
      line: string | null;
      body: { whatsapp: string; sms: string };
      push: { title: string; body: string };
    };

// (1) The claim, under the shift's lock: every check, then the offer row, committed before the
// message goes.
async function claimOfficeOffer(
  payload: OfficeOfferPayload,
  tx: FirmTx,
  deps: OfferDeps,
  now: Date,
): Promise<OfficeClaim> {
  const shift = await lockShift(tx, payload.shiftId);
  const notSent = async (reason: NotSentReason) => {
    if (shift) {
      await recordEvent(tx, {
        actorType: "system",
        action: "offer.office_not_sent",
        entityType: "shift",
        entityId: shift.id,
        data: { workerId: payload.workerId, reason },
      });
    }
    return { done: { status: "not_sent" as const, reason } };
  };
  if (!shift) return notSent("gone");
  const [existing] = await tx
    .select({ id: offers.id, response: offers.response })
    .from(offers)
    .where(
      and(eq(offers.shiftId, shift.id), eq(offers.workerId, payload.workerId), isNull(offers.wave)),
    )
    .limit(1);
  if (existing) {
    // Claimed by an earlier run that stopped before logging what happened: it may have gone, so
    // it's logged now as sent, unconfirmed (src/lib/offers/unconfirmed.ts), never sent again.
    if (await logUnconfirmedOffers(tx, shift, { offerId: existing.id })) {
      return { done: { status: "already" } };
    }
    await recordEvent(tx, {
      actorType: "system",
      action: "offer.office_not_sent",
      entityType: "shift",
      entityId: shift.id,
      // failed_before: the office's offer couldn't be sent (never sent again); duplicate: another
      // copy of this job already sent it.
      data: {
        workerId: payload.workerId,
        reason: existing.response === "failed" ? "failed_before" : "duplicate",
      },
    });
    return { done: { status: "already" } };
  }
  if (!(await officeCanPlace(tx, payload.officeUserId))) return notSent("not_allowed");
  if (shift.startsAt.getTime() <= now.getTime()) return notSent("started");
  if (shift.status === "filled" || shift.freePlaces === 0) return notSent("filled");
  if (shift.status !== "open") return notSent("not_open");
  // Hidden from casuals since it was queued (the office can still assign someone).
  if (!shift.showing) return notSent("hidden");
  // Counted under the worker's offer-count lock, so an offer sent at the same moment (the
  // office's, or a wave's) is counted too: the daily cap holds (candidates.ts).
  await lockOfferCounts(tx, [payload.workerId]);
  const candidate = (
    await waveCandidates(tx, shift.id, now, { only: [payload.workerId], byHand: true })
  ).find((c) => c.workerId === payload.workerId);
  if (!candidate) return notSent("not_candidate");

  const firm = await firmVoice(tx, shift.firmId);
  // Quiet hours: an offer that isn't urgent waits for them to end; an urgent one goes if the firm
  // lets urgent through. (Within a minute of the end it just goes, as with waves.)
  const timing = mayMessageNow({
    now,
    timeZone: firm.timezone,
    quiet: quietHours(firm.settings),
    urgent: shift.isUrgent,
  });
  if (!timing.ok && timing.until.getTime() - now.getTime() > 60_000) {
    if (!payload.idempotencyKey.endsWith(":after-quiet")) {
      await sendFirmJob(
        tx,
        job,
        { ...payload, idempotencyKey: `${payload.idempotencyKey}:after-quiet` },
        { startAfter: timing.until },
      );
    }
    await recordEvent(tx, {
      actorType: "system",
      action: "offer.office_held",
      entityType: "shift",
      entityId: shift.id,
      data: {
        workerId: payload.workerId,
        until: timing.until.toISOString(),
        reason: "quiet_hours",
      },
    });
    return { done: { status: "held", until: timing.until } };
  }

  // Erased or made inactive since the list was read: no offer.
  if (!(await lockReachableWorkers(tx, [payload.workerId])).has(payload.workerId)) {
    return notSent("not_candidate");
  }
  const [offer] = await tx
    .insert(offers)
    .values({
      firmId: shift.firmId,
      shiftId: shift.id,
      workerId: payload.workerId,
      offeredBy: payload.officeUserId,
      channel: candidate.channel,
      sentAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: offers.id });
  if (!offer) return { done: { status: "already" } };

  const link = `${portalUrl(firm.slug, deps.baseDomain)}/shifts/${shift.id}`;
  const start = timeOf(shift.startsAt, firm.timezone);
  const end = timeOf(shift.endsAt, firm.timezone);
  const site = shift.siteName;
  let body: { whatsapp: string; sms: string };
  let push: { title: string; body: string };
  if (shift.isUrgent) {
    const day = dayWords(shift.startsAt, now, firm.timezone);
    body = {
      whatsapp: shiftUrgentMessage(firm.voice, { role: shift.role, site, day, start, end, link }),
      sms: shiftUrgentSms(firm.voice, { role: shift.role, site, day, start, link }),
    };
    push = urgentPush({ role: shift.role, site, day, start });
  } else {
    const date = dayLabel(localDateOf(shift.startsAt, firm.timezone));
    body = {
      whatsapp: shiftOfferMessage(firm.voice, { role: shift.role, site, date, start, end, link }),
      sms: shiftOfferSms(firm.voice, { site, date, start, link }),
    };
    push = offerPush({ site, date, start });
  }
  return {
    offerId: offer.id,
    shiftId: shift.id,
    startsAt: shift.startsAt,
    candidate,
    line: firm.line,
    body,
    push,
  };
}

// At most once, like the waves (a firm task, never a transaction held across a message): (1) the
// claim above; (2) the message by the worker's channel, outside any transaction; (3) a short
// transaction records it: the push, then offer.sent, or the offer marked failed and
// offer.send_failed. A retried job finds the offer and sends nothing (offer.office_not_sent
// {duplicate}).
export async function runOfficeOffer(
  payload: OfficeOfferPayload,
  run: WithFirm,
  deps: OfferDeps,
): Promise<OfficeOfferResult> {
  const now = deps.clock.now();
  const inFirm = <T>(fn: (tx: FirmTx) => Promise<T>) => run(payload.firmId, fn);
  const claim = await inFirm((tx) => claimOfficeOffer(payload, tx, deps, now));
  if ("done" in claim) return claim.done;

  // (2) The message, outside any transaction.
  const candidate = claim.candidate;
  const sent = await sendToWorker(deps, {
    mobile: candidate.mobile,
    channel: candidate.channel,
    smsAllowed: candidate.smsAllowed,
    body: claim.body,
    from: claim.line,
  });

  // (3) The outcome.
  return inFirm(async (tx): Promise<OfficeOfferResult> => {
    if (!sent.ok) {
      // Marked failed, unless the worker answered it while it was going out; a close because the
      // shift filled meanwhile is overwritten (this message never arrived).
      await tx
        .update(offers)
        .set({ channel: sent.channel, response: "failed", respondedAt: now })
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
        entityId: claim.shiftId,
        data: {
          offerId: claim.offerId,
          workerId: payload.workerId,
          offeredBy: payload.officeUserId,
          channel: sent.channel,
          code: sent.code,
        },
      });
      return { status: "failed" };
    }
    // The push once the message has gone.
    const pushes = await pushToWorker(tx, deps, payload.workerId, {
      ...claim.push,
      url: `/shifts/${claim.shiftId}`,
    });
    if (sent.fellBackFrom) {
      await tx.update(offers).set({ channel: sent.channel }).where(eq(offers.id, claim.offerId));
    }
    // Logged once: a rerun may have caught it up already, as unconfirmed.
    if (await lockOfferOutcome(tx, claim.offerId)) return { status: "sent", channel: sent.channel };
    await recordEvent(tx, {
      actorType: "system",
      action: "offer.sent",
      entityType: "offer",
      entityId: claim.offerId,
      data: {
        shiftId: claim.shiftId,
        workerId: payload.workerId,
        offeredBy: payload.officeUserId,
        // The notice they had of the shift (the notice report counts from this, not a later start).
        noticeHours: noticeHours(claim.startsAt, now),
        channel: sent.channel,
        providerMessageId: sent.providerMessageId,
        pushes,
        ...(sent.fellBackFrom ? { fellBackFrom: sent.fellBackFrom } : {}),
      },
    });
    return { status: "sent", channel: sent.channel };
  });
}

export function createOfficeOfferTask(deps: () => OfferDeps): FirmTask<OfficeOfferPayload> {
  return {
    queue: OFFICE_OFFER_QUEUE,
    schema: officeOfferPayload,
    task: (payload, run) => runOfficeOffer(payload, run, deps()),
  };
}

// The worker's wiring (deps read when a job runs).
const workerDeps = (): OfferDeps => {
  const env = workerEnv();
  return {
    transport: getTransport(env),
    push: getPushTransport(env),
    baseDomain: env.APP_BASE_DOMAIN,
    clock: systemClock,
  };
};
export const officeOfferTask = createOfficeOfferTask(workerDeps);
