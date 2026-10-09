import { and, eq, isNull, sql } from "drizzle-orm";
import { endEverySession } from "../auth/sessions";
import { workers, WORKER_STATUSES } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent, type ActorType } from "../events/record";
import { forgetPhones, reflagFutureBookings } from "./worker-effects";

// One way workers arrive from outside (a firm's Google Sheet, a CSV or Excel import), with one set
// of rules, inside the caller's withFirm transaction:
//
// - matched by the source's staff id (external_ref) when there is one; a worker here with the same
//   mobile and no staff id yet is linked rather than duplicated; with no staff id at all, matched
//   by mobile;
// - a field the source doesn't have (undefined) is left as it is;
// - a worker blocked here stays blocked, whatever the source says; one the office made inactive
//   (src/lib/office/worker-access.ts) stays inactive, whatever the source says (a blank sheet
//   status reads as "active"), until the office makes them active again. A source can still
//   block them, or make them inactive;
// - a changed mobile signs the worker out everywhere (sessions revoked, unused login links spent)
//   and forgets their phones' notifications, because login goes by mobile number and the old
//   phone may be someone else's now (audit L81); a changed status signs them out too, so a worker
//   made inactive and then active again doesn't get their old sessions back (audit L80);
// - a worker who stops being active has their future bookings flagged on the office's Today
//   (src/lib/office/today.ts), for the office to cancel or keep, and their phones' notifications
//   forgotten; any status change clears "kept" on their bookings ahead, so each is looked at again;
// - every change is logged by field name, never by value (golden rule 5).
//
// A mobile that belongs to another worker throws Postgres's unique violation (23505): the caller
// reports the row. A match by mobile alone (no staff id, or a new staff id linking to a worker who
// has none) must also have the worker's name (sameName: capitals, spaces, hyphens and the kind of
// apostrophe aside), or it throws WorkerNameMismatch and nothing is changed: a mistyped or recycled
// number never renames one person and hands them another's licences, bookings and pay (audit L71,
// L78). And a staff id whose name and mobile both change in one go throws WorkerIdentityChange: a
// staff id reused for a new person never hands them the old one's record. A worker with no staff
// id who changed their name: give them a staff id with the name as it's held here first (that
// links them), then the new name. (The app has no rename yet: PLAN.md Parking lot.)

type WorkerStatus = (typeof WORKER_STATUSES)[number];

// The current firm, as a column value (RLS's WITH CHECK pins it anyway).
const sqlCurrentFirm = sql`app_current_firm_id()`;

export interface IncomingWorker {
  ref?: string;
  firstName: string;
  lastName: string;
  mobileE164: string;
  roles?: string[];
  status?: WorkerStatus;
  email?: string | null;
}

export interface WorkerSource {
  source: "sheets" | "csv";
  actor: { type: ActorType; id?: string | null };
  now: Date;
  via?: "cli"; // an import run from the terminal (its actor isn't a login)
}

export type UpsertOutcome = "added" | "updated" | "linked" | "unchanged";

export class WorkerNameMismatch extends Error {
  constructor() {
    super("a worker with this mobile has another name");
    this.name = "WorkerNameMismatch";
  }
}

export class WorkerIdentityChange extends Error {
  constructor() {
    super("this staff id's name and mobile both changed");
    this.name = "WorkerIdentityChange";
  }
}

// Two spellings of one name: the same letters once capitals, spaces, hyphens, the kind of
// apostrophe (O’Brien, O'Brien) and how an accent is stored are set aside.
const nameKey = (s: string) =>
  s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[\s\u2010-\u2015-]+/g, "");
export const sameName = (a: string, b: string) => nameKey(a) === nameKey(b);

const current = {
  id: workers.id,
  firstName: workers.firstName,
  lastName: workers.lastName,
  mobileE164: workers.mobileE164,
  roles: workers.roles,
  status: workers.status,
  email: workers.email,
  officeDeactivatedAt: workers.officeDeactivatedAt,
};

export async function upsertWorker(
  tx: FirmTx,
  person: IncomingWorker,
  from: WorkerSource,
): Promise<{ id: string; outcome: UpsertOutcome }> {
  const event = (action: string, id: string, data: object) =>
    recordEvent(tx, {
      actorType: from.actor.type,
      actorId: from.actor.id ?? null,
      action,
      entityType: "worker",
      entityId: id,
      data: { source: from.source, ...(from.via ? { via: from.via } : {}), ...data },
    });

  const byRef = person.ref
    ? (await tx.select(current).from(workers).where(eq(workers.externalRef, person.ref)))[0]
    : undefined;
  const byMobile = byRef
    ? undefined
    : (
        await tx
          .select(current)
          .from(workers)
          .where(
            person.ref
              ? and(eq(workers.mobileE164, person.mobileE164), isNull(workers.externalRef))
              : eq(workers.mobileE164, person.mobileE164),
          )
      )[0];
  const existing = byRef ?? byMobile;
  if (
    byMobile &&
    !(
      sameName(byMobile.firstName, person.firstName) && sameName(byMobile.lastName, person.lastName)
    )
  ) {
    throw new WorkerNameMismatch();
  }
  if (
    byRef &&
    byRef.mobileE164 !== person.mobileE164 &&
    !(sameName(byRef.firstName, person.firstName) && sameName(byRef.lastName, person.lastName))
  ) {
    throw new WorkerIdentityChange();
  }

  if (!existing) {
    const [added] = await tx
      .insert(workers)
      .values({
        firmId: sqlCurrentFirm,
        firstName: person.firstName,
        lastName: person.lastName,
        mobileE164: person.mobileE164,
        roles: person.roles ?? [],
        status: person.status ?? "active",
        email: person.email ?? null,
        externalRef: person.ref ?? null,
      })
      .returning({ id: workers.id });
    if (!added) throw new Error("worker insert returned nothing");
    await event("worker.added", added.id, {});
    return { id: added.id, outcome: "added" };
  }

  const linking = !byRef && person.ref !== undefined;
  const decide = (row: typeof existing) => {
    const next = {
      firstName: person.firstName,
      lastName: person.lastName,
      mobileE164: person.mobileE164,
      roles: person.roles ?? row.roles,
      status: statusAfter(row, person.status),
      email: person.email === undefined ? row.email : person.email,
    } as const;
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) =>
      k === "roles" ? row.roles.join(",") !== next.roles.join(",") : row[k] !== next[k],
    );
    return { next, changed };
  };
  // Most rows of a sync change nothing: those are only read. One that changes is read again with
  // its row held (FOR NO KEY UPDATE) until the write, and decided from that: the office changing
  // the same worker at that moment (src/lib/office/worker-access.ts holds it the same way) takes
  // turns with this, and nothing it just did is written over.
  if (decide(existing).changed.length === 0 && !linking) {
    return { id: existing.id, outcome: "unchanged" };
  }
  const [held] = await tx
    .select(current)
    .from(workers)
    .where(eq(workers.id, existing.id))
    .for("no key update");
  if (!held) throw new Error("worker row gone inside its own transaction");
  const { next, changed } = decide(held);
  if (changed.length === 0 && !linking) return { id: held.id, outcome: "unchanged" };

  await tx
    .update(workers)
    .set(linking ? { ...next, externalRef: person.ref } : next)
    .where(eq(workers.id, existing.id));
  let ended = { sessions: 0, links: 0 };
  if (changed.includes("mobileE164") || changed.includes("status")) {
    ended = await endEverySession(tx, { kind: "worker", subjectId: existing.id, now: from.now });
  }
  // A new mobile, or no longer active: their phones' notifications go too (a firm-change notice's
  // push must not reach a phone that isn't theirs, or a leaver).
  const phones =
    changed.includes("mobileE164") || (changed.includes("status") && next.status !== "active")
      ? await forgetPhones(tx, existing.id)
      : 0;
  // Any status change: their bookings ahead are looked at again on Today (one kept for one reason
  // may still be at a site they're blocked from).
  const flagged = changed.includes("status")
    ? await reflagFutureBookings(tx, { workerId: existing.id, now: from.now })
    : 0;
  await event(linking ? "worker.linked" : "worker.updated", existing.id, {
    fields: changed,
    ...(ended.sessions > 0 ? { sessionsRevoked: ended.sessions } : {}),
    ...(ended.links > 0 ? { linksSpent: ended.links } : {}),
    ...(phones > 0 ? { devicesForgotten: phones } : {}),
    ...(flagged > 0 && next.status !== "active" ? { futureBookings: flagged } : {}),
  });
  return { id: existing.id, outcome: linking ? "linked" : "updated" };
}

// The status a source's row leaves the worker with: blocked stays blocked; a worker the office
// made inactive isn't made active by a source (only a source's "blocked" or "inactive" applies).
function statusAfter(
  existing: { status: WorkerStatus; officeDeactivatedAt: Date | null },
  incoming: WorkerStatus | undefined,
): WorkerStatus {
  if (existing.status === "blocked") return "blocked";
  const wanted = incoming ?? existing.status;
  if (existing.officeDeactivatedAt !== null && wanted === "active") return existing.status;
  return wanted;
}
