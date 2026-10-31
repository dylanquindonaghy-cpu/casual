import { eq, inArray, sql } from "drizzle-orm";
import { firms, workers, type SheetIssues } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import type { StopReason } from "../offers/waves";
import {
  evidenceStuckSql,
  lastEvidenceCodeSql,
  NOTHING_SENT_CODES,
} from "../strikes/evidence-queue";
import { confirmedStrikesEmail } from "../strikes/team-email";

// The office's to-do queries (docs/office-v2.md 3.2, 3.9; docs/screens.md `/office`), read by the
// dashboard (src/lib/office/dashboard.ts), which checks the session and role. Reads only, inside
// the firm (RLS scopes every row to it).
//
// - loadUrgentOffers: each urgent session's offers (the latest wave, how many offered, accepted,
//   not answered yet, said no, failed, sent by the office), why the waves stopped (unless an
//   offer went in that wave or a later one since) and whether the office was emailed, for the
//   sessions the dashboard shows.
// - loadBookingsToCheck: future bookings whose casual can't work them as things stand.
// - loadSheetIssues: what the firm's rota sheet asks for that the app couldn't do.
// - loadToMark ("Who worked?"): shifts that ended in the last 7 days with people booked not marked
//   as worked or not attended yet, latest first.
// - loadEvidence: the strike evidence emails that failed (each with its record, where "Resend
//   evidence" is), and whether the strikes team's address is confirmed, with how many strikes wait
//   for it (12C.4).
// At most 50 in each list; `total` says how many in all (Phase 25.3: "Showing the first 50 of
// 400.").

export const TODAY_MARK_DAYS = 7; // "Who worked?" looks back this far
export const LIST_MAX = 50;

// An urgent session's offers (the dashboard's urgent cards), and a gap's (its charts' panels).
export interface UrgentOffers {
  wave: number | null; // the latest wave sent
  offered: number; // offers that went (waves and office)
  byOffice: number;
  accepted: number;
  waiting: number; // no answer yet (on a session still open and to come: waiting for a reply)
  declined: number; // said no
  failed: number;
  stopped: StopReason | null; // why the waves stopped, while that's still so
  escalated: boolean; // the office was emailed about it
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

// A future booking whose worker can't work it as things stand (Phase 10, audit M22): made
// inactive or blocked (by any path), or blocked from the shift's site. Shown until the office
// cancels it or keeps it (`office_kept_at`).
export interface TodayBookingToCheck {
  shiftId: string;
  workerId: string;
  worker: string;
  role: string;
  site: string | null;
  startsAt: Date;
  endsAt: Date;
  cause: "inactive" | "blocked" | "site_blocked";
}

// What the firm's Google Sheet asks for that the app couldn't do (Phase 10, audit M1, M2, L12):
// a change to a booked or started shift the rules refused, and names it couldn't book. Kept on the
// shift by each sync (shifts.sheet_issues), so it shows what's true now; until the shift ends.
export interface TodaySheetIssue {
  shiftId: string;
  role: string;
  site: string | null;
  startsAt: Date;
  endsAt: Date;
  change: {
    fields: string[];
    reason: "rules" | "settings" | "started" | "in_past";
    people: { name: string; codes: string[] }[];
  } | null;
  names: { name: string; codes: string[]; dropped: boolean }[];
}

export interface TodayEvidence {
  addressConfirmed: boolean; // the strikes team's email is set and confirmed
  waiting: number; // strikes still counting, left waiting for a confirmed address
  // Failed or held up, on strikes still counting and not withdrawn, newest first.
  failed: {
    assignmentId: string;
    casual: string;
    cancelledAt: Date;
    stuck: boolean; // held up: still pending, nothing logged for hours
    nothingSent: boolean; // its last failure proves nothing was sent
  }[];
  failedTotal: number; // how many in all (the list stops at 50)
}

// Each shift's offers (the latest wave, how many went, by the office, accepted, not answered yet,
// said no, failed), why the waves stopped (only while no offer has gone in that wave or a later
// one) and whether the office was emailed: one query for all the shifts given.
export async function loadUrgentOffers(
  tx: FirmTx,
  shiftIds: string[],
): Promise<Map<string, UrgentOffers>> {
  if (shiftIds.length === 0) return new Map();
  const { rows } = await tx.execute<{
    shift_id: string;
    wave: number | null;
    offered: number;
    by_office: number;
    accepted: number;
    waiting: number;
    declined: number;
    failed: number;
    stopped: string | null;
    stopped_wave: number | null;
    escalated: boolean;
  }>(sql`
    select x.id::text as shift_id, o.wave, o.offered, o.by_office, o.accepted, o.waiting,
           o.declined, o.failed,
           st.reason as stopped, st.wave as stopped_wave,
           exists (select 1 from events e
                    where e.entity_id = x.id and e.action = 'shift.escalated') as escalated
      from unnest(array[${sql.join(
        shiftIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}]) as x(id)
      cross join lateral (
        select max(o.wave) as wave,
               count(*) filter (where o.response is distinct from 'failed')::int as offered,
               count(*) filter (where o.wave is null
                                  and o.response is distinct from 'failed')::int as by_office,
               count(*) filter (where o.response = 'accepted')::int as accepted,
               count(*) filter (where o.response is null)::int as waiting,
               count(*) filter (where o.response = 'declined')::int as declined,
               count(*) filter (where o.response = 'failed')::int as failed
          from offers o
         where o.shift_id = x.id
      ) o
      left join lateral (
        select e.data ->> 'reason' as reason, (e.data ->> 'wave')::int as wave
          from events e
         where e.entity_id = x.id and e.action = 'offer.waves_stopped'
         order by e.id desc
         limit 1
      ) st on true
  `);
  return new Map(
    rows.map((o) => {
      // The waves stopped at the wave the stop names, before sending it. If an offer went in that
      // wave or a later one, a second dropout started them again: the stop is old news.
      const stoppedNow =
        o.stopped != null && o.stopped_wave != null && (o.wave ?? 0) < o.stopped_wave;
      return [
        o.shift_id,
        {
          wave: o.wave,
          offered: o.offered,
          byOffice: o.by_office,
          accepted: o.accepted,
          waiting: o.waiting,
          declined: o.declined,
          failed: o.failed,
          stopped: stoppedNow ? (o.stopped as StopReason) : null,
          escalated: o.escalated,
        },
      ];
    }),
  );
}

// Future bookings whose casual can't work them as things stand (made inactive or blocked, or
// blocked from the site), until the office cancels or keeps them; at most 50.
export async function loadBookingsToCheck(
  tx: FirmTx,
  now: Date,
): Promise<{ items: TodayBookingToCheck[]; total: number }> {
  const { rows: toCheck } = await tx.execute<{
    shift_id: string;
    worker_id: string;
    first_name: string;
    last_name: string;
    worker_status: "active" | "inactive" | "blocked";
    role: string;
    starts_at: string | Date;
    ends_at: string | Date;
    site_name: string | null;
    total: number;
  }>(sql`
    select a.shift_id, a.worker_id, w.first_name, w.last_name, w.status as worker_status,
           s.role, s.starts_at, s.ends_at, si.name as site_name, (count(*) over ())::int as total
      from assignments a
      join workers w on w.firm_id = a.firm_id and w.id = a.worker_id
      join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
      left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
     where a.status = 'confirmed' and a.office_kept_at is null
       and s.starts_at > ${now} and s.status in ('open', 'filled')
       and (w.status <> 'active'
            or exists (select 1 from worker_site_blocks b
                        where b.firm_id = a.firm_id and b.worker_id = a.worker_id
                          and b.site_id = s.site_id))
     order by s.starts_at, w.last_name, w.first_name, a.id
     limit ${LIST_MAX}
  `);
  return {
    total: toCheck[0]?.total ?? 0,
    items: toCheck.map((b) => ({
      shiftId: b.shift_id,
      workerId: b.worker_id,
      worker: `${b.first_name} ${b.last_name}`,
      role: b.role,
      site: b.site_name,
      startsAt: new Date(b.starts_at),
      endsAt: new Date(b.ends_at),
      cause: b.worker_status === "active" ? "site_blocked" : b.worker_status,
    })),
  };
}

// What the firm's rota sheet asks for that the app couldn't do, until the shift ends; at most 50.
export async function loadSheetIssues(
  tx: FirmTx,
  now: Date,
): Promise<{ items: TodaySheetIssue[]; total: number }> {
  const { rows: sheetRows } = await tx.execute<{
    id: string;
    role: string;
    starts_at: string | Date;
    ends_at: string | Date;
    site_name: string | null;
    sheet_issues: SheetIssues;
    total: number;
  }>(sql`
    select s.id, s.role, s.starts_at, s.ends_at, si.name as site_name, s.sheet_issues,
           (count(*) over ())::int as total
      from shifts s
      left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
     where s.sheet_issues is not null and s.status <> 'cancelled'
       -- Until the shift ends; a change refused because ours had started stays while the sheet's
       -- wanted start is still ahead (a row id reused for a new date: it needs a new id).
       and (s.ends_at > ${now}
            or (s.sheet_issues -> 'change' ->> 'reason' = 'started'
                and (s.sheet_issues -> 'change' -> 'wanted' ->> 'startsAt')::timestamptz > ${now}))
     order by s.starts_at, s.id
     limit ${LIST_MAX}
  `);
  const sheetWorkerIds = [
    ...new Set(
      sheetRows.flatMap((r) => [
        ...(r.sheet_issues.change?.workers ?? []).map((w) => w.workerId),
        ...(r.sheet_issues.names ?? []).map((n) => n.workerId),
      ]),
    ),
  ];
  const sheetNames = new Map(
    sheetWorkerIds.length === 0
      ? []
      : (
          await tx
            .select({ id: workers.id, first: workers.firstName, last: workers.lastName })
            .from(workers)
            .where(inArray(workers.id, sheetWorkerIds))
        ).map((w) => [w.id, `${w.first} ${w.last}`]),
  );
  const nameOf = (id: string) => sheetNames.get(id) ?? "Someone";
  return {
    total: sheetRows[0]?.total ?? 0,
    items: sheetRows.map((r) => ({
      shiftId: r.id,
      role: r.role,
      site: r.site_name,
      startsAt: new Date(r.starts_at),
      endsAt: new Date(r.ends_at),
      change: r.sheet_issues.change
        ? {
            fields: r.sheet_issues.change.fields,
            reason: r.sheet_issues.change.reason,
            people: r.sheet_issues.change.workers.map((w) => ({
              name: nameOf(w.workerId),
              codes: w.codes,
            })),
          }
        : null,
      names: (r.sheet_issues.names ?? []).map((n) => ({
        name: nameOf(n.workerId),
        codes: n.codes,
        dropped: n.dropped === true,
      })),
    })),
  };
}

// "Who worked?": shifts that ended in the last 7 days with people not marked yet; at most 50.
export async function loadToMark(
  tx: FirmTx,
  now: Date,
): Promise<{ items: TodayToMark[]; total: number }> {
  const { rows: toMark } = await tx.execute<{
    id: string;
    role: string;
    starts_at: string | Date;
    ends_at: string | Date;
    site_name: string | null;
    unmarked: number;
    total: number;
  }>(sql`
    select s.id, s.role, s.starts_at, s.ends_at, si.name as site_name, count(a.id)::int as unmarked,
           (count(*) over ())::int as total
      from shifts s
      join assignments a on a.firm_id = s.firm_id and a.shift_id = s.id and a.status = 'confirmed'
      left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
     where s.ends_at <= ${now}
       and s.ends_at > ${new Date(now.getTime() - TODAY_MARK_DAYS * 24 * 3_600_000)}
     group by s.id, si.name
     order by s.ends_at desc, s.id
     limit ${LIST_MAX}
  `);
  return {
    total: toMark[0]?.total ?? 0,
    items: toMark.map((t) => ({
      shiftId: t.id,
      role: t.role,
      site: t.site_name,
      startsAt: new Date(t.starts_at),
      endsAt: new Date(t.ends_at),
      unmarked: t.unmarked,
    })),
  };
}

// The strike evidence emails that failed or are held up, and the strikes team's address (12C.4).
export async function loadEvidence(tx: FirmTx, now: Date): Promise<TodayEvidence> {
  const [firm] = await tx
    .select({ settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  const { rows: failed } = await tx.execute<{
    assignment_id: string;
    first_name: string | null;
    last_name: string | null;
    cancelled_at: string | Date;
    stuck: boolean;
    code: string | null;
    total: number;
  }>(sql`
    select f.*, (count(*) over ())::int as total from (
      select a.id::text as assignment_id, w.first_name, w.last_name, a.cancelled_at,
             s.issued_at, s.id, coalesce(${evidenceStuckSql("s")}, false) as stuck,
             ${lastEvidenceCodeSql("s")} as code, s.evidence_email_status as evidence
        from strikes s
        join assignments a on a.firm_id = s.firm_id and a.id = s.assignment_id
        join workers w on w.firm_id = s.firm_id and w.id = s.worker_id
       where s.status = 'live' and s.expires_at > ${now}
         and s.evidence_email_status in ('failed', 'pending')
    ) f
     where f.evidence = 'failed' or f.stuck
     order by f.issued_at desc, f.id
     limit ${LIST_MAX}
  `);
  const { rows: waiting } = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from strikes
     where evidence_email_status = 'not_set_up' and status = 'live' and expires_at > ${now}
  `);
  return {
    addressConfirmed: confirmedStrikesEmail(firm?.settings ?? {}) !== null,
    waiting: Number(waiting[0]?.n ?? 0),
    failed: failed.map((f) => ({
      assignmentId: f.assignment_id,
      casual: `${f.first_name ?? ""} ${f.last_name ?? ""}`.trim() || "A casual",
      cancelledAt: new Date(f.cancelled_at),
      stuck: f.stuck,
      nothingSent: f.code !== null && NOTHING_SENT_CODES.includes(f.code),
    })),
    failedTotal: failed[0]?.total ?? 0,
  };
}
