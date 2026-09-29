import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { credentials, credentialTypes, workers, workerUnavailableDays } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { withFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { addDays, localDateOf } from "../time/zoned";
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
// - myProfile: contact details and credentials as the office holds them (read-only here; an
//   expired one already replaced or being renewed is left out), the days marked unavailable from
//   today on (with whether a booking falls on each), and the notification settings.
// - setUnavailable: mark or clear one firm-local day, today to 180 days ahead, at most 60 marked.
//   Marking never touches a booking already made that day (a cancellation must be deliberate);
//   the answer says if there is one. The rules engine's check 8 uses these days.
// - setNotificationSettings: WhatsApp or text message, and whether to hear about open shifts.
// Every change is logged with dates and choices only (golden rule 5).

type Ctx = PortalContext & { firm: { id: string; timezone: string } };

export interface ProfileCredential {
  type: string;
  name: string;
  status: "valid" | "expired" | "applied" | "suspended";
  expiresOn: string | null;
  expired: boolean; // marked expired, or valid with its date gone
}

export interface Profile {
  firstName: string;
  lastName: string;
  mobile: string;
  email: string | null;
  notifyChannel: Channel;
  offerAlerts: boolean;
  textsOff: boolean; // they replied STOP to a text: no texts until they reply START
  credentials: ProfileCredential[];
  unavailable: { day: string; booked: boolean }[];
  today: string;
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
    if (!me) return null;
    const held = await tx
      .select({
        type: credentials.type,
        status: credentials.status,
        expiresOn: credentials.expiresOn,
        name: credentialTypes.name,
      })
      .from(credentials)
      .leftJoin(
        credentialTypes,
        and(
          eq(credentialTypes.firmId, credentials.firmId),
          eq(credentialTypes.code, credentials.type),
        ),
      )
      .where(eq(credentials.workerId, workerId))
      .orderBy(asc(credentials.type), asc(credentials.expiresOn));
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
    const shown = held.map((c) => ({
      type: c.type,
      name: c.name ?? c.type.replace(/_/g, " "),
      status: c.status,
      expiresOn: c.expiresOn,
      expired:
        c.status === "expired" ||
        (c.status === "valid" && c.expiresOn !== null && c.expiresOn < today),
    }));
    // An expired one the worker has replaced (a valid one in date) or is renewing (applied for)
    // isn't shown: it no longer stops them working (as the home page's notices).
    const covered = new Set(
      shown
        .filter((c) => (c.status === "valid" && !c.expired) || c.status === "applied")
        .map((c) => c.type),
    );
    const { smsOptedOutAt, ...contact } = me;
    return {
      ...contact,
      textsOff: smsOptedOutAt !== null,
      credentials: shown.filter((c) => !(c.expired && covered.has(c.type))),
      unavailable: days.map(({ day }) => ({ day, booked: booked.has(day) })),
      today,
    };
  });
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
      .select({ notifyChannel: workers.notifyChannel, offerAlerts: workers.offerAlerts })
      .from(workers)
      .where(eq(workers.id, workerId))
      .for("no key update");
    if (!before) return { status: "invalid" };
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
