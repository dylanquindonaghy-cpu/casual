import { eq, sql } from "drizzle-orm";
import { authParts, type AuthContext } from "../auth/link-login";
import { currentOfficeUser } from "../auth/office-login";
import { canAccess, type OfficeRole } from "../auth/roles";
import { CANCELLED_ASSIGNMENT_STATUSES, firms, REQUEST_TYPES } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { addDays, localDateOf } from "../time/zoned";

// The office's Today view (docs/screens.md `/office/today`; product spec: "one screen showing
// today's gaps, urgent shifts, cancellations and requests so that nothing is missed"). For admins
// and resourcers: the session and role are checked here as well as on the page, so the data can't
// be reached another way. Reads only, inside the firm (RLS scopes every row to it).
//
// - urgent: urgent shifts that haven't started and still have a place free, with their offers
//   (the latest wave, how many offered, accepted, failed, sent by the office), why the waves
//   stopped (unless an offer went in that wave or a later one since) and whether the office was
//   emailed.
// - gaps: other open shifts in the next 7 days with a place free.
// - cancellations: bookings cancelled in the last 24 hours, newest first, with notice hours.
// - toMark ("Who worked?"): shifts that ended in the last 7 days with people booked not marked as
//   worked or not attended yet, latest first.
// - requests: open requests (and escalated ones) by kind.
// - expiring: credentials of active workers expiring in the next 7 days (the firm's calendar),
//   leaving out one the worker has already renewed.
// - unknownMessages: WhatsApps on the shifts line in the last 7 days from numbers that aren't one of
//   the firm's active workers, newest first: the number, their words, when, and the name when the
//   number is a former worker's (Phase 7; the office was emailed about the first from each number).
// At most 50 in each list; `more` says there were others.

export const TODAY_GAP_DAYS = 7;
export const TODAY_MARK_DAYS = 7; // "Who worked?" looks back this far
export const TODAY_UNKNOWN_DAYS = 7; // messages from numbers we don't know
const LIST_MAX = 50;
const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));

export interface TodayShift {
  shiftId: string;
  role: string;
  site: string | null;
  startsAt: Date;
  endsAt: Date;
  headcount: number;
  placesLeft: number;
  isUrgent: boolean;
  fromSheet: boolean; // its status is changed in the Google Sheet
}

export interface UrgentShift extends TodayShift {
  wave: number | null; // the latest wave sent
  offered: number; // offers that went (waves and office)
  byOffice: number;
  accepted: number;
  failed: number;
  stopped: "filled" | "started" | "not_open" | "not_urgent" | "no_candidates" | null;
  escalated: boolean;
}

export interface TodayCancellation {
  assignmentId: string;
  worker: string;
  shiftId: string;
  role: string;
  site: string | null;
  startsAt: Date;
  endsAt: Date;
  cancelledAt: Date;
  noticeHours: number;
  byFirm: boolean;
  reason: string | null;
}

// A shift that ended with people on it not marked as worked or didn't attend yet.
export interface TodayToMark {
  shiftId: string;
  role: string;
  site: string | null;
  startsAt: Date;
  endsAt: Date;
  unmarked: number;
}

export interface TodayExpiry {
  worker: string;
  credential: string;
  expiresOn: string; // yyyy-mm-dd
}

export interface TodayUnknownMessage {
  messageId: string;
  channel: "whatsapp" | "sms" | "voice"; // voice: a voicemail
  from: string | null; // E.164; null: a withheld number
  text: string | null; // null: a photo or file with no text, or a voicemail not turned into text
  receivedAt: Date;
  formerWorker: string | null; // "Ann Booker", when the number was a worker's who wasn't active
  formerWorkerActive: boolean; // they've been made active again since
}

export interface TodayView {
  officeUser: { id: string; name: string; role: OfficeRole };
  timeZone: string;
  urgent: UrgentShift[];
  gaps: TodayShift[];
  gapsMore: boolean;
  cancellations: TodayCancellation[];
  toMark: TodayToMark[]; // shifts that ended in the last 7 days
  toMarkMore: boolean; // more than the list shows
  requests: { total: number; byType: Partial<Record<(typeof REQUEST_TYPES)[number], number>> };
  expiring: TodayExpiry[];
  unknownMessages: TodayUnknownMessage[];
  unknownMore: boolean;
}

type ShiftRow = {
  id: string;
  role: string;
  site_name: string | null;
  starts_at: string | Date;
  ends_at: string | Date;
  headcount: number;
  taken: number;
  is_urgent: boolean;
  source: string;
};

const shiftOf = (r: ShiftRow): TodayShift => ({
  shiftId: r.id,
  role: r.role,
  site: r.site_name,
  startsAt: new Date(r.starts_at),
  endsAt: new Date(r.ends_at),
  headcount: r.headcount,
  placesLeft: Math.max(0, r.headcount - r.taken),
  isUrgent: r.is_urgent,
  fromSheet: r.source === "sheets",
});

// Open shifts with a place free, starting after now (and, for gaps, within the window).
const openShifts = (tx: FirmTx, where: ReturnType<typeof sql>, limit: number) =>
  tx.execute<ShiftRow>(sql`
    select * from (
      select s.id, s.role, si.name as site_name, s.starts_at, s.ends_at, s.headcount,
             s.is_urgent, s.source,
             (select count(*)::int from assignments a
               where a.shift_id = s.id and a.worker_id is not null
                 and a.status not in (${CANCELLED}) and a.slot <= s.headcount) as taken
        from shifts s
        left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
       where s.status = 'open' and ${where}
    ) open_shifts
     where taken < headcount
     order by starts_at, id
     limit ${limit}
  `);

export async function loadToday(tx: FirmTx, now: Date): Promise<Omit<TodayView, "officeUser">> {
  const [firm] = await tx
    .select({ timezone: firms.timezone })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  const timeZone = firm?.timezone ?? "Europe/London";
  const gapsUntil = new Date(now.getTime() + TODAY_GAP_DAYS * 24 * 3_600_000);

  const urgentRows = await openShifts(tx, sql`s.is_urgent and s.starts_at > ${now}`, LIST_MAX);
  const urgent: UrgentShift[] = [];
  for (const r of urgentRows.rows) {
    const { rows } = await tx.execute<{
      wave: number | null;
      offered: number;
      by_office: number;
      accepted: number;
      failed: number;
      stopped: string | null;
      stopped_wave: number | null;
      escalated: boolean;
    }>(sql`
      select max(o.wave) as wave,
             count(*) filter (where o.response is distinct from 'failed')::int as offered,
             count(*) filter (where o.wave is null
                                and o.response is distinct from 'failed')::int as by_office,
             count(*) filter (where o.response = 'accepted')::int as accepted,
             count(*) filter (where o.response = 'failed')::int as failed,
             (select e.data ->> 'reason' from events e
               where e.entity_id = ${r.id} and e.action = 'offer.waves_stopped'
               order by e.id desc limit 1) as stopped,
             (select (e.data ->> 'wave')::int from events e
               where e.entity_id = ${r.id} and e.action = 'offer.waves_stopped'
               order by e.id desc limit 1) as stopped_wave,
             exists (select 1 from events e
                      where e.entity_id = ${r.id} and e.action = 'shift.escalated') as escalated
        from offers o
       where o.shift_id = ${r.id}
    `);
    const o = rows[0];
    // The waves stopped at the wave the stop names, before sending it. If an offer went in that wave
    // or a later one, a second dropout started them again: the stop is old news.
    const stoppedNow =
      o?.stopped != null && o.stopped_wave != null && (o.wave ?? 0) < o.stopped_wave;
    urgent.push({
      ...shiftOf(r),
      wave: o?.wave ?? null,
      offered: o?.offered ?? 0,
      byOffice: o?.by_office ?? 0,
      accepted: o?.accepted ?? 0,
      failed: o?.failed ?? 0,
      stopped: stoppedNow ? (o?.stopped as UrgentShift["stopped"]) : null,
      escalated: o?.escalated ?? false,
    });
  }

  const gapRows = await openShifts(
    tx,
    sql`not s.is_urgent and s.starts_at > ${now} and s.starts_at <= ${gapsUntil}`,
    LIST_MAX + 1,
  );

  const { rows: cancelled } = await tx.execute<{
    id: string;
    status: string;
    cancelled_at: string | Date;
    notice_hours: string | number | null;
    cancel_reason: string | null;
    first_name: string;
    last_name: string;
    shift_id: string;
    role: string;
    starts_at: string | Date;
    ends_at: string | Date;
    site_name: string | null;
  }>(sql`
    select a.id, a.status, a.cancelled_at, a.notice_hours, a.cancel_reason,
           w.first_name, w.last_name, s.id as shift_id, s.role, s.starts_at, s.ends_at,
           si.name as site_name
      from assignments a
      join workers w on w.firm_id = a.firm_id and w.id = a.worker_id
      join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
      left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
     where a.status in (${CANCELLED})
       and a.cancelled_at >= ${new Date(now.getTime() - 24 * 3_600_000)}
       and a.cancelled_at <= ${now}
     order by a.cancelled_at desc, a.id
     limit ${LIST_MAX}
  `);

  const { rows: toMark } = await tx.execute<{
    id: string;
    role: string;
    starts_at: string | Date;
    ends_at: string | Date;
    site_name: string | null;
    unmarked: number;
  }>(sql`
    select s.id, s.role, s.starts_at, s.ends_at, si.name as site_name, count(a.id)::int as unmarked
      from shifts s
      join assignments a on a.firm_id = s.firm_id and a.shift_id = s.id and a.status = 'confirmed'
      left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
     where s.ends_at <= ${now}
       and s.ends_at > ${new Date(now.getTime() - TODAY_MARK_DAYS * 24 * 3_600_000)}
     group by s.id, si.name
     order by s.ends_at desc, s.id
     limit ${LIST_MAX + 1}
  `);

  const { rows: requestRows } = await tx.execute<{ type: string; n: number }>(sql`
    select type, count(*)::int as n from requests
     where status in ('open', 'escalated')
     group by type
  `);
  const byType: TodayView["requests"]["byType"] = {};
  let total = 0;
  for (const r of requestRows) {
    if ((REQUEST_TYPES as readonly string[]).includes(r.type)) {
      byType[r.type as (typeof REQUEST_TYPES)[number]] = r.n;
      total += r.n;
    }
  }

  const today = localDateOf(now, timeZone);
  const { rows: expiring } = await tx.execute<{
    first_name: string;
    last_name: string;
    type: string;
    type_name: string | null;
    expires_on: string;
  }>(sql`
    select w.first_name, w.last_name, c.type, ct.name as type_name, c.expires_on::text as expires_on
      from credentials c
      join workers w on w.firm_id = c.firm_id and w.id = c.worker_id
      left join credential_types ct on ct.firm_id = c.firm_id and ct.code = c.type
     where w.status = 'active' and c.status = 'valid'
       and c.expires_on >= ${today}::date and c.expires_on <= ${addDays(today, TODAY_GAP_DAYS)}::date
       and not exists (
         select 1 from credentials n
          where n.firm_id = c.firm_id and n.worker_id = c.worker_id and n.type = c.type
            and n.id <> c.id and n.status = 'valid'
            and (n.expires_on is null or n.expires_on > c.expires_on))
     order by c.expires_on, w.last_name, w.first_name
     limit ${LIST_MAX}
  `);

  const { rows: unknown } = await tx.execute<{
    id: string;
    channel: "whatsapp" | "sms" | "voice";
    from_e164: string | null;
    body: string | null;
    created_at: string | Date;
    first_name: string | null;
    last_name: string | null;
    worker_status: string | null;
  }>(sql`
    select m.id, m.channel, m.from_e164, m.body, m.created_at, w.first_name, w.last_name,
           w.status as worker_status
      from messages m
      left join workers w on w.firm_id = m.firm_id and w.id = m.worker_id
     where m.direction = 'in' and m.handled_as = 'unknown'
       and m.created_at > ${new Date(now.getTime() - TODAY_UNKNOWN_DAYS * 86_400_000)}
     order by m.created_at desc, m.id
     limit ${LIST_MAX + 1}
  `);

  return {
    timeZone,
    urgent,
    gaps: gapRows.rows.slice(0, LIST_MAX).map(shiftOf),
    gapsMore: gapRows.rows.length > LIST_MAX,
    cancellations: cancelled.map((c) => ({
      assignmentId: c.id,
      worker: `${c.first_name} ${c.last_name}`,
      shiftId: c.shift_id,
      role: c.role,
      site: c.site_name,
      startsAt: new Date(c.starts_at),
      endsAt: new Date(c.ends_at),
      cancelledAt: new Date(c.cancelled_at),
      noticeHours: Number(c.notice_hours ?? 0),
      byFirm: c.status === "cancelled_firm",
      reason: c.cancel_reason,
    })),
    toMarkMore: toMark.length > LIST_MAX,
    toMark: toMark.slice(0, LIST_MAX).map((t) => ({
      shiftId: t.id,
      role: t.role,
      site: t.site_name,
      startsAt: new Date(t.starts_at),
      endsAt: new Date(t.ends_at),
      unmarked: t.unmarked,
    })),
    requests: { total, byType },
    expiring: expiring.map((e) => ({
      worker: `${e.first_name} ${e.last_name}`,
      credential: e.type_name ?? e.type.replace(/_/g, " "),
      expiresOn: e.expires_on,
    })),
    unknownMore: unknown.length > LIST_MAX,
    unknownMessages: unknown.slice(0, LIST_MAX).map((u) => ({
      messageId: u.id,
      channel: u.channel,
      from: u.from_e164,
      text: u.body,
      receivedAt: new Date(u.created_at),
      formerWorker: u.first_name !== null ? `${u.first_name} ${u.last_name}` : null,
      formerWorkerActive: u.worker_status === "active",
    })),
  };
}

// Today for the logged-in office user, or null (logged out, or a role without Today).
export async function todayView(ctx: AuthContext, token: string): Promise<TodayView | null> {
  const me = await currentOfficeUser(ctx, token);
  if (!me || !canAccess(me.officeUser.role, "today")) return null;
  const { run, now } = authParts(ctx);
  const view = await run(ctx.firm.id, (tx) => loadToday(tx, now));
  return { officeUser: me.officeUser, ...view };
}
