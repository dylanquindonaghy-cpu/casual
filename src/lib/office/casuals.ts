import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { qualificationsFor } from "../credentials/qualifications";
import type { NeedsItem, Qualification } from "../credentials/status";
import {
  credentialTypes,
  firms,
  uploads,
  workers,
  type TravelMode,
  type UploadKind,
} from "../db/schema";
import type { FirmTx } from "../db/scoped";
import type { StaffPhoto } from "../uploads/photo";
import {
  followUps,
  latestNotes,
  REMIND_ALL_MAX,
  REMIND_GAP_HOURS,
  remindable,
} from "./casual-follow-up";
import { officeUserMay, parts, type OfficeContext } from "./office-context";
import { loadCasualRecords, type CasualRecord } from "./reliability";
import { travelSettings } from "../travel/settings";

// The Casuals list (docs/office-v2.md 3.7; docs/screens.md `/office/casuals`; 12F.1), for admins and
// resourcers (checked here as well as on the page). Every casual the firm holds (not erased), by
// name, with their qualifications (worst first: src/lib/credentials/status.ts), travel district
// (never the postcode: it's cut out in the database), live strikes and what needs updating.
//
// Views, each with its count: All; Need updating (active casuals with something to update, the
// worst first: one stopping a booked shift, then expired, expiring soon, missing; an inactive or
// blocked casual can't work, so isn't "to update"); and Uploads to check (12F.2: every photo and
// certificate image waiting for the office, oldest first, whoever sent it). Each casual has their
// staff photo (src/lib/uploads/photo.ts). Reads only (never an image's bytes); a fixed number of
// queries however many casuals.

export const CASUAL_VIEWS = [
  "all",
  "regulars",
  "reliable",
  "cancel_often",
  "not_worked",
  "needs",
  "uploads",
] as const;
export type CasualView = (typeof CASUAL_VIEWS)[number];
export const CASUALS_PAGE_MAX = 200;
// How the list is sorted (cas-3): Need updating starts with the most urgent, the rest by name.
export const CASUAL_SORTS = ["default", "least_reliable", "last_worked", "strikes"] as const;
export type CasualSort = (typeof CASUAL_SORTS)[number];

export interface CasualRow {
  id: string;
  name: string;
  roles: string[];
  status: "active" | "inactive" | "blocked";
  qualifications: Qualification[];
  travel: { district: string; maxMinutes: number; modes: TravelMode } | null;
  liveStrikes: number;
  needs: NeedsItem[];
  rolesWithoutRule: string[]; // roles the firm has no rule for (those shifts can't be taken)
  photo: StaffPhoto;
  // Phase 26.7: their record (reliability over 90 days, standing, last worked: decision 3).
  record: CasualRecord;
  mobile: string | null; // for "Call" (E.164)
  photoNeeds: boolean; // a missing or overdue staff photo needs updating (cas-5)
  // The worst out-of-date or expiring qualification "Remind" would message them about.
  remindAbout: string | null; // its type
  lastReminder: { by: string | null; at: Date } | null; // by null: sent automatically
  sorted: { by: string; at: Date } | null; // "Mark as sorted", while what it was about stands
  note: { body: string; by: string; at: Date } | null; // the office's latest note
}

// One upload waiting for the office (Uploads to check).
export interface WaitingUpload {
  id: string;
  workerId: string;
  name: string;
  kind: UploadKind;
  qualificationType: string | null;
  qualificationName: string | null; // as stored, mid-sentence
  sentAt: Date;
}

export interface CasualsList {
  view: CasualView;
  sort: CasualSort;
  counts: Record<CasualView, number>;
  withFigure: number; // active casuals with a reliability figure (Reliable's "of N who worked")
  remindAll: string[]; // Need updating's casuals "Remind all" would remind now
  rows: CasualRow[]; // All and Need updating
  uploads: WaitingUpload[]; // Uploads to check
  more: boolean; // more than CASUALS_PAGE_MAX in the view
  // The firm has travel areas on (13.4): only then is the travel area column shown (and read).
  travelOn: boolean;
}

// Every upload waiting for the office, oldest first (casuals not erased: theirs are deleted).
// Also Needs attention's "Uploads to check", each by name and time (Phase 20).
export async function waitingUploads(tx: FirmTx, limit: number): Promise<WaitingUpload[]> {
  const rows = await tx
    .select({
      id: uploads.id,
      workerId: uploads.workerId,
      firstName: workers.firstName,
      lastName: workers.lastName,
      kind: uploads.kind,
      qualificationType: uploads.credentialType,
      qualificationName: credentialTypes.name,
      sentAt: uploads.createdAt,
    })
    .from(uploads)
    .innerJoin(workers, and(eq(workers.firmId, uploads.firmId), eq(workers.id, uploads.workerId)))
    .leftJoin(
      credentialTypes,
      and(
        eq(credentialTypes.firmId, uploads.firmId),
        eq(credentialTypes.code, uploads.credentialType),
      ),
    )
    .where(and(eq(uploads.status, "waiting"), isNull(workers.erasedAt)))
    .orderBy(asc(uploads.createdAt), asc(uploads.id))
    .limit(limit);
  return rows.map(({ firstName, lastName, ...r }) => ({ ...r, name: `${firstName} ${lastName}` }));
}

// Uploads waiting for the office's check (the Casuals badge, and Needs attention on the dashboard).
export async function waitingCount(tx: FirmTx): Promise<number> {
  const { rows } = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n
      from uploads u
      join workers w on w.firm_id = u.firm_id and w.id = u.worker_id
     where u.status = 'waiting' and w.erased_at is null
  `);
  return Number(rows[0]?.n ?? 0);
}

// Every upload waiting for the office (waitingCount's), by the firm's calendar day it was sent
// (yyyy-mm-dd), oldest first: the dashboard's waiting chart, which needs them all, not the first
// LIST_MAX Needs attention names.
export async function waitingUploadDays(
  tx: FirmTx,
  timeZone: string,
): Promise<{ day: string; count: number }[]> {
  const { rows } = await tx.execute<{ day: string; n: number }>(sql`
    select to_char(u.created_at at time zone ${timeZone}, 'YYYY-MM-DD') as day, count(*)::int as n
      from uploads u
      join workers w on w.firm_id = u.firm_id and w.id = u.worker_id
     where u.status = 'waiting' and w.erased_at is null
     group by 1
     order by 1
  `);
  return rows.map((r) => ({ day: r.day, count: Number(r.n) }));
}

export async function casualsList(
  ctx: OfficeContext,
  view: CasualView,
  sort: CasualSort = "default",
): Promise<CasualsList | null> {
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "casuals"))) return null;
    const [firm] = await tx
      .select({ timezone: firms.timezone, settings: firms.settings })
      .from(firms)
      .where(eq(firms.id, ctx.firm.id));
    const travelOn = travelSettings(firm?.settings ?? {}).enabled;
    const people = await tx
      .select({
        id: workers.id,
        firstName: workers.firstName,
        lastName: workers.lastName,
        roles: workers.roles,
        status: workers.status,
        mobile: workers.mobileE164,
      })
      .from(workers)
      .where(isNull(workers.erasedAt))
      .orderBy(asc(workers.lastName), asc(workers.firstName), asc(workers.id));
    const ids = people.map((p) => p.id);
    const held = await qualificationsFor(tx, ids, {
      now,
      timeZone: firm?.timezone ?? "Europe/London",
      people,
    });
    const { rows: travel } = travelOn
      ? await tx.execute<{
          worker_id: string;
          district: string;
          max_minutes: number;
          modes: TravelMode;
        }>(sql`
          select t.worker_id::text, split_part(t.start_postcode, ' ', 1) as district,
                 t.max_minutes, t.modes
            from worker_travel t
        `)
      : { rows: [] };
    const travelOf = new Map(travel.map((t) => [t.worker_id, t]));
    const { rows: strikes } = await tx.execute<{ worker_id: string; live: number }>(sql`
      select st.worker_id::text, count(*)::int as live
        from strikes st
       where st.status = 'live' and st.expires_at > ${now}
       group by st.worker_id
    `);
    const liveOf = new Map(strikes.map((s) => [s.worker_id, Number(s.live)]));
    const records = await loadCasualRecords(tx, now, null);
    const follow = await followUps(tx, ids);
    const notes = await latestNotes(tx, ids);
    const since = now.getTime() - REMIND_GAP_HOURS * 3_600_000;
    const all: CasualRow[] = people.map((p) => {
      const t = travelOf.get(p.id);
      const q = held.get(p.id);
      const needs = q?.needs ?? [];
      const photo = q?.photo ?? { status: "missing" as const, current: null, waiting: null };
      const photoNeeds = photo.status === "missing" || photo.status === "overdue";
      const worst = needs[0]
        ? { type: needs[0].qualification.type, status: needs[0].qualification.status }
        : photoNeeds
          ? { type: "photo", status: photo.status }
          : null;
      const sortedAt = follow.sorted.get(p.id);
      return {
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        roles: [...p.roles],
        status: p.status,
        qualifications: q?.qualifications ?? [],
        travel: t
          ? { district: t.district, maxMinutes: Number(t.max_minutes), modes: t.modes }
          : null,
        liveStrikes: liveOf.get(p.id) ?? 0,
        needs,
        rolesWithoutRule: q?.rolesWithoutRule ?? [],
        photo,
        record: records.get(p.id) ?? emptyRecord(p.id),
        mobile: p.mobile,
        photoNeeds,
        remindAbout: remindable(needs)?.qualification.type ?? null,
        lastReminder: follow.reminders.get(p.id) ?? null,
        // Sorted while the worst thing it was about still stands (a new problem shows again).
        sorted:
          sortedAt && worst && sortedAt.type === worst.type && sortedAt.status === worst.status
            ? { by: sortedAt.by, at: sortedAt.at }
            : null,
        note: notes.get(p.id) ?? null,
      };
    });
    const active = all.filter((r) => r.status === "active");
    // Need updating: the worst first (by level, then the booked shift it stops soonest), a photo
    // alone after them, and the office's "sorted" ones last; then by name.
    const needing = active
      .filter((r) => r.needs.length > 0 || r.photoNeeds)
      .sort(
        (a, b) =>
          Number(a.sorted !== null) - Number(b.sorted !== null) ||
          (a.needs[0]?.level ?? 9) - (b.needs[0]?.level ?? 9) ||
          (a.needs[0]?.blocks?.day ?? "").localeCompare(b.needs[0]?.blocks?.day ?? ""),
      );
    const views: Record<Exclude<CasualView, "uploads">, CasualRow[]> = {
      all,
      regulars: active.filter((r) => r.record.standing.regular),
      reliable: active.filter((r) => r.record.standing.reliable),
      cancel_often: active.filter((r) => r.record.standing.cancelOften),
      not_worked: active.filter((r) => r.record.standing.notWorkedLately),
      needs: needing,
    };
    const waiting = await waitingCount(tx);
    const counts: Record<CasualView, number> = {
      all: all.length,
      regulars: views.regulars.length,
      reliable: views.reliable.length,
      cancel_often: views.cancel_often.length,
      not_worked: views.not_worked.length,
      needs: needing.length,
      uploads: waiting,
    };
    // At most REMIND_ALL_MAX at a time (the server's limit); pressing again reaches the rest, as
    // those just reminded drop out for 24 hours.
    const remindAll = needing
      .filter(
        (r) =>
          r.remindAbout !== null &&
          r.sorted === null &&
          (r.lastReminder === null || r.lastReminder.at.getTime() <= since),
      )
      .map((r) => r.id)
      .slice(0, REMIND_ALL_MAX);
    const base = {
      view,
      sort,
      counts,
      withFigure: active.filter((r) => r.record.reliability.kind === "figure").length,
      remindAll,
      travelOn,
    };
    if (view === "uploads") {
      return {
        ...base,
        rows: [],
        uploads: await waitingUploads(tx, CASUALS_PAGE_MAX),
        more: waiting > CASUALS_PAGE_MAX,
      };
    }
    const shown = sortRows(views[view], sort);
    return {
      ...base,
      rows: shown.slice(0, CASUALS_PAGE_MAX),
      uploads: [],
      more: shown.length > CASUALS_PAGE_MAX,
    };
  });
}

const emptyRecord = (workerId: string): CasualRecord => ({
  workerId,
  reliability: { kind: "new", counted: 0, counts: { worked: 0, noShows: 0, lateCancels: 0 } },
  standing: { regular: false, reliable: false, cancelOften: false, notWorkedLately: true },
  lastWorked: null,
  weeksWorked: 0,
});

// cas-3's sorts, each then by the list's own order (stable).
export function sortRows(rows: readonly CasualRow[], sort: CasualSort): CasualRow[] {
  const list = [...rows];
  const score = (r: CasualRow) =>
    r.record.reliability.kind === "figure" ? r.record.reliability.percent : 101;
  switch (sort) {
    case "least_reliable":
      return list.sort((a, b) => score(a) - score(b));
    case "last_worked":
      // Longest ago first; never worked first of all.
      return list.sort(
        (a, b) => (a.record.lastWorked?.getTime() ?? 0) - (b.record.lastWorked?.getTime() ?? 0),
      );
    case "strikes":
      return list.sort((a, b) => b.liveStrikes - a.liveStrikes);
    default:
      return list;
  }
}

// A casual's worst need now ("Mark as sorted" records what it was about): their worst qualification
// to update, else a missing or overdue staff photo; null when nothing needs updating.
export async function worstNeed(
  tx: FirmTx,
  workerId: string,
  now: Date,
): Promise<{ type: string; status: string } | null> {
  const [w] = await tx
    .select({ id: workers.id, roles: workers.roles, timezone: firms.timezone })
    .from(workers)
    .innerJoin(firms, eq(firms.id, workers.firmId))
    .where(and(eq(workers.id, workerId), isNull(workers.erasedAt)));
  if (!w) return null;
  const held = (
    await qualificationsFor(tx, [workerId], {
      now,
      timeZone: w.timezone,
      people: [{ id: w.id, roles: w.roles }],
    })
  ).get(workerId);
  const first = held?.needs[0];
  if (first) return { type: first.qualification.type, status: first.qualification.status };
  const photo = held?.photo.status;
  return photo === "missing" || photo === "overdue" ? { type: "photo", status: photo } : null;
}
