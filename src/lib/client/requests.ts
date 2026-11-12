import { sql } from "drizzle-orm";
import { z } from "zod";
import { hitLimit, LIMITS, logLimitReached, toMinutes, type Limit } from "../auth/throttle";
import { appEnv } from "../env";
import type { ClientRequestKind } from "../db/schema/client";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { isoDate, timesOn } from "../roster/shift-times";
import { queueClientRequestAlert } from "./jobs";
import { clientRequestInput, CLIENT_NOTE_MAX, type ClientRequestInput } from "./payloads";
import { loadClientRequest } from "./queue";
import {
  clientParts,
  clientScope,
  contractRoles,
  contractSessionSql,
  firmTimeZone,
  firstStartOf,
  type ClientContext,
} from "./reads";
import { urgentWhy, type UrgentWhy } from "./urgency";

// A client contact sending a request (Phase 36.4; docs/screens.md "## Phase 36", "36.4"), and
// replying to the office's question. Inside the firm's transaction, with the contact's contract
// taken from their row (never from the form): a session or event must be one of that contract's,
// to come and not cancelled, or the answer is "not_found", the same as for one that doesn't exist
// (another contract's or firm's can't be told apart). Plain code checks everything and works out
// the urgency (urgency.ts); nothing changes a session here: the office answers each request.
// Logged with ids, the kind and the flags only (client_request.created {contractId, kind, shiftId,
// eventId, urgent}): the client's words stay on the row. An urgent one queues a notification to
// the resourcers on the contract who asked for one (jobs.ts); so does a reply that puts an urgent
// one back with the office (and the office alerts' tick catches one that becomes urgent later:
// notify.ts). Each send and each reply counts against the contact's limit
// (LIMITS.clientRequestPerContact, .clientReplyPerContact: 20 an hour each), in the same
// transaction: over it, nothing is stored and the answer is "rate_limited".

// Over a limit: the page says "Too many requests. Try again in {n} minutes." (words.ts).
export type RateLimited = { status: "rate_limited"; retryAfterMinutes: number };

async function overLimit(
  tx: FirmTx,
  limit: Limit,
  contactId: string,
  now: Date,
  secret: string | undefined,
): Promise<RateLimited | null> {
  const hit = await hitLimit(tx, {
    limit,
    value: contactId,
    now,
    secret: secret ?? appEnv().SESSION_SECRET,
  });
  if (hit.allowed) return null;
  // Logged once a window, when it's first reached (the log never floods).
  if (hit.hits === limit.max + 1) await logLimitReached(tx, limit, "client_contact", contactId);
  return { status: "rate_limited", retryAfterMinutes: toMinutes(hit.retryAfterMs) };
}

export type CreateClientRequestResult =
  | { status: "sent"; requestId: string; urgent: UrgentWhy | null }
  | { status: "invalid"; problem: CreateProblem }
  | { status: "not_found" } // no such session, venue or event of theirs (or no longer to come)
  | RateLimited // 20 an hour (LIMITS.clientRequestPerContact)
  | { status: "not_allowed" }; // not a live client login

export type CreateProblem =
  | "form" // the form itself didn't make sense (zod)
  | "bad_time" // a date or times that don't make a session
  | "in_past" // a session or new time that has started already
  | "too_many_fewer" // fewer places down to none: cancel the session instead
  | "same_times" // new times the same as now
  | "bad_role"; // a new event's session asks for a role the firm doesn't have

interface SessionFacts {
  id: string;
  eventId: string;
  startsAt: Date;
  endsAt: Date;
  headcount: number;
  booked: number;
  status: string;
}

// The contract's session, to come and not cancelled, as it is now. Not locked: nothing here changes
// it, and nothing stored depends on it staying so: the office's answer reads the session afresh
// and re-checks everything (answer.ts), and the urgency is worked out again whenever it's read. A
// lock would only make a client's request wait on (and hold up) the session's bookings.
async function contractSession(
  tx: FirmTx,
  contractId: string,
  shiftId: string,
  now: Date,
): Promise<SessionFacts | null> {
  const { rows } = await tx.execute<{
    id: string;
    event_id: string;
    starts_at: string | Date;
    ends_at: string | Date;
    headcount: number;
    booked: number;
    status: string;
  }>(sql`
    select s.id::text as id, s.event_id::text as event_id, s.starts_at, s.ends_at, s.headcount,
           (select count(*)::int from assignments a
             where a.firm_id = s.firm_id and a.shift_id = s.id and a.worker_id is not null
               and a.status not in ('cancelled_worker', 'cancelled_firm')
               and a.slot <= s.headcount) as booked,
           s.status
      from shifts s
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
     where s.id = ${shiftId}::uuid and s.status in ('open', 'filled') and s.starts_at > ${now}
       and ${contractSessionSql(contractId)}
  `);
  const r = rows[0];
  return r
    ? {
        id: r.id,
        eventId: r.event_id,
        startsAt: new Date(r.starts_at),
        endsAt: new Date(r.ends_at),
        headcount: r.headcount,
        booked: r.booked,
        status: r.status,
      }
    : null;
}

async function contractEvent(
  tx: FirmTx,
  contractId: string,
  eventId: string,
  now: Date,
): Promise<boolean> {
  const { rows } = await tx.execute(sql`
    select 1 from shifts s
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
     where e.id = ${eventId}::uuid and s.ends_at > ${now} and s.status <> 'draft'
       and ${contractSessionSql(contractId)}
     limit 1
  `);
  return rows.length > 0;
}

export async function createClientRequest(
  ctx: ClientContext,
  raw: unknown,
): Promise<CreateClientRequestResult> {
  const parsed = clientRequestInput.safeParse(raw);
  if (!parsed.success) return { status: "invalid", problem: "form" };
  const input: ClientRequestInput = parsed.data;
  const { run, now } = clientParts(ctx);
  return run(ctx.firm.id, async (tx): Promise<CreateClientRequestResult> => {
    const scope = await clientScope(tx, ctx.clientContactId);
    if (!scope) return { status: "not_allowed" };
    const limited = await overLimit(
      tx,
      LIMITS.clientRequestPerContact,
      scope.contactId,
      now,
      ctx.secret,
    );
    if (limited) return limited;
    const timeZone = await firmTimeZone(tx);
    let shiftId: string | null = null;
    let eventId: string | null = null;
    let session: SessionFacts | null = null;
    let startsAt: Date | null = null;
    let newStartsAt: Date | null = null;

    if (input.kind === "new_event") {
      const p = input.payload;
      if ("siteId" in p.venue) {
        const { rows } = await tx.execute(sql`
          select 1 from sites where id = ${p.venue.siteId}::uuid
             and client_id = ${scope.contractId}::uuid
        `);
        if (rows.length === 0) return { status: "not_found" };
      }
      const roles = new Set(await contractRoles(tx, scope.contractId));
      if (p.sessions.some((x) => !roles.has(x.role))) {
        return { status: "invalid", problem: "bad_role" };
      }
      const date = isoDate(p.date);
      if (!date) return { status: "invalid", problem: "bad_time" };
      for (const s of p.sessions) {
        const times = timesOn(date, s.start, s.end, timeZone);
        if (!times) return { status: "invalid", problem: "bad_time" };
        if (times.startsAt.getTime() <= now.getTime()) {
          return { status: "invalid", problem: "in_past" };
        }
      }
      startsAt = firstStartOf("new_event", p, timeZone);
    } else if (input.kind === "other") {
      if (input.shiftId) {
        session = await contractSession(tx, scope.contractId, input.shiftId, now);
        if (!session) return { status: "not_found" };
        shiftId = session.id;
        eventId = session.eventId;
        startsAt = session.startsAt;
      } else if (input.eventId) {
        if (!(await contractEvent(tx, scope.contractId, input.eventId, now))) {
          return { status: "not_found" };
        }
        eventId = input.eventId;
      }
    } else {
      session = await contractSession(tx, scope.contractId, input.shiftId, now);
      if (!session) return { status: "not_found" };
      shiftId = session.id;
      eventId = session.eventId;
      startsAt = session.startsAt;
      if (input.kind === "fewer_places" && input.payload.places >= session.headcount) {
        return { status: "invalid", problem: "too_many_fewer" };
      }
      if (input.kind === "new_times") {
        const date = isoDate(input.payload.date);
        const times = date ? timesOn(date, input.payload.start, input.payload.end, timeZone) : null;
        if (!times) return { status: "invalid", problem: "bad_time" };
        if (times.startsAt.getTime() <= now.getTime()) {
          return { status: "invalid", problem: "in_past" };
        }
        if (
          times.startsAt.getTime() === session.startsAt.getTime() &&
          times.endsAt.getTime() === session.endsAt.getTime()
        ) {
          return { status: "invalid", problem: "same_times" };
        }
        newStartsAt = times.startsAt;
      }
    }

    const why = urgentWhy({
      kind: input.kind,
      now,
      startsAt,
      newStartsAt,
      booked: session?.booked ?? 0,
      free: session ? Math.max(0, session.headcount - session.booked) : 0,
      places: "places" in input.payload ? input.payload.places : undefined,
    });
    const { rows } = await tx.execute<{ id: string }>(sql`
      insert into client_requests (firm_id, contract_id, client_contact_id, kind, shift_id,
                                   event_id, payload, client_note, urgent, created_at, updated_at)
      values (app_current_firm_id(), ${scope.contractId}::uuid, ${scope.contactId}::uuid,
              ${input.kind}, ${shiftId}::uuid, ${eventId}::uuid,
              ${JSON.stringify(input.payload)}::jsonb, ${input.note}, ${why !== null}, ${now},
              ${now})
      returning id::text as id
    `);
    const requestId = rows[0]?.id;
    if (!requestId) throw new Error("client request insert returned nothing");
    await recordEvent(tx, {
      actorType: "client",
      actorId: scope.contactId,
      action: "client_request.created",
      entityType: "client_request",
      entityId: requestId,
      data: {
        contractId: scope.contractId,
        kind: input.kind satisfies ClientRequestKind,
        ...(shiftId ? { shiftId } : {}),
        ...(eventId ? { eventId } : {}),
        urgent: why !== null,
      },
    });
    if (why) await queueClientRequestAlert(tx, { requestId });
    return { status: "sent", requestId, urgent: why };
  });
}

export type ReplyResult =
  | { status: "sent" }
  | { status: "invalid" }
  | { status: "not_asked" } // the office hasn't asked anything (or has answered since)
  | RateLimited // 20 an hour (LIMITS.clientReplyPerContact)
  | { status: "not_found" }
  | { status: "not_allowed" };

const replySchema = z.string().trim().min(1).max(CLIENT_NOTE_MAX);

// The client's answer to the office's question: their note becomes this, and the request is back
// with the office (waiting). Only on one of their contract's requests the office asked about. Back
// with the office and urgent by the rules now: the urgent alert is queued again (each person is
// still told once: the alert's claim, notify.ts).
export async function replyToClientQuestion(
  ctx: ClientContext,
  input: { requestId: string; note: unknown },
): Promise<ReplyResult> {
  if (!z.uuid().safeParse(input.requestId).success) return { status: "not_found" };
  const note = replySchema.safeParse(input.note);
  if (!note.success) return { status: "invalid" };
  const { run, now } = clientParts(ctx);
  return run(ctx.firm.id, async (tx): Promise<ReplyResult> => {
    const scope = await clientScope(tx, ctx.clientContactId);
    if (!scope) return { status: "not_allowed" };
    const limited = await overLimit(
      tx,
      LIMITS.clientReplyPerContact,
      scope.contactId,
      now,
      ctx.secret,
    );
    if (limited) return limited;
    const { rows } = await tx.execute<{ status: string }>(sql`
      select status from client_requests
       where id = ${input.requestId}::uuid and contract_id = ${scope.contractId}::uuid
       for update
    `);
    const found = rows[0];
    if (!found) return { status: "not_found" };
    if (found.status !== "asked") return { status: "not_asked" };
    await tx.execute(sql`
      update client_requests
         set client_note = ${note.data}, status = 'waiting', updated_at = ${now}
       where id = ${input.requestId}::uuid
    `);
    const replied = await recordEvent(tx, {
      actorType: "client",
      actorId: scope.contactId,
      action: "client_request.replied",
      entityType: "client_request",
      entityId: input.requestId,
      data: { contractId: scope.contractId },
    });
    const back = await loadClientRequest(tx, now, input.requestId);
    if (back?.urgent) {
      await queueClientRequestAlert(tx, { requestId: input.requestId, key: `reply-${replied}` });
    }
    return { status: "sent" };
  });
}
