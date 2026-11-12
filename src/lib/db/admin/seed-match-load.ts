import { inArray, sql } from "drizzle-orm";
import { groupFactsFor, payGroupKey } from "../../pay/grouping";
import { hoursToStart } from "../../rules/urgent";
import { strikeSettings } from "../../strikes/settings";
import { STRIKE_WARNING_VERSION } from "../../strikes/words";
import { fakePoint } from "../../travel/geocoder";
import {
  assignments,
  clientContacts,
  clientRequests,
  clients,
  credentialTypes,
  credentials,
  payQueries,
  payRecords,
  shiftEvents,
  shifts,
  sites,
  strikes,
  workers,
} from "../schema";
import type { FirmTx } from "../scoped";
import type { SeedFirm } from "./seed-data";
import type { SeedLog } from "./seed-log";
import { STRIKES_TEAM } from "./seed-data";
import type { MatchSeed } from "./seed-match";

// Loading the match day (seed-match.ts; Phase 36.5) inside Acme's transaction, as the app role,
// the way the story is loaded (seed-story-load.ts): the stadium, its contract, the squad and their
// qualifications are put back as seeded on every run; everything that happened (the events,
// sessions, bookings, cancellations, strikes, the pay query, the client login and its requests) is
// added once by its fixed id and logged once, at its own time, as the app logs it. Nothing is sent
// and no job is queued. The match's offers are written by seed.ts (loadMatchOffers), the seed's one
// offer writer.

export async function loadMatchDay(
  tx: FirmTx,
  firm: SeedFirm,
  match: MatchSeed,
  now: Date,
  log: SeedLog,
): Promise<Set<string>> {
  const firmId = firm.id;
  const strikeRules = strikeSettings(firm.settings);
  const resourcer = officeId(firm, "resourcer");
  const admin = officeId(firm, "admin");

  // The firm's own qualification types and role (data, never code: golden rule 6). Ones already
  // there stay as the office left them.
  await tx
    .insert(credentialTypes)
    .values(
      match.credentialTypes.map((t) => ({
        firmId,
        code: t.code,
        name: t.name,
        sector: firm.sector,
        officeRecorded: t.officeRecorded,
      })),
    )
    .onConflictDoNothing();
  for (const rule of match.rules) {
    await tx.execute(sql`
      insert into credential_rules (firm_id, sector, role, required_types)
      values (app_current_firm_id(), ${firm.sector}, ${rule.role}, ${sql.param(rule.requiredTypes)}::text[])
      on conflict (firm_id, role) do nothing`);
  }

  // The stadium, at its made-up postcode's made-up point, and its contract.
  const point = fakePoint(match.site.postcode);
  if (!point) throw new Error(`no fake point for ${match.site.postcode}`);
  await tx
    .insert(sites)
    .values({ ...match.site, lat: String(point.lat), lng: String(point.lng), firmId })
    .onConflictDoUpdate({
      target: sites.id,
      set: {
        name: sql`excluded.name`,
        addressLine1: sql`excluded.address_line1`,
        town: sql`excluded.town`,
        postcode: sql`excluded.postcode`,
        lat: sql`excluded.lat`,
        lng: sql`excluded.lng`,
      },
    });
  await tx
    .insert(clients)
    .values({ id: match.contract.id, firmId, name: match.contract.name })
    .onConflictDoNothing();
  await tx
    .update(sites)
    .set({ clientId: match.contract.id })
    .where(inArray(sites.id, [match.site.id]));

  // The squad and their qualifications, put back as seeded.
  await tx
    .insert(workers)
    .values(
      match.workers.map((w) => ({
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
  await tx
    .insert(credentials)
    .values(match.credentials.map((c) => ({ ...c, firmId, status: "valid" as const })))
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

  // The two matches, showing to casuals; added once (a demo's switch stays as the demo left it).
  await tx
    .insert(shiftEvents)
    .values(
      match.events.map((e) => ({
        id: e.id,
        firmId,
        name: e.name,
        siteId: match.site.id,
        source: "native" as const,
        showingToCasuals: true,
      })),
    )
    .onConflictDoNothing();

  // Sessions, added once; one whose booking was cancelled has its place open again.
  const added = await tx
    .insert(shifts)
    .values(
      match.sessions.map((s) => ({
        id: s.id,
        firmId,
        shiftEventId: s.eventId,
        siteId: match.site.id,
        role: s.role,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        headcount: s.headcount,
        status: s.booked >= s.headcount ? ("filled" as const) : ("open" as const),
        source: "native" as const,
        isUrgent: s.isUrgent,
        instructions: s.instructions,
        payRatePence: s.payRatePence,
        post: s.post,
        meetingPoint: s.meetingPoint,
        uniform: s.uniform,
        requiredCredentials: s.requiredCredentials,
        createdAt: s.createdAt,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: shifts.id });
  const fresh = new Set(added.map((s) => s.id));
  for (const s of match.sessions.filter((x) => fresh.has(x.id))) {
    log.add(
      {
        actorType: "system",
        action: "shift.created",
        entityType: "shift",
        entityId: s.id,
        data: { source: "seed" },
      },
      s.createdAt,
    );
    // Marked urgent by the office as the seed runs (as src/lib/roster/urgent.ts logs it).
    if (s.urgentCause === "office") {
      log.add({
        actorType: "office",
        actorId: resourcer,
        action: "shift.marked_urgent",
        entityType: "shift",
        entityId: s.id,
        data: { by: "firm", cause: "office", hoursToStart: hoursToStart(s.startsAt, now) },
      });
    }
  }

  // Bookings on the sessions just added, each logged as the casual's own; worked ones marked by
  // the office after the match; each cancellation as the app logs it (the casual's with the rules'
  // strike decision; the office's with its reason and the notice she had, and her notice sent).
  const bookings = match.bookings.filter((b) => fresh.has(b.shiftId));
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
        cancelAskedBy:
          b.status === "cancelled_worker"
            ? ("casual" as const)
            : b.status === "cancelled_firm"
              ? ("firm" as const)
              : null,
        cancelVia: b.cancelVia,
        bookedVia: "app" as const,
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
    const session = match.sessions.find((x) => x.id === b.shiftId);
    log.add(
      {
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
      },
      b.confirmedAt,
    );
    if (b.status === "completed") {
      log.add(
        {
          actorType: "office",
          actorId: resourcer,
          action: "shift.completed",
          entityType: "assignment",
          entityId: b.id,
          data: { by: "firm", shiftId: b.shiftId, workerId: b.workerId, from: "confirmed" },
        },
        new Date(Math.min((session?.endsAt ?? now).getTime() + 60 * 60_000, now.getTime())),
      );
    }
    if (b.status !== "cancelled_worker" && b.status !== "cancelled_firm") continue;
    const byFirm = b.status === "cancelled_firm";
    const cancelledAt = b.cancelledAt ?? now;
    const cancelEvent = log.add(
      {
        actorType: byFirm ? "office" : "worker",
        actorId: byFirm ? resourcer : b.workerId,
        action: "shift.cancelled",
        entityType: "assignment",
        entityId: b.id,
        data: {
          by: byFirm ? "firm" : "worker",
          askedBy: byFirm ? "firm" : "casual",
          shiftId: b.shiftId,
          workerId: b.workerId,
          noticeHours: b.noticeHours,
          ...(byFirm && b.cancelReason ? { reason: b.cancelReason } : {}),
          strike: b.strikeCode,
          place: "reopened",
          reopenedId: b.reopenedId,
        },
      },
      cancelledAt,
    );
    if (!byFirm && session?.urgentCause === "dropout" && b.noticeHours !== null) {
      log.add(
        {
          actorType: "system",
          action: "shift.marked_urgent",
          entityType: "shift",
          entityId: b.shiftId,
          data: { by: "system", cause: "dropout", hoursToStart: b.noticeHours },
        },
        cancelledAt,
      );
    }
    if (byFirm) {
      log.add(
        {
          actorType: "system",
          action: "shift.change_notice_sent",
          entityType: "assignment",
          entityId: b.id,
          data: {
            changeEventId: cancelEvent,
            workerId: b.workerId,
            channel: "sms",
            providerMessageId: `seed-match-notice-${b.id.slice(0, 8)}`,
            pushes: 0,
          },
        },
        new Date(Math.min(cancelledAt.getTime() + 60_000, now.getTime())),
      );
    }
  }

  // Strikes for the cancellations the rules made strikes, their evidence sent to the strikes team.
  for (const s of match.strikes.filter((x) => bookings.some((b) => b.id === x.bookingId))) {
    const evidenceAt = new Date(Math.min(s.issuedAt.getTime() + 2 * 60_000, now.getTime()));
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
      status: "live",
      reviewNeeded: false,
      reviewReasons: [],
      evidenceEmailStatus: "sent",
      evidenceEmailTo: STRIKES_TEAM,
      evidenceEmailSentAt: evidenceAt,
      createdAt: s.issuedAt,
    });
    log.add(
      {
        actorType: "system",
        action: "strike.issued",
        entityType: "strike",
        entityId: s.id,
        data: {
          assignmentId: s.bookingId,
          shiftId: s.shiftId,
          workerId: s.workerId,
          noticeHours: s.noticeHours,
          thresholdHours: strikeRules.noticeHours,
        },
      },
      s.issuedAt,
    );
    log.add(
      {
        actorType: "system",
        action: "strike.evidence_sent",
        entityType: "strike",
        entityId: s.id,
        data: { request: `strike-evidence:${s.id}`, attempt: 1 },
      },
      evidenceAt,
    );
  }

  // The previous match's pay line as payroll's file gives it, and the pay query still open.
  await tx
    .insert(payRecords)
    .values(match.pay.map((p) => ({ ...p, firmId })))
    .onConflictDoNothing();
  if (fresh.has(match.payQuery.shiftId)) {
    const q = match.payQuery;
    const groupKey = payGroupKey(
      await groupFactsFor(tx, {
        workerId: q.workerId,
        shiftId: q.shiftId,
        workDate: q.workDate,
        issue: "missing_hours",
      }),
    );
    await tx.insert(payQueries).values({
      id: q.id,
      firmId,
      workerId: q.workerId,
      shiftId: q.shiftId,
      workDate: q.workDate,
      issueType: "missing_hours",
      details: q.details,
      groupKey,
      createdAt: q.createdAt,
    });
    log.add(
      {
        actorType: "worker",
        actorId: q.workerId,
        action: "pay_query.created",
        entityType: "pay_query",
        entityId: q.id,
        data: { issueType: "missing_hours", shiftId: q.shiftId, workDate: q.workDate, groupKey },
      },
      q.createdAt,
    );
  }

  // The client login, added once by the admin (a login of theirs since), and its requests.
  const [contact] = await tx
    .insert(clientContacts)
    .values({
      id: match.contact.id,
      firmId,
      contractId: match.contract.id,
      name: match.contact.name,
      email: match.contact.email,
      createdBy: admin,
      lastLoginAt: match.contact.lastLoginAt,
      createdAt: match.contact.createdAt,
    })
    .onConflictDoNothing()
    .returning({ id: clientContacts.id });
  if (contact) {
    log.add(
      {
        actorType: "office",
        actorId: admin,
        action: "client_contact.added",
        entityType: "client_contact",
        entityId: contact.id,
        data: { contractId: match.contract.id },
      },
      match.contact.createdAt,
    );
  }
  const asked = await tx
    .insert(clientRequests)
    .values(
      match.requests.map((r) => ({
        id: r.id,
        firmId,
        contractId: match.contract.id,
        clientContactId: match.contact.id,
        kind: r.kind,
        shiftId: r.shiftId,
        eventId: r.eventId,
        payload: r.payload,
        clientNote: r.clientNote,
        status: r.status,
        urgent: r.urgent,
        officeAnswer: r.officeAnswer,
        answeredBy: r.answeredAt ? resourcer : null,
        answeredAt: r.answeredAt,
        updatedAt: r.answeredAt ?? r.createdAt,
        createdAt: r.createdAt,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: clientRequests.id });
  const freshAsks = new Set(asked.map((r) => r.id));
  for (const r of match.requests.filter((x) => freshAsks.has(x.id))) {
    const about = {
      contractId: match.contract.id,
      kind: r.kind,
      ...(r.shiftId ? { shiftId: r.shiftId } : {}),
    };
    log.add(
      {
        actorType: "client",
        actorId: match.contact.id,
        action: "client_request.created",
        entityType: "client_request",
        entityId: r.id,
        data: { ...about, ...(r.eventId ? { eventId: r.eventId } : {}), urgent: r.urgent },
      },
      r.createdAt,
    );
    if (r.status === "accepted" && r.answeredAt) {
      log.add(
        {
          actorType: "office",
          actorId: resourcer,
          action: "client_request.accepted",
          entityType: "client_request",
          entityId: r.id,
          data: { ...about, ...(r.accepted ?? {}) },
        },
        r.answeredAt,
      );
    }
    if (r.status === "declined" && r.answeredAt) {
      log.add(
        {
          actorType: "office",
          actorId: resourcer,
          action: "client_request.declined",
          entityType: "client_request",
          entityId: r.id,
          data: about,
        },
        r.answeredAt,
      );
    }
  }
  return fresh;
}

function officeId(firm: SeedFirm, role: "admin" | "resourcer" | "payroll"): string {
  const user = firm.officeUsers.find((u) => u.role === role);
  if (!user) throw new Error(`${firm.slug} has no ${role}`);
  return user.id;
}
