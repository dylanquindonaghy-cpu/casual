import { createHash } from "node:crypto";
import { and, inArray, isNull, sql } from "drizzle-orm";
import { recordEvent } from "../../events/record";
import { noAi } from "../../ai/client";
import { runInboundMessage } from "../../inbound/reply";
import type { MessagingTransport } from "../../messaging/transport";
import { groupFactsFor, payGroupKey } from "../../pay/grouping";
import { TRAVEL_NOTICE_VERSION } from "../../portal/travel";
import { automaticEventId } from "../../roster/shift-events";
import { hoursToStart } from "../../rules/urgent";
import { strikeSettings } from "../../strikes/settings";
import { STRIKE_WARNING_VERSION } from "../../strikes/words";
import { fakePoint } from "../../travel/geocoder";
import {
  assignments,
  credentials,
  messages,
  payQueries,
  payRecords,
  shiftEvents,
  shifts,
  sites,
  strikes,
  travelEstimates,
  uploads,
  workers,
  workerTravel,
} from "../schema";
import type { FirmTx, WithFirm } from "../scoped";
import type { SeedFirm } from "./seed-data";
import {
  STORY_CERTIFICATE_JPEG,
  STORY_LINE,
  STORY_PHOTO_JPEG,
  STRIKES_TEAM,
  type StorySeed,
} from "./seed-story";

// Loading the demo's story (seed-story.ts; 12I.1) inside Acme's transaction, as the app role. The
// people, their qualifications and travel areas are put back as seeded on every run (like the
// generated workers); everything that happened (events, sessions, bookings, cancellations, strikes,
// uploads, messages, pay queries) is added once by its fixed id and logged once, as the app logs
// it, so a re-run changes nothing and never undoes a demo. Row times are the story's (the log can't
// be backdated: its entries say what happened, stamped when the seed ran).

const located = (postcode: string) => {
  const point = fakePoint(postcode);
  return { lat: point ? String(point.lat) : null, lng: point ? String(point.lng) : null };
};
// A start postcode's point: always known for the story's made-up ZZ postcodes.
const pointOf = (postcode: string) => {
  const point = fakePoint(postcode);
  if (!point) throw new Error(`no fake point for ${postcode}`);
  return { lat: String(point.lat), lng: String(point.lng) };
};
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

export async function loadStory(
  tx: FirmTx,
  firm: SeedFirm,
  story: StorySeed,
  now: Date,
): Promise<void> {
  const firmId = firm.id;
  const strikeRules = strikeSettings(firm.settings);
  const resourcer = officeId(firm, "resourcer");
  const payroll = officeId(firm, "payroll");

  // The response team lead's rule (the firm's own: no pack has the role).
  for (const rule of story.rules) {
    await tx.execute(sql`
      insert into credential_rules (firm_id, sector, role, required_types)
      values (app_current_firm_id(), ${firm.sector}, ${rule.role}, ${sql.param(rule.requiredTypes)}::text[])
      on conflict (firm_id, role) do nothing`);
  }

  await tx
    .insert(sites)
    .values(story.sites.map((s) => ({ ...s, ...located(s.postcode), firmId })))
    .onConflictDoUpdate({
      target: sites.id,
      set: {
        name: sql`excluded.name`,
        town: sql`excluded.town`,
        postcode: sql`excluded.postcode`,
        lat: sql`excluded.lat`,
        lng: sql`excluded.lng`,
      },
    });

  await tx
    .insert(workers)
    .values(
      story.workers.map((w) => ({
        id: w.id,
        firmId,
        firstName: w.firstName,
        lastName: w.lastName,
        mobileE164: w.mobileE164,
        email: w.email,
        roles: w.roles,
      })),
    )
    .onConflictDoUpdate({
      target: workers.id,
      set: {
        firstName: sql`excluded.first_name`,
        lastName: sql`excluded.last_name`,
        mobileE164: sql`excluded.mobile_e164`,
        email: sql`excluded.email`,
        roles: sql`excluded.roles`,
        status: sql`'active'`,
      },
    });

  // Uploads before the records that point at them. Added once: the office's check of one is the
  // demo's to do (Ben's photo, Leah's new licence).
  const office = (u: StorySeed["uploads"][number]) =>
    u.status === "approved" ? { checkedBy: resourcer, checkedAt: u.checkedAt } : {};
  const addedUploads = await tx
    .insert(uploads)
    .values(
      story.uploads.map((u) => {
        const data = u.kind === "photo" ? STORY_PHOTO_JPEG : STORY_CERTIFICATE_JPEG;
        return {
          id: u.id,
          firmId,
          workerId: u.workerId,
          kind: u.kind,
          credentialType: u.credentialType,
          contentType: "image/jpeg",
          size: data.length,
          sha256: sha256(data),
          data,
          status: u.status,
          ...office(u),
          createdAt: u.createdAt,
        };
      }),
    )
    .onConflictDoNothing()
    .returning({ id: uploads.id });
  // Each sent by the casual, and the office's check of the approved ones, as the app logs them.
  const freshUploads = new Set(addedUploads.map((u) => u.id));
  for (const u of story.uploads.filter((x) => freshUploads.has(x.id))) {
    const what = {
      workerId: u.workerId,
      kind: u.kind,
      ...(u.credentialType ? { qualificationType: u.credentialType } : {}),
    };
    await recordEvent(tx, {
      actorType: "worker",
      actorId: u.workerId,
      action: "upload.received",
      entityType: "upload",
      entityId: u.id,
      data: what,
    });
    if (u.status === "approved") {
      await recordEvent(tx, {
        actorType: "office",
        actorId: resourcer,
        action: "upload.approved",
        entityType: "upload",
        entityId: u.id,
        data: what,
      });
    }
  }

  // Qualifications: put back as seeded. Her renewal waiting is only added (the office's check is
  // the demo's).
  const checked = story.credentials.filter((c) => c.checkState === "verified");
  await tx
    .insert(credentials)
    .values(
      checked.map((c) => ({
        id: c.id,
        firmId,
        workerId: c.workerId,
        type: c.type,
        number: c.number,
        expiresOn: c.expiresOn,
        status: c.status,
      })),
    )
    .onConflictDoUpdate({
      target: credentials.id,
      set: {
        type: sql`excluded.type`,
        number: sql`excluded.number`,
        expiresOn: sql`excluded.expires_on`,
        status: sql`excluded.status`,
        checkState: sql`'verified'`,
        verifiedAt: sql`null`,
        verifiedBy: sql`null`,
      },
    });
  const waiting = story.credentials.filter((c) => c.checkState === "waiting");
  if (waiting.length > 0) {
    await tx
      .insert(credentials)
      .values(
        waiting.map((c) => ({
          id: c.id,
          firmId,
          workerId: c.workerId,
          type: c.type,
          number: c.number,
          expiresOn: c.expiresOn,
          status: c.status,
          checkState: c.checkState,
          evidenceUploadId: c.uploadId,
        })),
      )
      .onConflictDoNothing();
  }

  // Travel areas: put back as seeded.
  for (const w of story.workers) {
    const area = {
      startPostcode: w.travel.startPostcode,
      ...pointOf(w.travel.startPostcode),
      modes: w.travel.modes,
      maxMinutes: w.travel.maxMinutes,
    };
    await tx
      .insert(workerTravel)
      .values({
        firmId,
        workerId: w.id,
        ...area,
        privacyNoticeVersion: TRAVEL_NOTICE_VERSION,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [workerTravel.firmId, workerTravel.workerId],
        set: area,
      });
  }

  // The six events, added once (a demo's switch stays as the demo left it).
  const addedEvents = await tx
    .insert(shiftEvents)
    .values(
      story.events.map((e) => ({
        id: e.id,
        firmId,
        name: e.name,
        siteId: e.siteId,
        source: "native" as const,
        showingToCasuals: e.showing,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: shiftEvents.id, showing: shiftEvents.showingToCasuals });
  // One switched off: the office's switch, logged as the app logs it.
  for (const e of addedEvents.filter((x) => !x.showing)) {
    await recordEvent(tx, {
      actorType: "office",
      actorId: resourcer,
      action: "event.hidden",
      entityType: "shift_event",
      entityId: e.id,
      data: { by: "firm" },
    });
  }

  // Sessions: added once. One whose booking was cancelled has its place open again.
  const reopened = new Set(story.bookings.filter((b) => b.reopenedId).map((b) => b.shiftId));
  const there = new Set(
    (
      await tx
        .select({ id: shifts.id })
        .from(shifts)
        .where(
          inArray(
            shifts.id,
            story.sessions.map((x) => x.id),
          ),
        )
    ).map((x) => x.id),
  );
  const rows = [];
  // Only the sessions not there yet: a later day's re-run makes no empty automatic events.
  for (const s of story.sessions.filter((x) => !there.has(x.id))) {
    rows.push({
      id: s.id,
      firmId,
      shiftEventId:
        s.eventId ??
        (await automaticEventId(tx, {
          siteId: s.siteId,
          startsAt: s.startsAt,
          source: "native",
          timeZone: "Europe/London",
        })),
      siteId: s.siteId,
      role: s.role,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      headcount: s.headcount,
      status: reopened.has(s.id) ? ("open" as const) : s.status,
      source: "native" as const,
      isUrgent: s.isUrgent,
      payRatePence: s.payRatePence,
      post: s.post,
      meetingPoint: s.meetingPoint,
      uniform: s.uniform,
      requiredCredentials: s.requiredCredentials,
      createdAt: s.createdAt,
    });
  }
  const added =
    rows.length > 0
      ? await tx.insert(shifts).values(rows).onConflictDoNothing().returning({ id: shifts.id })
      : [];
  const fresh = new Set(added.map((s) => s.id));
  for (const s of story.sessions.filter((x) => fresh.has(x.id))) {
    await recordEvent(tx, {
      actorType: "system",
      action: "shift.created",
      entityType: "shift",
      entityId: s.id,
      data: { source: "seed" },
    });
    // Marked urgent by the office (as src/lib/roster/urgent.ts logs it); one made urgent by a
    // dropout is logged with its cancellation, below.
    if (s.urgentCause === "office") {
      await recordEvent(tx, {
        actorType: "office",
        actorId: resourcer,
        action: "shift.marked_urgent",
        entityType: "shift",
        entityId: s.id,
        data: { by: "firm", cause: "office", hoursToStart: hoursToStart(s.startsAt, now) },
      });
    }
  }

  // Bookings on the sessions just added, each logged as the worker's booking; a cancellation as
  // the app logs it (the worker's own, with the strike decision; the office's with its reason and
  // the notice the worker had: golden rule 12), and the place it freed, open again.
  const bookings = story.bookings.filter((b) => fresh.has(b.shiftId));
  if (bookings.length > 0) {
    await tx.insert(assignments).values(
      bookings.map((b) => ({
        id: b.id,
        firmId,
        shiftId: b.shiftId,
        slot: b.slot,
        workerId: b.workerId,
        status: b.status,
        confirmedAt: b.confirmedAt,
        cancelledAt: b.cancelledAt,
        cancelReason: b.cancelReason,
        noticeHours: b.noticeHours === null ? null : b.noticeHours.toFixed(2),
        cancelVia: b.cancelVia,
        ...(b.status === "cancelled_worker"
          ? { strikeWarningVersion: STRIKE_WARNING_VERSION, strikeWarningShownAt: b.cancelledAt }
          : {}),
        createdAt: b.confirmedAt,
      })),
    );
    const freed = bookings.filter((b) => b.reopenedId);
    if (freed.length > 0) {
      await tx.insert(assignments).values(
        freed.map((b) => ({
          id: b.reopenedId ?? "",
          firmId,
          shiftId: b.shiftId,
          slot: b.slot,
          workerId: null,
          status: "open" as const,
          createdAt: b.cancelledAt ?? b.confirmedAt,
        })),
      );
    }
  }
  for (const b of bookings) {
    await recordEvent(tx, {
      actorType: "worker",
      actorId: b.workerId,
      action: "shift.assigned",
      entityType: "assignment",
      entityId: b.id,
      data: {
        by: "worker",
        shiftId: b.shiftId,
        workerId: b.workerId,
        slot: b.slot,
        noticeHours: b.bookedNoticeHours,
      },
    });
    if (b.status === "completed") {
      // Marked worked by the office after the shift (src/lib/roster/attendance.ts).
      await recordEvent(tx, {
        actorType: "office",
        actorId: resourcer,
        action: "shift.completed",
        entityType: "assignment",
        entityId: b.id,
        data: { by: "firm", shiftId: b.shiftId, workerId: b.workerId, from: "confirmed" },
      });
    }
    if (b.status !== "cancelled_worker" && b.status !== "cancelled_firm") continue;
    const byFirm = b.status === "cancelled_firm";
    const cancelEvent = await recordEvent(tx, {
      actorType: byFirm ? "office" : "worker",
      actorId: byFirm ? resourcer : b.workerId,
      action: "shift.cancelled",
      entityType: "assignment",
      entityId: b.id,
      data: {
        by: byFirm ? "firm" : "worker",
        shiftId: b.shiftId,
        workerId: b.workerId,
        noticeHours: b.noticeHours,
        ...(byFirm && b.cancelReason ? { reason: b.cancelReason } : {}),
        strike: byFirm ? "by_firm" : "issued",
        place: "reopened",
        reopenedId: b.reopenedId,
      },
    });
    const session = story.sessions.find((x) => x.id === b.shiftId);
    // A dropout inside the urgent window: the system marked the place urgent (as urgent.ts does).
    if (!byFirm && session?.urgentCause === "dropout" && b.noticeHours !== null) {
      await recordEvent(tx, {
        actorType: "system",
        action: "shift.marked_urgent",
        entityType: "shift",
        entityId: b.shiftId,
        data: { by: "system", cause: "dropout", hoursToStart: b.noticeHours },
      });
    }
    // The office's cancellation: the casual was told (golden rule 12; src/lib/notices/firm-change.ts).
    if (byFirm) {
      await recordEvent(tx, {
        actorType: "system",
        action: "shift.change_notice_sent",
        entityType: "assignment",
        entityId: b.id,
        data: {
          changeEventId: cancelEvent,
          workerId: b.workerId,
          channel: "whatsapp",
          providerMessageId: `seed-story-notice-${b.id.slice(0, 8)}`,
          pushes: 0,
        },
      });
    }
  }

  // Strikes for those cancellations: issued as they were cancelled, their evidence sent to the
  // strikes team; Priya's flagged for review, Mo's withdrawn by the office with its reason.
  const strikesNow = story.strikes.filter((s) => bookings.some((b) => b.id === s.bookingId));
  for (const s of strikesNow) {
    await tx.insert(strikes).values({
      id: s.id,
      firmId,
      workerId: s.workerId,
      assignmentId: s.bookingId,
      shiftId: s.shiftId,
      noticeHours: s.noticeHours.toFixed(2),
      thresholdHours: strikeRules.noticeHours,
      issuedAt: s.issuedAt,
      expiresAt: s.expiresAt,
      status: s.withdrawn ? "withdrawn" : "live",
      reviewNeeded: s.reviewReasons.length > 0 && !s.withdrawn,
      reviewReasons: s.reviewReasons,
      ...(s.withdrawn
        ? {
            withdrawnBy: resourcer,
            withdrawnAt: s.withdrawn.at,
            withdrawnReason: s.withdrawn.reason,
          }
        : {}),
      evidenceEmailStatus: "sent",
      evidenceEmailTo: STRIKES_TEAM,
      evidenceEmailSentAt: new Date(s.issuedAt.getTime() + 2 * 60_000),
      createdAt: s.issuedAt,
    });
    const data = { assignmentId: s.bookingId, shiftId: s.shiftId, workerId: s.workerId };
    await recordEvent(tx, {
      actorType: "system",
      action: "strike.issued",
      entityType: "strike",
      entityId: s.id,
      data: { ...data, noticeHours: s.noticeHours, thresholdHours: strikeRules.noticeHours },
    });
    // Its evidence emailed to the strikes team (src/lib/strikes/evidence.ts).
    await recordEvent(tx, {
      actorType: "system",
      action: "strike.evidence_sent",
      entityType: "strike",
      entityId: s.id,
      data: { request: `strike-evidence:${s.id}`, attempt: 1 },
    });
    if (s.withdrawn) {
      await recordEvent(tx, {
        actorType: "office",
        actorId: resourcer,
        action: "strike.withdrawn",
        entityType: "strike",
        entityId: s.id,
        data,
      });
    }
  }

  // Fixed travel times (the travel job only fills what's missing, so it never overwrites them).
  const freshSites = new Set(
    story.sessions.filter((x) => fresh.has(x.id)).map((x) => `${x.siteId}|${x.startsAt.getTime()}`),
  );
  const estimates = story.estimates.filter((e) =>
    freshSites.has(`${e.siteId}|${e.arriveBy.getTime() + 30 * 60_000}`),
  );
  if (estimates.length > 0) {
    await tx
      .insert(travelEstimates)
      .values(
        estimates.map((e) => ({
          firmId,
          originPostcode: e.originPostcode,
          siteId: e.siteId,
          mode: e.mode,
          arriveBy: e.arriveBy,
          minutes: e.minutes,
          metres: e.metres,
          provider: "fake" as const,
          computedAt: sql`now()`,
          expiresAt: e.expiresAt,
        })),
      )
      .onConflictDoNothing();
  }

  // The two sorted pay groups: raised by the casuals and sorted by payroll with a note, each logged.
  for (const q of story.payQueries.filter((p) => fresh.has(p.shiftId))) {
    const groupKey = payGroupKey(
      await groupFactsFor(tx, {
        workerId: q.workerId,
        shiftId: q.shiftId,
        workDate: q.workDate,
        issue: q.issue,
      }),
    );
    await tx.insert(payQueries).values({
      id: q.id,
      firmId,
      workerId: q.workerId,
      shiftId: q.shiftId,
      workDate: q.workDate,
      issueType: q.issue,
      details: q.details,
      groupKey,
      status: "resolved",
      resolvedBy: payroll,
      resolvedAt: q.resolvedAt,
      resolutionNote: q.note,
      createdAt: q.createdAt,
    });
    await recordEvent(tx, {
      actorType: "worker",
      actorId: q.workerId,
      action: "pay_query.created",
      entityType: "pay_query",
      entityId: q.id,
      data: { issueType: q.issue, shiftId: q.shiftId, workDate: q.workDate, groupKey },
    });
    await recordEvent(tx, {
      actorType: "office",
      actorId: payroll,
      action: "pay_query.resolved",
      entityType: "pay_query",
      entityId: q.id,
      data: { workerId: q.workerId, previous: "open", withNote: true },
    });
  }

  // Zoe's and Ben's pay lines, as payroll's file gives them (Phase 24: the mock-up's Pay). Added
  // once (fixed ids); an import's own lines are never overwritten.
  await tx
    .insert(payRecords)
    .values(story.pay.map((p) => ({ ...p, firmId })))
    .onConflictDoNothing();

  // The shifts line's messages, stored as the webhook stores them (answered after this
  // transaction: answerStoryMessages).
  await tx
    .insert(messages)
    .values(
      story.messages.map((m) => {
        const w = story.workers.find((x) => x.key === m.workerKey);
        if (!w) throw new Error(`no story worker ${m.workerKey}`);
        return {
          id: m.id,
          firmId,
          direction: "in" as const,
          channel: "whatsapp" as const,
          providerMessageId: `seed-story-${m.workerKey}`,
          fromE164: w.mobileE164,
          toE164: STORY_LINE,
          body: m.body,
          createdAt: m.receivedAt,
        };
      }),
    )
    .onConflictDoNothing();
}

// A sender for the seed's own replies: it sends nothing, and gives each reply an id of its own.
const seedTransport: MessagingTransport = {
  name: "seed",
  async send() {
    return { providerMessageId: `seed-reply-${crypto.randomUUID()}` };
  },
};

// The story's messages answered by the shifts line's own job (src/lib/inbound/reply.ts), as the job
// worker would: the same replies, request and log entries the app makes. Allowed by Dylan
// (2026-10-12; tests/unit/ai.boundary.test.ts lists this file): no AI (`noAi`; the three messages
// match keywords anyway) and nothing sent (seedTransport). Only those not answered yet, so a re-run
// changes nothing.
export async function answerStoryMessages(
  run: WithFirm,
  firmId: string,
  story: StorySeed,
  o: { baseDomain: string; now: Date },
): Promise<void> {
  const ids = story.messages.map((m) => m.id);
  const open = await run(firmId, (tx) =>
    tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(inArray(messages.id, ids), isNull(messages.handledAt))),
  );
  for (const { id } of open) {
    await runInboundMessage(
      { firmId, messageId: id, idempotencyKey: `inbound-message:${id}` },
      run,
      { transport: seedTransport, ai: noAi, baseDomain: o.baseDomain, clock: { now: () => o.now } },
    );
  }
}

function officeId(firm: SeedFirm, role: "admin" | "resourcer" | "payroll"): string {
  const user = firm.officeUsers.find((u) => u.role === role);
  if (!user) throw new Error(`${firm.slug} has no ${role}`);
  return user.id;
}
