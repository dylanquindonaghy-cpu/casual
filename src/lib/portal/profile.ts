import { loadCasualRecords } from "../office/reliability";
import type { Reliability } from "../rules/reliability";
import { and, asc, eq, gt, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { qualificationsFor } from "../credentials/qualifications";
import type { StaffPhoto } from "../uploads/photo";
import {
  qualificationStatus,
  RIGHT_TO_WORK,
  STATUS_ORDER,
  type Qualification,
  type RightToWork,
} from "../credentials/status";
import {
  assignments,
  credentials,
  credentialTypes,
  offers,
  shifts,
  uploads,
  workers,
  workerUnavailableDays,
} from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { withFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { addDays, localDateOf } from "../time/zoned";
import { inHand, type SortedMark } from "./in-hand";
import type { PortalContext } from "./my-shifts";
import {
  CHANNELS,
  MAX_UNAVAILABLE_DAYS,
  UNAVAILABLE_AHEAD_DAYS,
  type AvailabilityOutcome,
  type Channel,
  type SettingsOutcome,
} from "./profile-kinds";

// The profile page (docs/screens.md, `/profile`), for the logged-in worker only, inside their
// firm. Server only (it reaches the database); the browser-safe parts are profile-kinds.ts.
//
// - myProfile: contact details; her qualifications as they stand today (12F.1: every type one of her
//   roles needs, with its status, src/lib/credentials/status.ts; 28.11: the number on her record of
//   each she may upload herself, never one the office records itself, and whether the office has it
//   in hand, src/lib/portal/in-hand.ts), then any other she holds that a
//   shift she's booked on or offered needs on top of its role ("Other qualifications on file",
//   Phase 27.2), and her right-to-work check (a status only); the days marked unavailable from
//   today on (with whether a booking falls on each); and the notification settings.
// - setUnavailable: mark or clear one firm-local day, today to 180 days ahead, at most 60 marked.
//   Marking never touches a booking already made that day (a cancellation must be deliberate);
//   the answer says if there is one. The rules engine's check 8 uses these days.
// - setNotificationSettings: WhatsApp or text message, and whether to hear about open shifts.
// Every change is logged with dates and choices only (golden rule 5).

type Ctx = PortalContext & { firm: { id: string; timezone: string } };

// One she holds that a shift of hers needs on top of its role, though none of her roles does (a
// session's own extra, `shifts.required_credentials`), read as every qualification is
// (qualificationStatus()). `neededFor` is empty (no role needs it) and she can't upload it (her
// upload page takes only what her roles need): she tells the office. `shift`: the soonest one that
// needs it, booked or offered.
export interface OtherQualification extends Qualification {
  shift: { role: string; day: string; booked: boolean };
}

// One of her own on Profile (28.11): `number` only on one she may upload herself (one the office
// records itself, CSAS, right to work, health or criminal record details, never carries it), and
// `inHand` when the office marked it sorted and it still stands as it did then. Display only.
export type MyQualification = Qualification & { inHand?: boolean };

export interface Profile {
  firstName: string;
  lastName: string;
  mobile: string;
  email: string | null;
  notifyChannel: Channel;
  offerAlerts: boolean;
  textsOff: boolean; // they replied STOP to a text: no texts until they reply START
  qualifications: MyQualification[];
  // "Other qualifications on file" (Phase 27.2): always set by myProfile; left out by the pages'
  // own fixtures.
  others?: OtherQualification[];
  rightToWork: RightToWork;
  rolesWithoutRule: string[]; // her roles the firm has no rule for (she can't take those shifts)
  photo: StaffPhoto; // her staff photo (12F.2)
  unavailable: { day: string; booked: boolean }[];
  today: string;
  // Phase 26.7 (cas-6): their own reliability over the last 90 days, as the office sees it.
  reliability?: Reliability; // always set by myProfile; left out by the pages' own fixtures
}

// Which of the firm-local days have a confirmed booking of the worker's on a shift touching them
// (one query for the whole list).
async function bookedDays(tx: FirmTx, workerId: string, days: string[], timeZone: string) {
  if (days.length === 0) return new Set<string>();
  const { rows } = await tx.execute<{ day: string }>(sql`
    select d.day::text as day
      from (values ${sql.join(
        days.map((day) => sql`(${day}::date)`),
        sql`, `,
      )}) as d(day)
     where exists (
       select 1 from assignments a
         join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
        where a.worker_id = ${workerId} and a.status = 'confirmed'
          and s.starts_at < ((d.day + 1)::timestamp at time zone ${timeZone})
          and s.ends_at > (d.day::timestamp at time zone ${timeZone}))
  `);
  return new Set(rows.map((r) => r.day));
}

export async function myProfile(ctx: Ctx, workerId: string): Promise<Profile | null> {
  const now = (ctx.clock ?? systemClock).now();
  const today = localDateOf(now, ctx.firm.timezone);
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    const [me] = await tx
      .select({
        firstName: workers.firstName,
        lastName: workers.lastName,
        mobile: workers.mobileE164,
        email: workers.email,
        notifyChannel: workers.notifyChannel,
        offerAlerts: workers.offerAlerts,
        smsOptedOutAt: workers.smsOptedOutAt,
      })
      .from(workers)
      .where(eq(workers.id, workerId));
    if (!me || me.mobile === null) return null; // erased (their sessions went with them)
    const held = (
      await qualificationsFor(tx, [workerId], { now, timeZone: ctx.firm.timezone, numbers: true })
    ).get(workerId);
    const mark = await latestSortedMark(tx, workerId, ctx.firm.timezone);
    const days = await tx
      .select({ day: workerUnavailableDays.day })
      .from(workerUnavailableDays)
      .where(
        and(eq(workerUnavailableDays.workerId, workerId), gte(workerUnavailableDays.day, today)),
      )
      .orderBy(asc(workerUnavailableDays.day));
    const booked = await bookedDays(
      tx,
      workerId,
      days.map((d) => d.day),
      ctx.firm.timezone,
    );
    const { smsOptedOutAt, ...contact } = me;
    const qualifications: MyQualification[] = (held?.qualifications ?? []).map((q) => ({
      ...q,
      number: q.uploadable ? (q.number ?? null) : null,
      inHand: inHand(q, mark),
    }));
    return {
      ...contact,
      mobile: me.mobile,
      textsOff: smsOptedOutAt !== null,
      qualifications,
      others: await otherQualifications(tx, workerId, {
        now,
        timeZone: ctx.firm.timezone,
        today,
        listed: new Set(qualifications.map((q) => q.type)),
      }),
      rightToWork: held?.rightToWork ?? { checked: false, checkedOn: null, expired: false },
      rolesWithoutRule: held?.rolesWithoutRule ?? [],
      photo: held?.photo ?? { status: "missing", current: null, waiting: null },
      unavailable: days.map(({ day }) => ({ day, booked: booked.has(day) })),
      today,
      reliability: (await loadCasualRecords(tx, now, [workerId])).get(workerId)?.reliability ?? {
        kind: "new",
        counted: 0,
        counts: { worked: 0, noShows: 0, lateCancels: 0 },
      },
    };
  });
}

// The same mark for Home's "Do this" (Phase 28.15, 28.11's hand-off), so Home and Profile agree on
// what the office has in hand.
export async function mySortedMark(
  ctx: { firm: { id: string; timezone: string }; run?: PortalContext["run"] },
  workerId: string,
): Promise<SortedMark | null> {
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, (tx) => latestSortedMark(tx, workerId, ctx.firm.timezone));
}

// The office's latest "Mark as sorted" for her (src/lib/office/casual-follow-up.ts: what it was
// about, and the day, in the firm's calendar); null when it never marked one. Her own only.
// `changedAfter` (src/lib/portal/in-hand.ts): an entry logged after the mark that changed her
// records of that type: one of them added or updated (credential.added, credential.updated: the
// office's file, a CSAS record), or an upload of it sent, approved or turned down (upload.*, which
// name her). Not the daily scan's credential.expired: it only makes a stored status match a date
// that had already passed, which her status read from the start.
async function latestSortedMark(
  tx: FirmTx,
  workerId: string,
  timeZone: string,
): Promise<SortedMark | null> {
  const { rows } = await tx.execute<{
    type: string | null;
    status: string | null;
    at: Date | string;
    changed: boolean;
  }>(
    sql`
      select m.data ->> 'type' as type, m.data ->> 'status' as status, m.created_at as at,
             (exists (select 1 from events e
                       where e.action in ('credential.added', 'credential.updated')
                         and e.id > m.id
                         and e.entity_id in (select c.id from credentials c
                                              where c.firm_id = m.firm_id
                                                and c.worker_id = ${workerId}
                                                and c.type = m.data ->> 'type'))
              or exists (select 1 from events e
                          where e.worker_ref = ${workerId}
                            and e.action in ('upload.received', 'upload.approved', 'upload.rejected')
                            and e.id > m.id
                            and e.data ->> 'qualificationType' = m.data ->> 'type')) as changed
        from events m
       where m.action = 'casual.needs_sorted' and m.entity_type = 'worker'
         and m.entity_id = ${workerId}
       order by m.id desc
       limit 1
    `,
  );
  const row = rows[0];
  if (!row?.type || !row.status) return null;
  return {
    type: row.type,
    status: row.status,
    day: localDateOf(new Date(row.at), timeZone),
    changedAfter: row.changed === true,
  };
}

// The extras (`shifts.required_credentials`) of the shifts she's booked on (still to finish) or
// offered (not started, open, her answer still awaited), less right to work and the types her roles
// already list; of those, the ones she holds a record of, each with the soonest shift that needs it
// (booked first on a tie). Worst first, then by name, as her main list. Reads only.
async function otherQualifications(
  tx: FirmTx,
  workerId: string,
  o: { now: Date; timeZone: string; today: string; listed: ReadonlySet<string> },
): Promise<OtherQualification[]> {
  const extras = sql`cardinality(${shifts.requiredCredentials}) > 0`;
  const sessionOf = {
    extras: shifts.requiredCredentials,
    role: shifts.role,
    startsAt: shifts.startsAt,
  };
  const booked = await tx
    .select(sessionOf)
    .from(assignments)
    .innerJoin(
      shifts,
      and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
    )
    .where(
      and(
        eq(assignments.workerId, workerId),
        eq(assignments.status, "confirmed"),
        gt(shifts.endsAt, o.now),
        inArray(shifts.status, ["open", "filled"]),
        extras,
      ),
    );
  const offered = await tx
    .select(sessionOf)
    .from(offers)
    .innerJoin(shifts, and(eq(shifts.firmId, offers.firmId), eq(shifts.id, offers.shiftId)))
    .where(
      and(
        eq(offers.workerId, workerId),
        isNull(offers.response),
        gt(shifts.startsAt, o.now),
        eq(shifts.status, "open"),
        extras,
      ),
    );
  const sessions = [
    ...booked.map((s) => ({ ...s, booked: true })),
    ...offered.map((s) => ({ ...s, booked: false })),
  ].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || Number(b.booked) - Number(a.booked),
  );
  const firstFor = new Map<string, (typeof sessions)[number]>();
  for (const s of sessions) {
    for (const code of s.extras) {
      if (code === RIGHT_TO_WORK || o.listed.has(code) || firstFor.has(code)) continue;
      firstFor.set(code, s);
    }
  }
  const codes = [...firstFor.keys()];
  if (codes.length === 0) return [];
  // Her records of them, each with the upload it came from (as qualificationsFor() reads them).
  const records = await tx
    .select({
      type: credentials.type,
      status: credentials.status,
      expiresOn: credentials.expiresOn,
      checkState: credentials.checkState,
      uploadId: uploads.id,
      sentAt: uploads.createdAt,
      reason: credentials.rejectedReason,
    })
    .from(credentials)
    .leftJoin(
      uploads,
      and(eq(uploads.firmId, credentials.firmId), eq(uploads.id, credentials.evidenceUploadId)),
    )
    .where(and(eq(credentials.workerId, workerId), inArray(credentials.type, codes)));
  const names = new Map(
    (
      await tx
        .select({ code: credentialTypes.code, name: credentialTypes.name })
        .from(credentialTypes)
        .where(inArray(credentialTypes.code, codes))
    ).map((t) => [t.code, t.name]),
  );
  const rank = (q: Qualification) => STATUS_ORDER.indexOf(q.status);
  return codes
    .flatMap((type): OtherQualification[] => {
      const mine = records
        .filter((r) => r.type === type)
        .map((r) => ({
          status: r.status,
          expiresOn: r.expiresOn,
          checkState: r.checkState,
          upload:
            r.uploadId && r.sentAt
              ? { id: r.uploadId, sentOn: localDateOf(r.sentAt, o.timeZone), reason: r.reason }
              : null,
        }));
      const state = qualificationStatus(mine, o.today);
      // Not on file: nothing to list (the shift's own page says what it needs).
      if (mine.length === 0 || state.status === "missing") return [];
      const shift = firstFor.get(type);
      if (!shift) return [];
      return [
        {
          type,
          name: names.get(type) ?? type.replace(/_/g, " ").toLowerCase(),
          neededFor: [],
          ...state,
          appliedCounts: false,
          renewing:
            (state.status === "valid" || state.status === "expiring_soon") &&
            (state.waiting !== null ||
              mine.some((r) => r.checkState === "verified" && r.status === "applied")),
          uploadable: false,
          shift: {
            role: shift.role,
            day: localDateOf(shift.startsAt, o.timeZone),
            booked: shift.booked,
          },
        },
      ];
    })
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export async function setUnavailable(
  ctx: Ctx,
  workerId: string,
  day: string,
  on: boolean,
): Promise<AvailabilityOutcome> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || addDays(day, 0) !== day) return { status: "invalid" };
  const now = (ctx.clock ?? systemClock).now();
  const today = localDateOf(now, ctx.firm.timezone);
  if (on && day < today) return { status: "past" };
  if (on && day > addDays(today, UNAVAILABLE_AHEAD_DAYS)) return { status: "too_far" };
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    // The worker's row, locked: two taps can't both slip past the 60-day cap.
    const [me] = await tx
      .select({ id: workers.id })
      .from(workers)
      .where(eq(workers.id, workerId))
      .for("no key update");
    if (!me) return { status: "invalid" };
    const event = (action: string) =>
      recordEvent(tx, {
        actorType: "worker",
        actorId: workerId,
        action,
        entityType: "worker",
        entityId: workerId,
        data: { day },
      });
    if (!on) {
      const removed = await tx
        .delete(workerUnavailableDays)
        .where(
          and(eq(workerUnavailableDays.workerId, workerId), eq(workerUnavailableDays.day, day)),
        )
        .returning({ id: workerUnavailableDays.id });
      if (removed.length === 0) return { status: "not_marked" };
      await event("worker.unavailable_removed");
      return { status: "removed", day };
    }
    const marked = await tx
      .select({ day: workerUnavailableDays.day })
      .from(workerUnavailableDays)
      .where(
        and(
          eq(workerUnavailableDays.workerId, workerId),
          gte(workerUnavailableDays.day, today),
          lte(workerUnavailableDays.day, addDays(today, UNAVAILABLE_AHEAD_DAYS)),
        ),
      );
    if (marked.some((m) => m.day === day)) return { status: "already" };
    if (marked.length >= MAX_UNAVAILABLE_DAYS) return { status: "too_many" };
    await tx.insert(workerUnavailableDays).values({ firmId: ctx.firm.id, workerId, day });
    await event("worker.unavailable_added");
    return {
      status: "added",
      day,
      bookedThatDay: (await bookedDays(tx, workerId, [day], ctx.firm.timezone)).has(day),
    };
  });
}

export async function setNotificationSettings(
  ctx: Ctx,
  workerId: string,
  settings: { notifyChannel: string; offerAlerts: boolean },
): Promise<SettingsOutcome> {
  const channel = CHANNELS.find((c) => c === settings.notifyChannel);
  if (!channel || typeof settings.offerAlerts !== "boolean") return { status: "invalid" };
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    const [before] = await tx
      .select({
        notifyChannel: workers.notifyChannel,
        offerAlerts: workers.offerAlerts,
        email: workers.email,
      })
      .from(workers)
      .where(eq(workers.id, workerId))
      .for("no key update");
    if (!before) return { status: "invalid" };
    // Email only while the firm holds their address (Phase 26.9): the page offers it only then. A
    // choice of email kept from before the address went isn't refused (only alerts may be changing).
    if (channel === "email" && !before.email && before.notifyChannel !== "email") {
      return { status: "invalid" };
    }
    if (before.notifyChannel === channel && before.offerAlerts === settings.offerAlerts) {
      return { status: "saved" };
    }
    await tx
      .update(workers)
      .set({ notifyChannel: channel, offerAlerts: settings.offerAlerts })
      .where(eq(workers.id, workerId));
    await recordEvent(tx, {
      actorType: "worker",
      actorId: workerId,
      action: "worker.notification_settings_changed",
      entityType: "worker",
      entityId: workerId,
      data: { notifyChannel: channel, offerAlerts: settings.offerAlerts },
    });
    return { status: "saved" };
  });
}
