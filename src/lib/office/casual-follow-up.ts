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
//   hand, say). Logged `casual.needs_sorted` {workerId, type, status}; while that worst item stands
//   unchanged the casual sinks to the end of Need updating, "Sorted by {name} · {date}", and
//   "Remind all" leaves them out.
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
    const people = await tx
      .select({ id: workers.id, roles: workers.roles, status: workers.status })
      .from(workers)
      .where(and(inArray(workers.id, ids.data), sql`${workers.erasedAt} is null`));
    const held = await qualificationsFor(
      tx,
      people.map((p) => p.id),
      { now, timeZone: firm?.timezone ?? "Europe/London", people },
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
      const item = p.status === "active" ? remindable(held.get(p.id)?.needs ?? []) : null;
      if (!item) {
        nothing += 1;
        continue;
      }
      if (await remindedSince(tx, p.id, since)) {
        recent += 1;
        continue;
      }
      // Marked as sorted by the office, while what it was about stands: left alone.
      if (await sortedFor(tx, p.id, item.qualification.type, item.qualification.status)) {
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

// The office's latest "Mark as sorted" for them was about this very need.
async function sortedFor(
  tx: FirmTx,
  workerId: string,
  type: string,
  status: string,
): Promise<boolean> {
  const { rows } = await tx.execute<{ type: string | null; status: string | null }>(sql`
    select data ->> 'type' as type, data ->> 'status' as status from events
     where action = 'casual.needs_sorted' and entity_id = ${workerId}
     order by id desc
     limit 1
  `);
  return rows[0]?.type === type && rows[0]?.status === status;
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
// automatically"), and each one's "Mark as sorted" (who and when, and what it was about).
export async function followUps(
  tx: FirmTx,
  workerIds: readonly string[],
): Promise<{
  reminders: Map<string, { by: string | null; at: Date }>; // by null: sent automatically
  sorted: Map<string, { by: string; at: Date; type: string; status: string }>;
}> {
  const reminders = new Map<string, { by: string | null; at: Date }>();
  const sorted = new Map<string, { by: string; at: Date; type: string; status: string }>();
  if (workerIds.length === 0) return { reminders, sorted };
  const ids = uuidArray([...workerIds]);
  const { rows } = await tx.execute<{
    worker_id: string;
    action: string;
    by: string | null;
    actor_type: string;
    at: Date | string;
    data: Record<string, unknown>;
  }>(sql`
    select distinct on (worker_id, kind) worker_id, action, by, actor_type, at, data from (
      select e.entity_id::text as worker_id, e.action, ou.name as by, e.actor_type,
             e.created_at as at, e.data,
             case when e.action = 'casual.needs_sorted' then 'sorted' else 'reminder' end as kind,
             e.id
        from events e
        left join office_users ou on ou.firm_id = e.firm_id and ou.id = e.actor_id
       where e.action in ('casual.reminded', 'casual.needs_sorted')
         and e.entity_id = any(${ids})
      union all
      select c.worker_id::text, e.action, null, e.actor_type, e.created_at, e.data, 'reminder', e.id
        from events e
        join credentials c on c.firm_id = e.firm_id and c.id = e.entity_id
       where e.action in ('credential.expiry_notice_sent', 'credential.expiry_warning')
         and c.worker_id = any(${ids})
    ) x
    order by worker_id, kind, at desc, id desc
  `);
  for (const r of rows) {
    if (r.action === "casual.needs_sorted") {
      sorted.set(r.worker_id, {
        by: r.by ?? "The office",
        at: new Date(r.at),
        type: String(r.data.type ?? ""),
        status: String(r.data.status ?? ""),
      });
    } else {
      reminders.set(r.worker_id, {
        by: r.action === "casual.reminded" ? (r.by ?? "The office") : null,
        at: new Date(r.at),
      });
    }
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
