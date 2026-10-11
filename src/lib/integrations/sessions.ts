import { and, count, eq, isNotNull, isNull, max, notInArray, sql } from "drizzle-orm";
import { retryAborted } from "../db/retry";
import {
  assignments,
  CANCELLED_ASSIGNMENT_STATUSES,
  credentialRules,
  credentialTypes,
  firms,
  offers,
  shiftEvents,
  shifts,
  sites,
} from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { AgreementNotRecorded, requireAgreementForImport } from "../imports/gate-b";
import { cancelShiftInTx } from "../roster/cancel";
import { callerActor, callerMarks, firmCallerMay, type FirmCaller } from "../roster/firm-caller";
import { MoveBlocked, moveShiftInTx, recordMoveRefused } from "../roster/firm-change";
import { FIRM_CHANGE_REASONS, type FirmChangeReason } from "../roster/firm-reasons";
import { refreshShiftStatus } from "../roster/native";
import { automaticEventId } from "../roster/shift-events";
import { queueTravelEstimates, siteMoved } from "../travel/estimate-queue";
import type { Geocoder, Point } from "../travel/geocoder";
import { tidyPostcode } from "../travel/postcode";
import { serverGeocoder } from "../travel/server";
import { apiRefusal, handleApiRequest, type ApiCall, type ApiDeps, type ApiResult } from "./api";
import type { ApiErrorCode } from "./errors";
import { sessionAsHeld, sessionWithBookings } from "./records";
import {
  fieldsOf,
  isRef,
  putSessionSchema,
  windowProblem,
  type ApiField,
  type PutSessionBody,
} from "./schemas";

// The planner's sessions (docs/office-v2.md 5.3.2; docs/integrations.md): PUT creates or updates
// one by the planner's own ref, GET reads it back with every booking. A PUT is one short
// transaction, answered in the request (golden rule 3's exception, ADR-022), and the same body
// twice changes nothing. In order:
//   - the ref and the body are checked before anything is read; a site's new postcode is looked up
//     first, outside any transaction (a wait on the network never holds rows), and only when the
//     site has none;
//   - then, in the key's firm: Gate B (writes need the firm's recorded agreement on a live
//     database); the key still live, its row held (src/lib/roster/firm-caller.ts), before the
//     session's;
//   - a new ref: refused if it starts in the past; `"status": "cancelled"` creates nothing;
//     otherwise its site and event are found or created (insert … on conflict do nothing, then
//     read back, so two PUTs naming one new site or event share one row) and the session is
//     created with source "api" (two PUTs for one new ref: the second waits on the unique key, then
//     updates the first's);
//   - nothing different: 200, nothing logged;
//   - cancelled or started: 409; a cancelled session is never reopened;
//   - nobody booked: the change is applied; with live bookings, places, pay, post, meeting point,
//     uniform, instructions and the event are applied, places only down to the highest booked
//     place; times or site need a change_reason and go through moveShiftInTx() with the API caller
//     (every failed rules check blocks it); role or requirements are refused; `"status":
//     "cancelled"` needs a change_reason and goes through cancelShiftInTx() (never a strike);
//   - the status follows the places (refreshShiftStatus()), unless the office closed it.
// Every change is logged with the system actor and {by: "firm", via: "api", keyId}. A refused
// change to a booked session is logged too (shift.move_refused, api.change_refused), so the office
// sees it under Needs attention even if the planner ignores the 409. The showing switches and
// "urgent" are never read from the API: they stay the office's.

export const SESSION_ROUTE = "/api/v1/sessions/{ref}";

export function putSessionRequest(
  request: Request,
  ref: string,
  deps?: ApiDeps,
): Promise<Response> {
  return handleApiRequest(
    request,
    { route: SESSION_ROUTE, method: "PUT", body: true, handler: (call) => putSession(call, ref) },
    deps,
  );
}

export function getSessionRequest(
  request: Request,
  ref: string,
  deps?: ApiDeps,
): Promise<Response> {
  return handleApiRequest(
    request,
    { route: SESSION_ROUTE, method: "GET", body: false, handler: (call) => getSession(call, ref) },
    deps,
  );
}

export async function getSession(call: ApiCall, ref: string): Promise<ApiResult> {
  if (!isRef(ref)) return apiRefusal("bad_ref");
  const found = await call.run(call.firmId, async (tx) => {
    const [row] = await tx
      .select({ id: shifts.id })
      .from(shifts)
      .where(and(eq(shifts.source, "api"), eq(shifts.externalRef, ref)));
    return row ? sessionWithBookings(tx, row.id, call.now) : null;
  });
  return found ? { status: 200, body: found } : apiRefusal("not_found");
}

// A refusal inside the transaction: thrown, so everything the PUT did so far rolls back.
// `refusedShiftId`: a change to a booked session the rules of 5.3.2 refuse, logged afterwards
// (api.change_refused) for the office's Needs attention.
class Refusal extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly extra: Record<string, unknown> = {},
    readonly refusedShiftId?: string,
  ) {
    super(code);
  }
}

// The rules refused a move for some booked casuals: the transaction rolled back.
class MoveRefused extends Error {
  constructor(
    readonly shiftId: string,
    readonly reason: FirmChangeReason,
    readonly blocked: MoveBlocked,
  ) {
    super("move refused");
  }
}

// The site's postcode needs filling but wasn't looked up (the office cleared it a moment ago):
// look it up, then run the PUT again.
class NeedsLookup extends Error {}

type Located = { point: Point | null };

// The shape the session is held in, for comparing.
type Held = {
  id: string;
  role: string;
  startsAt: Date;
  endsAt: Date;
  siteId: string | null;
  headcount: number;
  status: "draft" | "open" | "filled" | "cancelled";
  payRatePence: number | null;
  post: string | null;
  meetingPoint: string | null;
  uniform: string | null;
  instructions: string | null;
  requiredCredentials: string[];
  shiftEventId: string;
};

interface Put {
  tx: FirmTx;
  ref: string;
  body: PutSessionBody;
  by: Extract<FirmCaller, { type: "api" }>;
  now: Date;
  timeZone: string;
  located: Located | undefined;
}

export async function putSession(call: ApiCall, ref: string): Promise<ApiResult> {
  if (!isRef(ref)) return apiRefusal("bad_ref");
  const parsed = putSessionSchema.safeParse(call.json);
  if (!parsed.success) return apiRefusal("validation_failed", { fields: fieldsOf(parsed.error) });
  const body = parsed.data;
  const by = { type: "api" as const, keyId: call.keyId };
  const geocoder = call.geocoder ?? serverGeocoder();
  const postcode = body.site?.postcode ?? null;
  const siteName = body.site?.name ?? null;
  try {
    let located: Located | undefined;
    if (siteName !== null && postcode !== null) {
      // Gate B first, so a firm that can't save yet never sends a postcode out.
      const held = await call.run(call.firmId, async (tx) => {
        await requireAgreementForImport(tx, { saving: true, localDatabase: call.localDatabase });
        return heldPostcode(tx, siteName);
      });
      if (held !== null && held !== postcode) return apiRefusal("site_postcode_differs");
      if (held === null) {
        const found = await locate(geocoder, postcode);
        if ("refusal" in found) return apiRefusal(found.refusal);
        located = found;
      }
    }
    const attempt = (where: Located | undefined) =>
      retryAborted(() =>
        call.run(call.firmId, async (tx) => {
          await requireAgreementForImport(tx, { saving: true, localDatabase: call.localDatabase });
          // The key first, then the session (one lock order with the office's changes).
          if (!(await firmCallerMay(tx, by))) throw new Refusal("invalid_key");
          const timeZone = await firmZone(tx);
          return putInTx({ tx, ref, body, by, now: call.now, timeZone, located: where });
        }),
      );
    try {
      return await attempt(located);
    } catch (error) {
      if (!(error instanceof NeedsLookup) || postcode === null) throw error;
      const found = await locate(geocoder, postcode);
      if ("refusal" in found) return apiRefusal(found.refusal);
      return await attempt(found);
    }
  } catch (error) {
    if (error instanceof AgreementNotRecorded) return apiRefusal("agreement_not_recorded");
    if (error instanceof Refusal) {
      if (error.refusedShiftId) {
        await logChangeRefused(call.run, call.firmId, by, error.refusedShiftId, error.code);
      }
      return apiRefusal(error.code, error.extra);
    }
    if (error instanceof MoveRefused) {
      // Logged in a short transaction of its own (ids and rule codes only).
      await recordMoveRefused(call.run, call.firmId, {
        shiftId: error.shiftId,
        reason: error.reason,
        by,
        workers: error.blocked.workers,
      });
      return apiRefusal("bookings_block_change", {
        casuals: error.blocked.workers.map((w) => ({ id: w.workerId, codes: w.codes })),
      });
    }
    throw error;
  }
}

// The postcode a site of this name holds (tidied), null when it has none or doesn't exist yet.
async function heldPostcode(tx: FirmTx, name: string): Promise<string | null> {
  const [site] = await tx
    .select({ postcode: sites.postcode })
    .from(sites)
    .where(eq(sites.name, name));
  return site?.postcode ? (tidyPostcode(site.postcode) ?? site.postcode) : null;
}

// As the office's Settings (editSitePostcode): unknown is 422, a failed look-up 503 with nothing
// saved, look-ups switched off saves the postcode without a point.
async function locate(
  geocoder: Geocoder,
  postcode: string,
): Promise<Located | { refusal: "unknown_postcode" | "lookup_failed" }> {
  const found = await geocoder.locate(postcode);
  if (found.status === "not_found") return { refusal: "unknown_postcode" };
  if (found.status === "unavailable") return { refusal: "lookup_failed" };
  return { point: found.status === "found" ? found.point : null };
}

async function logChangeRefused(
  run: WithFirm,
  firmId: string,
  by: FirmCaller,
  shiftId: string,
  code: ApiErrorCode,
): Promise<void> {
  await run(firmId, (tx) =>
    recordEvent(tx, {
      ...callerActor(by),
      action: "api.change_refused",
      entityType: "shift",
      entityId: shiftId,
      data: { by: "firm", ...callerMarks(by), shiftId, code },
    }),
  );
}

async function firmZone(tx: FirmTx): Promise<string> {
  const [firm] = await tx
    .select({ timezone: firms.timezone })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  return firm?.timezone ?? "Europe/London";
}

async function lockSession(tx: FirmTx, ref: string): Promise<Held | undefined> {
  const [row] = await tx
    .select({
      id: shifts.id,
      role: shifts.role,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      siteId: shifts.siteId,
      headcount: shifts.headcount,
      status: shifts.status,
      payRatePence: shifts.payRatePence,
      post: shifts.post,
      meetingPoint: shifts.meetingPoint,
      uniform: shifts.uniform,
      instructions: shifts.instructions,
      requiredCredentials: shifts.requiredCredentials,
      shiftEventId: shifts.shiftEventId,
    })
    .from(shifts)
    .where(and(eq(shifts.source, "api"), eq(shifts.externalRef, ref)))
    .for("no key update");
  return row;
}

async function putInTx(p: Put): Promise<ApiResult> {
  const held = await lockSession(p.tx, p.ref);
  if (held) return update(p, held);
  const created = await create(p);
  if (created) return created;
  // Another PUT for this ref created it a moment ago (it held the unique key until it committed):
  // this one is an update of that session.
  const now = await lockSession(p.tx, p.ref);
  if (!now) throw new Error("the session is neither new nor there");
  return update(p, now);
}

// Logged with the system actor and the key's id (src/lib/roster/firm-caller.ts).
const logged = (
  p: Put,
  action: string,
  entityType: string,
  entityId: string,
  data: Record<string, unknown> = {},
) =>
  recordEvent(p.tx, {
    ...callerActor(p.by),
    action,
    entityType,
    entityId,
    data: { by: "firm", ...callerMarks(p.by), ...data },
  });

async function roleKnown(tx: FirmTx, role: string): Promise<boolean> {
  const [rule] = await tx
    .select({ role: credentialRules.role })
    .from(credentialRules)
    .where(eq(credentialRules.role, role));
  return rule !== undefined;
}

async function knownCodes(tx: FirmTx): Promise<Set<string>> {
  const rows = await tx.select({ code: credentialTypes.code }).from(credentialTypes);
  return new Set(rows.map((r) => r.code));
}

// The site by name, made if it's new; a postcode fills one that has none (and its sessions get
// travel estimates); a different one is refused: sites are shared by name across every source,
// so one PUT would otherwise move every session there.
async function siteFor(p: Put, want: NonNullable<PutSessionBody["site"]>): Promise<string> {
  const [added] = await p.tx
    .insert(sites)
    .values({ firmId: sql`app_current_firm_id()`, name: want.name })
    .onConflictDoNothing({ target: [sites.firmId, sites.name] })
    .returning({ id: sites.id });
  if (added) await logged(p, "site.created", "site", added.id);
  const postcode = want.postcode ?? null;
  const read = p.tx
    .select({ id: sites.id, postcode: sites.postcode })
    .from(sites)
    .where(eq(sites.name, want.name));
  // Held while it may be filled: a second PUT filling it waits, then sees it filled. ("no key
  // update", so sessions can still be added at it meanwhile.)
  const [site] = postcode === null ? await read : await read.for("no key update");
  if (!site) throw new Error("the site is neither new nor there");
  if (postcode === null) return site.id;
  const has = site.postcode ? (tidyPostcode(site.postcode) ?? site.postcode) : null;
  if (has === postcode) return site.id;
  if (has !== null) throw new Refusal("site_postcode_differs");
  if (!p.located) throw new NeedsLookup();
  const { point } = p.located;
  await p.tx
    .update(sites)
    .set({
      postcode,
      lat: point ? String(point.lat) : null,
      lng: point ? String(point.lng) : null,
    })
    .where(eq(sites.id, site.id));
  await siteMoved(p.tx, site.id, p.now);
  await logged(p, "site.changed", "site", site.id, { siteId: site.id, fields: ["postcode"] });
  return site.id;
}

// The planner's event by its own ref, made if it's new (named, at the session's site).
async function eventFor(
  p: Put,
  want: { ref: string; name: string },
  siteId: string | null,
): Promise<{ id: string; name: string }> {
  const [added] = await p.tx
    .insert(shiftEvents)
    .values({
      firmId: sql`app_current_firm_id()`,
      name: want.name,
      siteId,
      source: "api",
      plannerRef: want.ref,
    })
    .onConflictDoNothing({
      target: [shiftEvents.firmId, shiftEvents.source, shiftEvents.plannerRef],
    })
    .returning({ id: shiftEvents.id, name: shiftEvents.name });
  if (added) return added;
  const [found] = await p.tx
    .select({ id: shiftEvents.id, name: shiftEvents.name })
    .from(shiftEvents)
    .where(and(eq(shiftEvents.source, "api"), eq(shiftEvents.plannerRef, want.ref)))
    .for("no key update");
  if (!found) throw new Error("the event is neither new nor there");
  return found;
}

const renameEvent = (p: Put, eventId: string, name: string) =>
  p.tx.update(shiftEvents).set({ name }).where(eq(shiftEvents.id, eventId));

const refused = (fields: ApiField[]) => new Refusal("validation_failed", { fields });

async function create(p: Put): Promise<ApiResult | null> {
  const b = p.body;
  // A cancellation of a session ShiftDesk never had: nothing to do, nothing made.
  if (b.status === "cancelled")
    return { status: 200, body: { result: "unchanged", session: null } };
  const missing: ApiField[] = [
    ...(b.role === undefined ? [{ path: "role", code: "required" }] : []),
    ...(b.starts_at === undefined ? [{ path: "starts_at", code: "required" }] : []),
    ...(b.ends_at === undefined ? [{ path: "ends_at", code: "required" }] : []),
    ...(b.site === undefined ? [{ path: "site", code: "required" }] : []),
  ];
  if (b.role === undefined || !b.starts_at || !b.ends_at || !b.site) throw refused(missing);
  const window = windowProblem(b.starts_at, b.ends_at);
  if (window) throw refused([window]);
  if (b.starts_at.getTime() <= p.now.getTime()) throw new Refusal("session_started");
  // A typo would make a session nobody can ever be offered.
  if (!(await roleKnown(p.tx, b.role))) throw new Refusal("unknown_role");
  const requirements = b.requirements ?? [];
  const known = await knownCodes(p.tx);
  if (!requirements.every((c) => known.has(c))) throw new Refusal("unknown_requirement");

  const siteId = await siteFor(p, b.site);
  const event = b.event
    ? await eventFor(p, b.event, siteId)
    : {
        id: await automaticEventId(p.tx, {
          siteId,
          startsAt: b.starts_at,
          source: "api",
          timeZone: p.timeZone,
        }),
        name: null,
      };
  const [added] = await p.tx
    .insert(shifts)
    .values({
      firmId: sql`app_current_firm_id()`,
      shiftEventId: event.id,
      siteId,
      role: b.role,
      startsAt: b.starts_at,
      endsAt: b.ends_at,
      headcount: b.places ?? 1,
      status: "open",
      source: "api",
      externalRef: p.ref,
      payRatePence: b.pay_rate_pence ?? null,
      post: b.post ?? null,
      meetingPoint: b.meeting_point ?? null,
      uniform: b.uniform ?? null,
      instructions: b.instructions ?? null,
      requiredCredentials: requirements,
    })
    .onConflictDoNothing({ target: [shifts.firmId, shifts.source, shifts.externalRef] })
    .returning({ id: shifts.id });
  if (!added) return null;
  await logged(p, "shift.created", "shift", added.id);
  if (b.event && event.name !== b.event.name) {
    await renameEvent(p, event.id, b.event.name);
    await logged(p, "shift.changed", "shift", added.id, { fields: ["eventName"] });
  }
  // Its travel estimates (12G.2).
  await queueTravelEstimates(p.tx, [added.id]);
  return { status: 201, body: { result: "created", session: await sessionAsHeld(p.tx, added.id) } };
}

// The names shift.changed gives each field (docs/office-v2.md 6.1: "requirements", never a name
// holding "credential"; "payRatePence", which makes a casual's later cancellation exempt from a
// strike, src/lib/strikes/issue.ts).
const FIELD_ORDER = [
  "role",
  "startsAt",
  "endsAt",
  "siteId",
  "headcount",
  "payRatePence",
  "post",
  "meetingPoint",
  "uniform",
  "instructions",
  "requirements",
  "event",
  "eventName",
] as const;
type Field = (typeof FIELD_ORDER)[number];
const MOVE_FIELDS: readonly Field[] = ["startsAt", "endsAt", "siteId"];

const pick = <T>(sent: T | undefined, held: T): T => (sent === undefined ? held : sent);

async function update(p: Put, held: Held): Promise<ApiResult> {
  const b = p.body;
  const shiftId = held.id;
  const heldRequirements = [...held.requiredCredentials].sort();
  // The session as asked: each field sent, the rest as held.
  const want = {
    role: pick(b.role, held.role),
    startsAt: pick(b.starts_at, held.startsAt),
    endsAt: pick(b.ends_at, held.endsAt),
    siteId: b.site ? await siteFor(p, b.site) : held.siteId,
    headcount: pick(b.places, held.headcount),
    payRatePence: pick(b.pay_rate_pence, held.payRatePence),
    post: pick(b.post, held.post),
    meetingPoint: pick(b.meeting_point, held.meetingPoint),
    uniform: pick(b.uniform, held.uniform),
    instructions: pick(b.instructions, held.instructions),
    requirements: b.requirements === undefined ? heldRequirements : (b.requirements ?? []),
  };
  let eventId = held.shiftEventId;
  let rename: string | null = null;
  if (b.event) {
    const event = await eventFor(p, b.event, want.siteId);
    eventId = event.id;
    if (event.name !== b.event.name) rename = b.event.name;
  } else if (b.event === null) {
    // No event: its site and day's automatic one.
    eventId = await automaticEventId(p.tx, {
      siteId: want.siteId,
      startsAt: want.startsAt,
      source: "api",
      timeZone: p.timeZone,
    });
  }
  const differs: Record<Field, boolean> = {
    role: want.role !== held.role,
    startsAt: want.startsAt.getTime() !== held.startsAt.getTime(),
    endsAt: want.endsAt.getTime() !== held.endsAt.getTime(),
    siteId: want.siteId !== held.siteId,
    headcount: want.headcount !== held.headcount,
    payRatePence: want.payRatePence !== held.payRatePence,
    post: want.post !== held.post,
    meetingPoint: want.meetingPoint !== held.meetingPoint,
    uniform: want.uniform !== held.uniform,
    instructions: want.instructions !== held.instructions,
    requirements: want.requirements.join(",") !== heldRequirements.join(","),
    event: eventId !== held.shiftEventId,
    eventName: rename !== null,
  };
  const changed = FIELD_ORDER.filter((f) => differs[f]);
  const cancelling = b.status === "cancelled" && held.status !== "cancelled";
  const reopening = b.status === "open" && held.status === "cancelled";
  if (changed.length === 0 && !cancelling && !reopening) {
    return {
      status: 200,
      body: { result: "unchanged", session: await sessionAsHeld(p.tx, shiftId) },
    };
  }
  if (held.status === "cancelled") throw new Refusal("session_cancelled");
  if (held.startsAt.getTime() <= p.now.getTime()) throw new Refusal("session_started");

  if (cancelling) {
    // The other fields of a cancelling PUT aren't applied: the session ends here.
    if (!b.change_reason) throw new Refusal("change_reason_required");
    const result = await cancelShiftInTx(p.tx, {
      shiftId,
      reason: b.change_reason,
      by: p.by,
      now: p.now,
    });
    if (result.status !== "cancelled") throw new Refusal(refusalOf(result.status));
    return {
      status: 200,
      body: {
        result: "cancelled",
        casuals_told: result.bookings,
        session: await sessionAsHeld(p.tx, shiftId),
      },
    };
  }

  if (differs.role && !(await roleKnown(p.tx, want.role))) throw new Refusal("unknown_role");
  if (differs.requirements) {
    const known = await knownCodes(p.tx);
    // A code the firm has since removed may stay (as the office's editor allows).
    if (!want.requirements.every((c) => known.has(c) || heldRequirements.includes(c))) {
      throw new Refusal("unknown_requirement");
    }
  }
  const moving = differs.startsAt || differs.endsAt || differs.siteId;
  if (differs.startsAt || differs.endsAt) {
    const window = windowProblem(want.startsAt, want.endsAt);
    if (window) throw refused([window]);
    if (want.startsAt.getTime() <= p.now.getTime()) throw new Refusal("session_started");
  }

  const [live] = await p.tx
    .select({ n: count(), top: max(assignments.slot) })
    .from(assignments)
    .where(
      and(
        eq(assignments.shiftId, shiftId),
        isNotNull(assignments.workerId),
        notInArray(assignments.status, [...CANCELLED_ASSIGNMENT_STATUSES]),
      ),
    );
  const booked = Number(live?.n ?? 0);
  const reason = b.change_reason ? { reason: FIRM_CHANGE_REASONS[b.change_reason] } : {};
  let told: number | undefined;
  let rest: Field[] = changed;
  if (booked > 0) {
    // Checked against the old list: a new role or requirement could leave them unable to work it.
    if (differs.role || differs.requirements) {
      throw new Refusal("session_has_bookings", {}, shiftId);
    }
    // Only places up to the number count (src/lib/roster/native.ts): never below a booked one.
    if (differs.headcount && want.headcount < Number(live?.top ?? 0)) {
      throw new Refusal("places_below_booked", {}, shiftId);
    }
    if (moving) {
      if (!b.change_reason) throw new Refusal("change_reason_required");
      told = await moveBooked(p, shiftId, want, b.change_reason);
      rest = changed.filter((f) => !MOVE_FIELDS.includes(f));
    }
  }

  if (rest.length > 0) {
    await p.tx
      .update(shifts)
      .set({
        role: want.role,
        startsAt: want.startsAt,
        endsAt: want.endsAt,
        siteId: want.siteId,
        headcount: want.headcount,
        payRatePence: want.payRatePence,
        post: want.post,
        meetingPoint: want.meetingPoint,
        uniform: want.uniform,
        instructions: want.instructions,
        requiredCredentials: want.requirements,
        shiftEventId: eventId,
      })
      .where(eq(shifts.id, shiftId));
    if (rename !== null) await renameEvent(p, eventId, rename);
    const retimed = rest.some((f) => MOVE_FIELDS.includes(f));
    if (retimed || differs.role) {
      // Nobody booked (a booked session's move went through moveBooked): offers still out describe
      // the old session, and its travel estimates are worked out again (12G.2).
      await p.tx
        .update(offers)
        .set({ response: "expired", respondedAt: p.now })
        .where(and(eq(offers.shiftId, shiftId), isNull(offers.response)));
      await queueTravelEstimates(p.tx, [shiftId]);
    }
    await logged(p, "shift.changed", "shift", shiftId, {
      fields: rest,
      ...reason,
      ...(retimed
        ? {
            from: {
              startsAt: held.startsAt.toISOString(),
              endsAt: held.endsAt.toISOString(),
              siteId: held.siteId,
            },
            to: {
              startsAt: want.startsAt.toISOString(),
              endsAt: want.endsAt.toISOString(),
              siteId: want.siteId,
            },
          }
        : {}),
    });
  }

  // The status follows the places, as in the file import, never for a session the office marked
  // as filled with places still free (src/lib/roster/close.ts): that stays closed until the office
  // opens it again.
  const closedByOffice = held.status === "filled" && booked < held.headcount;
  if (differs.headcount && !closedByOffice) {
    await refreshShiftStatus(p.tx, shiftId, p.now);
    if (held.status === "filled") {
      const [after] = await p.tx
        .select({ status: shifts.status })
        .from(shifts)
        .where(eq(shifts.id, shiftId));
      if (after?.status === "open") await logged(p, "shift.reopened", "shift", shiftId);
    }
  }
  return {
    status: 200,
    body: {
      result: "updated",
      ...(told === undefined ? {} : { casuals_told: told }),
      session: await sessionAsHeld(p.tx, shiftId),
    },
  };
}

// A booked session's new times or site: the rules for each booked casual, every failed check
// blocking (the API caller), their notice hours and notices (src/lib/roster/firm-change.ts).
async function moveBooked(
  p: Put,
  shiftId: string,
  want: { startsAt: Date; endsAt: Date; siteId: string | null },
  reason: FirmChangeReason,
): Promise<number> {
  const result = await moveShiftInTx(p.tx, {
    shiftId,
    startsAt: want.startsAt,
    endsAt: want.endsAt,
    siteId: want.siteId,
    reason,
    by: p.by,
    now: p.now,
    timeZone: p.timeZone,
  }).catch((error: unknown) => {
    // Everything rolls back; the refusal is logged afterwards, in its own transaction.
    throw error instanceof MoveBlocked ? new MoveRefused(shiftId, reason, error) : error;
  });
  switch (result.status) {
    case "moved":
    case "curtailed":
      return result.told;
    case "unchanged":
      return 0;
    case "invalid":
      if (result.problem === "in_past") throw new Refusal("session_started");
      throw refused([{ path: "ends_at", code: result.problem }]);
    default:
      throw new Refusal(refusalOf(result.status));
  }
}

// What the roster's other answers mean to the planner (none is expected under the session's
// lock and the key's).
function refusalOf(status: string): ApiErrorCode {
  switch (status) {
    case "not_allowed":
      return "invalid_key";
    case "not_open":
    case "started":
      return "session_started";
    case "unchanged":
      return "session_cancelled";
    default:
      return "not_found";
  }
}
