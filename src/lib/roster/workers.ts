import { and, eq, isNull, sql } from "drizzle-orm";
import { endEverySession } from "../auth/sessions";
import { workers, WORKER_STATUSES } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent, type ActorType } from "../events/record";

// One way workers arrive from outside (a firm's Google Sheet, a CSV or Excel import), with one set
// of rules, inside the caller's withFirm transaction:
//
// - matched by the source's staff id (external_ref) when there is one; a worker here with the same
//   mobile and no staff id yet is linked rather than duplicated; with no staff id at all, matched
//   by mobile;
// - a field the source doesn't have (undefined) is left as it is;
// - a worker the office blocked here stays blocked, whatever the source says;
// - a changed mobile signs the worker out everywhere (sessions revoked, unused login links spent),
//   because login goes by mobile number; so does a changed status, so a worker made inactive and
//   then active again doesn't get their old sessions back (audit L80);
// - every change is logged by field name, never by value (golden rule 5).
//
// A mobile that belongs to another worker throws Postgres's unique violation (23505): the caller
// reports the row.

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

const current = {
  id: workers.id,
  firstName: workers.firstName,
  lastName: workers.lastName,
  mobileE164: workers.mobileE164,
  roles: workers.roles,
  status: workers.status,
  email: workers.email,
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

  const next = {
    firstName: person.firstName,
    lastName: person.lastName,
    mobileE164: person.mobileE164,
    roles: person.roles ?? existing.roles,
    status: existing.status === "blocked" ? "blocked" : (person.status ?? existing.status),
    email: person.email === undefined ? existing.email : person.email,
  } as const;
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) =>
    k === "roles" ? existing.roles.join(",") !== next.roles.join(",") : existing[k] !== next[k],
  );
  const linking = !byRef && person.ref !== undefined;
  if (changed.length === 0 && !linking) return { id: existing.id, outcome: "unchanged" };

  await tx
    .update(workers)
    .set(linking ? { ...next, externalRef: person.ref } : next)
    .where(eq(workers.id, existing.id));
  let ended = { sessions: 0, links: 0 };
  if (changed.includes("mobileE164") || changed.includes("status")) {
    ended = await endEverySession(tx, { kind: "worker", subjectId: existing.id, now: from.now });
  }
  await event(linking ? "worker.linked" : "worker.updated", existing.id, {
    fields: changed,
    ...(ended.sessions > 0 ? { sessionsRevoked: ended.sessions } : {}),
    ...(ended.links > 0 ? { linksSpent: ended.links } : {}),
  });
  return { id: existing.id, outcome: linking ? "linked" : "updated" };
}
