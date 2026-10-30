import { and, eq, gt, inArray, lt, notInArray, sql } from "drizzle-orm";
import { Client, Pool } from "pg";
import { applyCredentialPack } from "../../credentials/apply-pack";
import { recordEvent } from "../../events/record";
import { createWithFirm, type FirmTx } from "../scoped";
import { automaticEventId } from "../../roster/shift-events";
import {
  CANCELLED_ASSIGNMENT_STATUSES,
  assignments,
  credentials,
  firms,
  offers,
  officeUsers,
  payQueries,
  payRecords,
  requests,
  shifts,
  sites,
  workers,
} from "../schema";
import { seedFirms, weekOffers, type SeedFirm } from "./seed-data";
import { acmeSaturday, type SaturdaySeed } from "./seed-saturday";
import {
  acmePastEvent,
  acmePayQueries,
  northlineNight,
  type ExtraBooking,
  type ExtraShift,
  type PayQuerySeed,
} from "./seed-extras";
import { groupFactsFor, payGroupKey } from "../../pay/grouping";
import { lockOfferCounts } from "../../offers/candidates";
import { noticeHours } from "../../roster/notice";
import { quietHours } from "../../rules/quiet-hours";
import { hoursToStart, insideUrgentWindow, urgentWindowHours } from "../../rules/urgent";
import { fakePoint } from "../../travel/geocoder";
import { acmeStory } from "./seed-story";
import { answerStoryMessages, loadStory } from "./seed-story-load";
import { isLocalHost } from "./urls";

// Loads the demo firms (docs/testing.md). Firms are created through the owner connection (the
// app role can't create firms); everything else goes through withFirm as the app role, like the
// app itself. Rows are upserted by fixed ids, so running it again changes nothing, and it puts
// seeded rows back as seeded (status included). Acme's Saturday event day (seed-saturday.ts:
// shifts, bookings, the urgent dropout, requests, pay records, and this week's offers on it) is
// only ever added, never reset, so a re-run mid-demo can't undo the demo or add to it; its
// bookings, dropout, requests and offers are logged as the app would log them, once, when first
// added. Rows added during a demo stay: only `npm run db:reset` returns the database to exactly
// the demo state.

export interface SeedSummary {
  firms: {
    slug: string;
    sites: number;
    officeUsers: number;
    workers: number;
    credentials: number;
    shifts: number; // on the event day (Acme only)
    eventDay: string | null;
    urgentShiftId: string | null; // the dropout's shift
  }[];
}

export async function seed(opts: {
  adminUrl: string;
  appUrl: string;
  nodeEnv: string;
  // "on" only from a demo server's reset (src/lib/db/admin/demo-reset.ts, 16.2), which has already
  // checked it's a demo server and recreated the database.
  demoMode?: "on";
  today?: Date;
}): Promise<SeedSummary> {
  // Checked before any connection is made (golden rule 7: fake data, never near real data). In
  // production only on a demo server, whose database holds the made-up demo alone (ADR-025).
  if (opts.nodeEnv === "production" && opts.demoMode !== "on")
    throw new Error("The seed never runs with NODE_ENV=production (except a demo server's reset)");
  if (!isLocalHost(opts.adminUrl) || !isLocalHost(opts.appUrl)) {
    throw new Error("The seed only runs against a database on this machine");
  }

  const now = opts.today ?? new Date();
  const firms = seedFirms(now);
  const owner = new Client({ connectionString: opts.adminUrl });
  const appPool = new Pool({ connectionString: opts.appUrl, max: 2 });
  const withFirm = createWithFirm(appPool);
  await owner.connect();
  try {
    const summary: SeedSummary = { firms: [] };
    for (const firm of firms) {
      await provisionFirm(owner, firm);
      const saturday = firm.slug === "acme" ? acmeSaturday(firm.workers, firm.sites, now) : null;
      // The mock-up's story (seed-story.ts, 12I.1): Acme only.
      const story = firm.slug === "acme" ? acmeStory(firm, now) : null;
      await withFirm(firm.id, async (tx) => {
        await loadFirm(tx, firm);
        const freshSaturday = saturday
          ? await loadSaturday(tx, firm, saturday, now)
          : new Set<string>();
        // The walkthrough's other states (seed-extras.ts, Phase 10 task 20).
        if (firm.slug === "acme") {
          const past = acmePastEvent(firm.workers, firm.sites, now);
          await loadExtraShifts(tx, firm, past);
          await loadPayQueries(tx, acmePayQueries(firm.workers, past, now));
        }
        if (story) await loadStory(tx, firm, story, now);
        // This week's offers (the dashboard's offers chart, Phase 23), once the bookings are in.
        if (saturday) await loadWeekOffers(tx, firm, { saturday, fresh: freshSaturday, now });
        if (firm.slug === "northline") {
          await loadExtraShifts(tx, firm, northlineNight(firm.workers, firm.sites, now));
        }
      });
      // Its messages answered by the shifts line's own job, once the story is in.
      if (story) {
        await answerStoryMessages(withFirm, firm.id, story, {
          baseDomain: process.env.APP_BASE_DOMAIN ?? "localhost:3000",
          now,
        });
      }
      summary.firms.push({
        slug: firm.slug,
        sites: firm.sites.length,
        officeUsers: firm.officeUsers.length,
        workers: firm.workers.length,
        credentials: firm.credentials.length,
        shifts: saturday?.shifts.length ?? 0,
        eventDay: saturday?.day ?? null,
        urgentShiftId: saturday?.urgentShiftId ?? null,
      });
    }
    return summary;
  } finally {
    await owner.end();
    await appPool.end();
  }
}

// RLS is forced for the owner too, so it sets the firm it is creating, exactly like withFirm.
async function provisionFirm(owner: Client, firm: SeedFirm): Promise<void> {
  await owner.query("begin");
  try {
    await owner.query("select set_config('app.current_firm_id', $1, true)", [firm.id]);
    await owner.query(
      `insert into firms (id, name, slug, sector, settings, shifts_line_e164, brand_primary_color)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do update set name = excluded.name, slug = excluded.slug,
         sector = excluded.sector, settings = excluded.settings,
         shifts_line_e164 = excluded.shifts_line_e164,
         brand_primary_color = excluded.brand_primary_color, brand_logo_url = null`,
      [
        firm.id,
        firm.name,
        firm.slug,
        firm.sector,
        JSON.stringify(firm.settings),
        firm.shiftsLine,
        firm.brandColour,
      ],
    );
    await owner.query("commit");
  } catch (err) {
    await owner.query("rollback");
    throw err;
  }
}

async function loadFirm(tx: FirmTx, firm: SeedFirm): Promise<void> {
  const firmId = firm.id;
  // The sector's credential types and default role rules first; existing ones stay as they are.
  await applyCredentialPack(tx, firm.sector, { type: "system" });
  // Each made-up ZZ postcode with the fake geocoder's point for it (12G.1), as Settings would save.
  const located = (postcode: string | undefined) => {
    const point = postcode ? fakePoint(postcode) : null;
    return { lat: point ? String(point.lat) : null, lng: point ? String(point.lng) : null };
  };
  await tx
    .insert(sites)
    .values(firm.sites.map((s) => ({ ...s, ...located(s.postcode), firmId })))
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
    .insert(officeUsers)
    .values(firm.officeUsers.map((u) => ({ ...u, firmId })))
    .onConflictDoUpdate({
      target: officeUsers.id,
      set: {
        email: sql`excluded.email`,
        name: sql`excluded.name`,
        role: sql`excluded.role`,
        status: sql`'active'`,
      },
    });
  await tx
    .insert(workers)
    .values(firm.workers.map((w) => ({ ...w, firmId })))
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
    .values(firm.credentials.map((c) => ({ ...c, firmId })))
    .onConflictDoUpdate({
      target: credentials.id,
      set: {
        type: sql`excluded.type`,
        number: sql`excluded.number`,
        expiresOn: sql`excluded.expires_on`,
        status: sql`excluded.status`,
        verifiedAt: sql`null`,
        verifiedBy: sql`null`,
      },
    });
}

// Each seeded shift joins its site and day's automatic event, as a new sheet or file row does.
async function withEvents<T extends { siteId: string | null; startsAt: Date }>(
  tx: FirmTx,
  rows: T[],
): Promise<(T & { shiftEventId: string })[]> {
  const [firm] = await tx
    .select({ timezone: firms.timezone })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  const timeZone = firm?.timezone ?? "Europe/London";
  const out: (T & { shiftEventId: string })[] = [];
  for (const row of rows) {
    const shiftEventId = await automaticEventId(tx, {
      siteId: row.siteId,
      startsAt: row.startsAt,
      source: "native",
      timeZone,
    });
    out.push({ ...row, shiftEventId });
  }
  return out;
}

// Acme's Saturday: added once (fixed ids, nothing overwritten), and logged once, as the app logs
// a booking, a cancellation and a request (ids and notice hours only; the reason and the notes
// stay on their rows). Returns the shifts added just now. Exported for seed.test.ts, which loads a
// Saturday on a fixed day inside a transaction it rolls back.
export async function loadSaturday(
  tx: FirmTx,
  firm: SeedFirm,
  day: SaturdaySeed,
  now: Date,
): Promise<Set<string>> {
  const firmId = firm.id;
  const newShifts = await tx
    .insert(shifts)
    .values(
      (await withEvents(tx, day.shifts)).map((s) => ({
        ...s,
        firmId,
        headcount: 1,
        source: "native" as const,
        createdAt: day.shiftsCreatedAt,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: shifts.id });
  // Bookings and requests only on shifts added just now: a shift already there (and whatever a
  // demo did with it) is left exactly as it is.
  const fresh = new Set(newShifts.map((s) => s.id));
  for (const s of newShifts) {
    await recordEvent(tx, {
      actorType: "system",
      action: "shift.created",
      entityType: "shift",
      entityId: s.id,
      data: { source: "seed" },
    });
  }
  const bookings = day.bookings.filter((b) => fresh.has(b.shiftId));
  const toAsk = day.requests.filter((r) => fresh.has(r.shiftId));
  if (bookings.length === 0) {
    await loadPay(tx, firmId, day);
    return fresh;
  }
  const added = await tx
    .insert(assignments)
    .values(
      bookings.map((b) => ({
        id: b.id,
        firmId,
        shiftId: b.shiftId,
        slot: 1,
        workerId: b.workerId,
        status: b.status,
        confirmedAt: b.confirmedAt,
        cancelledAt: b.cancelledAt,
        cancelReason: b.cancelReason,
        noticeHours: b.noticeHours === null ? null : b.noticeHours.toFixed(2),
        // Who asked (P3.4): the casual, for their own.
        cancelAskedBy: b.status === "cancelled_worker" ? ("casual" as const) : null,
        bookedVia: "app" as const, // logged below as the worker's own booking (P2.2)
      })),
    )
    .onConflictDoNothing()
    .returning({ id: assignments.id });
  const newlyAdded = new Set(added.map((a) => a.id));
  for (const b of bookings) {
    if (!newlyAdded.has(b.id)) continue;
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
        slot: 1,
        noticeHours: b.bookedNoticeHours,
      },
    });
    if (b.status === "cancelled_worker") {
      await recordEvent(tx, {
        actorType: "worker",
        actorId: b.workerId,
        action: "shift.cancelled",
        entityType: "assignment",
        entityId: b.id,
        data: {
          by: "worker",
          shiftId: b.shiftId,
          workerId: b.workerId,
          noticeHours: b.noticeHours,
        },
      });
      // Marked urgent as the app would (src/lib/roster/urgent.ts): by the system if the dropout
      // was inside the firm's urgent window, otherwise by the firm's resourcer, by hand.
      const shift = day.shifts.find((s) => s.id === b.shiftId);
      const byTheSystem =
        shift !== undefined &&
        b.cancelledAt !== null &&
        insideUrgentWindow(shift.startsAt, b.cancelledAt, urgentWindowHours(firm.settings));
      const resourcer = firm.officeUsers.find((u) => u.role === "resourcer");
      if (!byTheSystem && !resourcer) throw new Error(`${firm.slug} has no resourcer to mark it`);
      await recordEvent(tx, {
        actorType: byTheSystem ? "system" : "office",
        actorId: byTheSystem ? null : (resourcer?.id ?? null),
        action: "shift.marked_urgent",
        entityType: "shift",
        entityId: b.shiftId,
        data: byTheSystem
          ? { by: "system", cause: "dropout", hoursToStart: b.noticeHours }
          : {
              by: "firm",
              cause: "office",
              // The office marks it now, as the seed runs: hours to the start from now.
              hoursToStart: shift ? hoursToStart(shift.startsAt, now) : null,
            },
      });
    }
  }
  const asked =
    toAsk.length === 0
      ? []
      : await tx
          .insert(requests)
          .values(toAsk.map((r) => ({ ...r, firmId })))
          .onConflictDoNothing()
          .returning({
            id: requests.id,
            workerId: requests.workerId,
            shiftId: requests.shiftId,
            type: requests.type,
          });
  for (const r of asked) {
    await recordEvent(tx, {
      actorType: "worker",
      actorId: r.workerId,
      action: "request.created",
      entityType: "request",
      entityId: r.id,
      data: { type: r.type, shiftId: r.shiftId },
    });
  }
  await loadPay(tx, firmId, day);
  return fresh;
}

// This week's made-up offers (seed-data.ts weekOffers), only on the Saturday's shifts added just
// now, as loadSaturday adds bookings and requests: waiting on its open places, and said yes for its
// own bookings made this week, as stored. A Saturday already there (and whatever a demo did with
// it) gets none, so a re-run adds none. None said no: the app can't record a "no" yet (PLAN.md's
// Parking lot). None in Acme's quiet hours, when the app holds an offer. Each sent by Acme's
// resourcer, added once (fixed ids; one already there, or another office offer of the same session
// to the same casual, is left as it is) and logged once as the app logs a sent offer (offer.sent,
// ids and notice hours only; dated when the seed ran, as the log can't be backdated). It takes the
// offer-count lock before its insert, like every offer writer (tests/unit/offers.boundary.test.ts),
// but doesn't check the daily cap: tests/integration/seed.test.ts checks what it wrote against it.
// Nothing is sent. Exported for that test too.
export async function loadWeekOffers(
  tx: FirmTx,
  firm: SeedFirm,
  o: { saturday: SaturdaySeed; fresh: Set<string>; now: Date },
): Promise<void> {
  const resourcer = firm.officeUsers.find((u) => u.role === "resourcer");
  if (!resourcer) throw new Error(`${firm.slug} has no resourcer to send offers`);
  if (o.fresh.size === 0) return; // the Saturday was already there: nothing to add
  const ids = o.saturday.bookings.filter((b) => o.fresh.has(b.shiftId)).map((b) => b.id);
  const booked = await tx
    .select({
      id: assignments.id,
      shiftId: assignments.shiftId,
      workerId: assignments.workerId,
      confirmedAt: assignments.confirmedAt,
      startsAt: shifts.startsAt,
    })
    .from(assignments)
    .innerJoin(
      shifts,
      and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
    )
    .where(
      and(
        inArray(assignments.id, ids),
        eq(assignments.status, "confirmed"),
        gt(shifts.startsAt, o.now),
      ),
    );
  const planned = weekOffers({
    now: o.now,
    workers: firm.workers,
    quiet: quietHours(firm.settings),
    openPlaces: o.saturday.shifts
      .filter((s) => o.fresh.has(s.id) && s.status === "open" && !s.isUrgent)
      .map((s) => ({ id: s.id, role: s.role })),
    bookings: booked.flatMap((b) =>
      b.workerId && b.confirmedAt
        ? [{ ...b, workerId: b.workerId, confirmedAt: b.confirmedAt }]
        : [],
    ),
  });
  if (planned.length === 0) return;
  await lockOfferCounts(
    tx,
    planned.map((p) => p.workerId),
  );
  const added = await tx
    .insert(offers)
    .values(
      planned.map((p) => ({
        id: p.id,
        firmId: firm.id,
        shiftId: p.shiftId,
        workerId: p.workerId,
        offeredBy: resourcer.id,
        channel: "sms" as const,
        sentAt: p.sentAt,
        response: p.response,
        respondedAt: p.respondedAt,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: offers.id });
  // Each session's start, for the notice the offer gave.
  const startOf = new Map([
    ...o.saturday.shifts.map((x): [string, Date] => [x.id, x.startsAt]),
    ...booked.map((b): [string, Date] => [b.shiftId, b.startsAt]),
  ]);
  const newlyAdded = new Set(added.map((a) => a.id));
  for (const p of planned) {
    if (!newlyAdded.has(p.id)) continue;
    const startsAt = startOf.get(p.shiftId);
    await recordEvent(tx, {
      actorType: "system",
      action: "offer.sent",
      entityType: "offer",
      entityId: p.id,
      data: {
        shiftId: p.shiftId,
        workerId: p.workerId,
        offeredBy: resourcer.id,
        noticeHours: startsAt ? noticeHours(startsAt, p.sentAt) : null,
        channel: "sms",
      },
    });
  }
}

async function loadPay(tx: FirmTx, firmId: string, day: SaturdaySeed): Promise<void> {
  await tx
    .insert(payRecords)
    .values(day.pay.map((p) => ({ ...p, firmId })))
    .onConflictDoNothing();
}

// Shifts and bookings from seed-extras.ts: added once (fixed ids, nothing overwritten), and logged
// once, as the app logs them: the shift's creation, each booking (by the worker), and an office
// cancellation with its reason and the notice the worker had (golden rule 12).
// A booking is left out (its place stays open) when the worker already holds a booking that
// overlaps it, as the rules would refuse: a re-run in a later week makes last week's Saturday the
// "last event", and its workers are booked on that Saturday already (the guardrails review).
async function loadExtraShifts(
  tx: FirmTx,
  firm: SeedFirm,
  extra: { shiftsCreatedAt: Date; shifts: ExtraShift[]; bookings: ExtraBooking[] },
): Promise<void> {
  const firmId = firm.id;
  const clashes = new Set<string>();
  for (const b of extra.bookings) {
    const shift = extra.shifts.find((s) => s.id === b.shiftId);
    if (!shift || b.status !== "confirmed") continue;
    const [held] = await tx
      .select({ id: assignments.id })
      .from(assignments)
      .innerJoin(
        shifts,
        and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
      )
      .where(
        and(
          eq(assignments.workerId, b.workerId),
          notInArray(assignments.status, [...CANCELLED_ASSIGNMENT_STATUSES]),
          lt(shifts.startsAt, shift.endsAt),
          gt(shifts.endsAt, shift.startsAt),
        ),
      )
      .limit(1);
    if (held && held.id !== b.id) clashes.add(b.id);
  }
  const openShifts = new Set(extra.bookings.filter((b) => clashes.has(b.id)).map((b) => b.shiftId));
  const added = await tx
    .insert(shifts)
    .values(
      (await withEvents(tx, extra.shifts)).map((s) => ({
        ...s,
        status: openShifts.has(s.id) ? ("open" as const) : s.status,
        firmId,
        headcount: 1,
        source: "native" as const,
        isUrgent: false,
        createdAt: extra.shiftsCreatedAt,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: shifts.id });
  const fresh = new Set(added.map((s) => s.id));
  for (const s of added) {
    await recordEvent(tx, {
      actorType: "system",
      action: "shift.created",
      entityType: "shift",
      entityId: s.id,
      data: { source: "seed" },
    });
  }
  const bookings = extra.bookings.filter((b) => fresh.has(b.shiftId) && !clashes.has(b.id));
  if (bookings.length === 0) return;
  await tx.insert(assignments).values(
    bookings.map((b) => ({
      id: b.id,
      firmId,
      shiftId: b.shiftId,
      slot: 1,
      workerId: b.workerId,
      status: b.status,
      confirmedAt: b.confirmedAt,
      cancelledAt: b.cancelledAt,
      cancelReason: b.cancelReason,
      noticeHours: b.noticeHours === null ? null : b.noticeHours.toFixed(2),
      // Who asked (P3.4): the firm, for the office's.
      cancelAskedBy: b.status === "cancelled_firm" ? ("firm" as const) : null,
      bookedVia: "app" as const, // logged below as the worker's own booking (P2.2)
    })),
  );
  const resourcer = firm.officeUsers.find((u) => u.role === "resourcer");
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
        slot: 1,
        noticeHours: b.bookedNoticeHours,
      },
    });
    if (b.status === "cancelled_firm") {
      if (!resourcer) throw new Error(`${firm.slug} has no resourcer to cancel it`);
      await recordEvent(tx, {
        actorType: "office",
        actorId: resourcer.id,
        action: "shift.cancelled",
        entityType: "assignment",
        entityId: b.id,
        data: {
          by: "firm",
          shiftId: b.shiftId,
          workerId: b.workerId,
          noticeHours: b.noticeHours,
          ...(b.cancelReason ? { reason: b.cancelReason } : {}),
        },
      });
    }
  }
}

// Pay queries from seed-extras.ts: added once, each with the group key the app gives it (from the
// pay lines and the shift's site: src/lib/pay/grouping.ts), and logged as a raised query.
async function loadPayQueries(tx: FirmTx, queries: PayQuerySeed[]): Promise<void> {
  for (const q of queries) {
    // A query about a shift only from someone booked on it (a booking left out as an overlap,
    // above, takes its query with it).
    if (q.shiftId) {
      const [booked] = await tx
        .select({ id: assignments.id })
        .from(assignments)
        .where(
          and(
            eq(assignments.shiftId, q.shiftId),
            eq(assignments.workerId, q.workerId),
            notInArray(assignments.status, [...CANCELLED_ASSIGNMENT_STATUSES]),
          ),
        )
        .limit(1);
      if (!booked) continue;
    }
    const facts = await groupFactsFor(tx, {
      workerId: q.workerId,
      shiftId: q.shiftId,
      workDate: q.workDate,
      issue: q.issue,
    });
    const groupKey = payGroupKey(facts);
    const [created] = await tx
      .insert(payQueries)
      .values({
        id: q.id,
        firmId: sql`app_current_firm_id()`,
        workerId: q.workerId,
        shiftId: q.shiftId,
        workDate: q.workDate,
        issueType: q.issue,
        details: q.details,
        groupKey,
      })
      .onConflictDoNothing()
      .returning({ id: payQueries.id });
    if (!created) continue;
    await recordEvent(tx, {
      actorType: "worker",
      actorId: q.workerId,
      action: "pay_query.created",
      entityType: "pay_query",
      entityId: created.id,
      data: { issueType: q.issue, shiftId: q.shiftId, workDate: q.workDate, groupKey },
    });
  }
}
