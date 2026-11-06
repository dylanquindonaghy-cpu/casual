import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import { qualificationsFor } from "../credentials/qualifications";
import { queueCasualReminder } from "../credentials/remind";
import type { NeedsItem } from "../credentials/status";
import { uuidArray } from "../db/arrays";
import { casualNotes, firms, workers } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { markCovers, type CoveredNeed, type SortedMark } from "../portal/in-hand";
import { localDateOf } from "../time/zoned";
import type { StaffPhoto } from "../uploads/photo";
import { photoNeedsUpdate } from "./casuals-copy";
import { officeUserMay, parts, type OfficeContext } from "./office-context";
import { loadCasualRecords, type CasualRecord } from "./reliability";

// Following up casuals who need updating (Phase 26.7, cas-4; docs/screens.md "Casuals, round 8"):
// - Remind (one, or "Remind all"): for each active casual with an out-of-date or expiring
//   qualification (no renewal on its way), the licence message again (src/lib/credentials/remind.ts),
//   logged `casual.reminded` {workerId, type} with a casual-reminder job keyed by that event. Not
//   twice in REMIND_GAP_HOURS (the office's reminder or the daily scan's message): "recent".
// - Add a note: the office's words about them, 1 to 500 characters, no phone number or email
//   address (they'd sit outside the masking); kept in casual_notes, logged `casual.note_added`
//   {workerId} without the words.
// - Mark as sorted: the office is dealing with what's out of date (they have the renewed card in
//   hand, say). Logged `casual.needs_sorted` {workerId, type, status}; while that mark still covers
//   the worst item as it stands (Phase 29.3: markCovers, the same rule as the casual's own "in
//   hand", src/lib/portal/in-hand.ts: the same type and status, nothing about it changed after the
//   mark, and marked on or after the day that status began, so a newer expiry needs action again)
//   the casual sinks to the end of Need updating, "Sorted by {name} · {date}", and "Remind all"
//   leaves them out.
// Active admins and resourcers (the Casuals area), checked inside the firm's transaction.

export const REMIND_GAP_HOURS = 24;
export const REMIND_ALL_MAX = 200;
export const NOTE_MAX = 500;

// The one to remind about: their worst out-of-date or expiring qualification with no renewal on its
// way (needs come worst first).
export function remindable(needs: readonly NeedsItem[]): NeedsItem | null {
  return (
    needs.find(
      (n) =>
        (n.qualification.status === "expired" || n.qualification.status === "expiring_soon") &&
        n.qualification.expiresOn !== null &&
        !n.qualification.renewing,
    ) ?? null
  );
}

// What a "Mark as sorted" is tested against: their worst need as it stands (the first need, else a
// missing or overdue staff photo), the one the mark was made about (worstNeed). The Casuals list's
// "Sorted by" and "Remind all" and the server's Remind use this one need, so they agree even when
// the one to remind about (remindable) is a different qualification.
export function sortedAbout(
  needs: readonly NeedsItem[],
  photo: Pick<StaffPhoto, "status"> | null | undefined,
): CoveredNeed | null {
  if (needs[0]) return needs[0].qualification;
  return photo && photoNeedsUpdate(photo)
    ? { type: "photo", status: photo.status, expiresOn: null }
    : null;
}

export type RemindResult =
  | { status: "done"; reminded: number; recent: number; nothing: number; sorted: number }
  | { status: "not_allowed" };

export async function remindCasuals(
  ctx: OfficeContext,
  rawIds: readonly string[],
): Promise<RemindResult> {
  const ids = z
    .array(z.uuid())
    .max(REMIND_ALL_MAX)
    .safeParse([...new Set(rawIds)]);
  if (!ids.success) return { status: "done", reminded: 0, recent: 0, nothing: 0, sorted: 0 };
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "casuals"))) {
      return { status: "not_allowed" as const };
    }
    const [firm] = await tx.select({ timezone: firms.timezone }).from(firms);
    const timeZone = firm?.timezone ?? "Europe/London";
    const people = await tx
      .select({ id: workers.id, roles: workers.roles, status: workers.status })
      .from(workers)
      .where(and(inArray(workers.id, ids.data), sql`${workers.erasedAt} is null`));
    const held = await qualificationsFor(
      tx,
      people.map((p) => p.id),
      { now, timeZone, people },
    );
    const since = new Date(now.getTime() - REMIND_GAP_HOURS * 3_600_000);
    let reminded = 0;
    let recent = 0;
    let nothing = 0;
    let sorted = 0;
    for (const p of [...people].sort((a, b) => a.id.localeCompare(b.id))) {
      // One at a time per casual: two offices pressing at once send one.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended('casual-remind:' || app_current_firm_id()::text || ':' || ${p.id}, 0))`,
      );
      const q = held.get(p.id);
      const item = p.status === "active" ? remindable(q?.needs ?? []) : null;
      if (!item) {
        nothing += 1;
        continue;
      }
      if (await remindedSince(tx, p.id, since)) {
        recent += 1;
        continue;
      }
      // Marked as sorted by the office, while the mark still covers their worst need as it stands
      // (the one the list's "Sorted by" tests, not always the one reminded about): left alone.
      const worst = sortedAbout(q?.needs ?? [], q?.photo);
      if (worst && (await sortedFor(tx, p.id, worst, timeZone))) {
        sorted += 1;
        continue;
      }
      const eventId = await recordEvent(tx, {
        actorType: "office",
        actorId: ctx.officeUserId,
        action: "casual.reminded",
        entityType: "worker",
        entityId: p.id,
        data: { workerId: p.id, type: item.qualification.type },
      });
      await queueCasualReminder(tx, eventId);
      reminded += 1;
    }
    return { status: "done" as const, reminded, recent, nothing, sorted };
  });
}

// The office reminded them, or the daily scan told them about a licence, since then.
async function remindedSince(tx: FirmTx, workerId: string, since: Date): Promise<boolean> {
  const { rows } = await tx.execute(sql`
    select 1 from events e
     where e.created_at > ${since}
       and ((e.action = 'casual.reminded' and e.entity_id = ${workerId})
         or (e.action in ('credential.expiry_notice_sent', 'credential.expiry_warning',
                          'credential.expired')
             and e.entity_id in (select c.id from credentials c
                                  where c.firm_id = e.firm_id and c.worker_id = ${workerId})))
     limit 1
  `);
  return rows.length > 0;
}

// The office's latest "Mark as sorted" for them still covers this need as it stands now (Phase
// 29.3: markCovers, the casual's own "in hand" rule, src/lib/portal/in-hand.ts).
async function sortedFor(
  tx: FirmTx,
  workerId: string,
  need: CoveredNeed,
  timeZone: string,
): Promise<boolean> {
  const marks = await sortedMarks(tx, [workerId], timeZone);
  return markCovers(need, marks.get(workerId));
}

export interface OfficeSortedMark extends SortedMark {
  by: string; // who marked it ("The office" for someone no longer there)
  at: Date;
}

// Each casual's latest "Mark as sorted" (Phase 29.3): what it was about, who and when, the day in
// the firm's calendar, and `changedAfter` as the casual's own Profile reads it
// (src/lib/portal/profile.ts): one of their records of that type added or updated
// (credential.added, credential.updated), or an upload of it sent, approved or turned down
// (upload.*; for the staff photo, an upload of a photo), logged after the mark. Not the daily
// scan's credential.expired: it only makes a stored status match a date that had already passed.
// Inside the firm's transaction, so another firm's marks never count.
export async function sortedMarks(
  tx: FirmTx,
  workerIds: readonly string[],
  timeZone: string,
): Promise<Map<string, OfficeSortedMark>> {
  const out = new Map<string, OfficeSortedMark>();
  if (workerIds.length === 0) return out;
  const { rows } = await tx.execute<{
    worker_id: string;
    type: string | null;
    status: string | null;
    by: string | null;
    at: Date | string;
    changed: boolean;
  }>(sql`
    with latest as (
      select distinct on (m.entity_id) m.id, m.firm_id, m.entity_id, m.actor_id, m.created_at,
             m.data ->> 'type' as type, m.data ->> 'status' as status
        from events m
       where m.action = 'casual.needs_sorted' and m.entity_type = 'worker'
         and m.entity_id = any(${uuidArray([...workerIds])})
       order by m.entity_id, m.id desc
    )
    select l.entity_id::text as worker_id, l.type, l.status, ou.name as by, l.created_at as at,
           (exists (select 1 from events e
                     where e.action in ('credential.added', 'credential.updated')
                       and e.id > l.id
                       and e.entity_id in (select c.id from credentials c
                                            where c.firm_id = l.firm_id
                                              and c.worker_id = l.entity_id
                                              and c.type = l.type))
            or exists (select 1 from events e
                        where e.worker_ref = l.entity_id::text
                          and e.action in ('upload.received', 'upload.approved', 'upload.rejected')
                          and e.id > l.id
                          and (e.data ->> 'qualificationType' = l.type
                               or (l.type = 'photo' and e.data ->> 'kind' = 'photo')))) as changed
      from latest l
      left join office_users ou on ou.firm_id = l.firm_id and ou.id = l.actor_id
  `);
  for (const r of rows) {
    if (!r.type || !r.status) continue;
    const at = new Date(r.at);
    out.set(r.worker_id, {
      type: r.type,
      status: r.status,
      day: localDateOf(at, timeZone),
      changedAfter: r.changed === true,
      by: r.by ?? "The office",
      at,
    });
  }
  return out;
}

// A phone number (10 or more digits, however they're split: spaces, dashes, dots, slashes or
// brackets) or an email address: a note mustn't carry either (they'd sit outside the masking).
export function holdsContact(text: string): boolean {
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)) return true;
  for (const m of text.matchAll(/\+?\d[\d\s\-./()]*\d/g)) {
    if (m[0].replace(/\D/g, "").length >= 10) return true;
  }
  return false;
}

export type AddNoteResult =
  | { status: "added" }
  | { status: "invalid" } // empty, too long, or holding a phone number or email address
  | { status: "not_found" }
  | { status: "not_allowed" };

export async function addCasualNote(
  ctx: OfficeContext,
  workerId: string,
  raw: string,
): Promise<AddNoteResult> {
  const body = raw.replace(/\s+/g, " ").trim();
  if (!z.uuid().safeParse(workerId).success) return { status: "not_found" };
  if (body.length === 0 || body.length > NOTE_MAX || holdsContact(body)) {
    return { status: "invalid" };
  }
  const { run } = parts(ctx);
  return run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "casuals"))) {
      return { status: "not_allowed" as const };
    }
    const [w] = await tx
      .select({ id: workers.id })
      .from(workers)
      .where(and(eq(workers.id, workerId), sql`${workers.erasedAt} is null`));
    if (!w) return { status: "not_found" as const };
    await tx.insert(casualNotes).values({
      firmId: ctx.firm.id,
      workerId,
      officeUserId: ctx.officeUserId,
      body,
    });
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action: "casual.note_added",
      entityType: "worker",
      entityId: workerId,
      data: { workerId },
    });
    return { status: "added" as const };
  });
}

export type SortedResult =
  | { status: "sorted" }
  | { status: "nothing" } // nothing needs updating now
  | { status: "not_found" }
  | { status: "not_allowed" };

// What "sorted" is about: their worst need now (a qualification's type and status, or the photo).
export interface WorstNeed {
  type: string; // a qualification's type, or "photo"
  status: string;
}

export async function markNeedsSorted(
  ctx: OfficeContext,
  workerId: string,
  worst: (tx: FirmTx, workerId: string, now: Date) => Promise<WorstNeed | null>,
): Promise<SortedResult> {
  if (!z.uuid().safeParse(workerId).success) return { status: "not_found" };
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "casuals"))) {
      return { status: "not_allowed" as const };
    }
    const need = await worst(tx, workerId, now);
    if (!need) return { status: "nothing" as const };
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action: "casual.needs_sorted",
      entityType: "worker",
      entityId: workerId,
      data: { workerId, type: need.type, status: need.status },
    });
    return { status: "sorted" as const };
  });
}

// The latest office note about each casual (Casuals' rows), with who wrote it and when.
export async function latestNotes(
  tx: FirmTx,
  workerIds: readonly string[],
): Promise<Map<string, { body: string; by: string; at: Date }>> {
  const out = new Map<string, { body: string; by: string; at: Date }>();
  if (workerIds.length === 0) return out;
  const { rows } = await tx.execute<{
    worker_id: string;
    body: string;
    by: string | null;
    at: Date | string;
  }>(sql`
    select distinct on (n.worker_id) n.worker_id::text, n.body, ou.name as by, n.created_at as at
      from casual_notes n
      left join office_users ou on ou.firm_id = n.firm_id and ou.id = n.office_user_id
     where n.worker_id = any(${uuidArray([...workerIds])})
     order by n.worker_id, n.created_at desc, n.id desc
  `);
  for (const r of rows)
    out.set(r.worker_id, { body: r.body, by: r.by ?? "The office", at: new Date(r.at) });
  return out;
}

// Each casual's last reminder: the office's ("Reminded by {name}") or the daily scan's ("Sent
// automatically"), and each one's latest "Mark as sorted" (sortedMarks: who and when, what it was
// about, and whether it still covers the need as it stands: markCovers, src/lib/portal/in-hand.ts).
export async function followUps(
  tx: FirmTx,
  workerIds: readonly string[],
  timeZone = "Europe/London",
): Promise<{
  reminders: Map<string, { by: string | null; at: Date }>; // by null: sent automatically
  sorted: Map<string, OfficeSortedMark>;
}> {
  const reminders = new Map<string, { by: string | null; at: Date }>();
  if (workerIds.length === 0) return { reminders, sorted: new Map() };
  const sorted = await sortedMarks(tx, workerIds, timeZone);
  const ids = uuidArray([...workerIds]);
  const { rows } = await tx.execute<{
    worker_id: string;
    action: string;
    by: string | null;
    actor_type: string;
    at: Date | string;
  }>(sql`
    select distinct on (worker_id) worker_id, action, by, actor_type, at from (
      select e.entity_id::text as worker_id, e.action, ou.name as by, e.actor_type,
             e.created_at as at, e.id
        from events e
        left join office_users ou on ou.firm_id = e.firm_id and ou.id = e.actor_id
       where e.action = 'casual.reminded'
         and e.entity_id = any(${ids})
      union all
      select c.worker_id::text, e.action, null, e.actor_type, e.created_at, e.id
        from events e
        join credentials c on c.firm_id = e.firm_id and c.id = e.entity_id
       where e.action in ('credential.expiry_notice_sent', 'credential.expiry_warning')
         and c.worker_id = any(${ids})
    ) x
    order by worker_id, at desc, id desc
  `);
  for (const r of rows) {
    reminders.set(r.worker_id, {
      by: r.action === "casual.reminded" ? (r.by ?? "The office") : null,
      at: new Date(r.at),
    });
  }
  return { reminders, sorted };
}

// The office's notes about one casual, newest first (their page).
export async function notesFor(
  tx: FirmTx,
  workerId: string,
): Promise<{ body: string; by: string; at: Date }[]> {
  const { rows } = await tx.execute<{ body: string; by: string | null; at: Date | string }>(sql`
    select n.body, ou.name as by, n.created_at as at from casual_notes n
      left join office_users ou on ou.firm_id = n.firm_id and ou.id = n.office_user_id
     where n.worker_id = ${workerId}
     order by n.created_at desc, n.id desc
     limit 50
  `);
  return rows.map((r) => ({ body: r.body, by: r.by ?? "The office", at: new Date(r.at) }));
}

// A casual's page (Phase 26.7, cas-6): their record over 90 days and the office's notes.
export async function casualPageExtras(
  ctx: OfficeContext,
  workerId: string,
): Promise<{
  record: CasualRecord | null;
  notes: { body: string; by: string; at: Date }[];
} | null> {
  if (!z.uuid().safeParse(workerId).success) return null;
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "casuals"))) return null;
    const records = await loadCasualRecords(tx, now, [workerId]);
    return { record: records.get(workerId) ?? null, notes: await notesFor(tx, workerId) };
  });
}
