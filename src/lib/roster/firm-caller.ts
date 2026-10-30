import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { apiKeys, rosterSources } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import type { ActorType } from "../events/record";
import { officeCanPlace, rosterId } from "./book";
import type { RosterSource } from "./plug";

// Who may move or cancel a whole session for the firm (golden rule 12; docs/office-v2.md 5.1 S11
// (d) and 5.3.2): an active admin or resourcer in the office, the firm's planner through the API
// with one of the firm's keys, or a connector (P5.2) reading the firm's own system for it. The
// planner is the narrower caller, and a connector is the planner by another road:
// - its key must still be live, checked in the change's own transaction with the key's row held
//   (`for share`), so a key revoked a moment before is refused, and a revocation waits for a
//   change already under way;
// - it may change only the sessions it sent (source "api"); any other looks unknown to it, as
//   another firm's does;
// - its changes are logged with the system actor and {by: "firm", via: "api", keyId}, never a
//   name, and its cancellations are stamped cancel_via "api".
// A connector is held to exactly the same, with its source in the key's place: allowed only while
// its source (roster_sources, kind "connector") is switched on, checked and held the same way, so
// switching a source off waits for a change under way and stops the next; its sessions are the
// planner's (source "api"); its changes carry {by: "firm", via: "api", sourceId}. A firm's planner
// is one or the other: both would write the same sessions by the same refs, so while the firm has
// a live API key its connector changes nothing (the key, already in use, wins; P5.2's review).
// The office in turn can't change a planner's session as a whole ("planner"), as it can't a
// Google Sheet's ("sheet"): the next PUT would undo it.

export const firmCallerSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("office"), id: rosterId }),
  z.strictObject({ type: z.literal("api"), keyId: rosterId }),
  z.strictObject({ type: z.literal("connector"), sourceId: rosterId }),
]);
export type FirmCaller = z.output<typeof firmCallerSchema>;
// The callers that change the planner's sessions: the API with a key, or a connector.
export type PlannerCaller = Extract<FirmCaller, { type: "api" | "connector" }>;

// Inside the change's transaction, before the session is locked: may this caller change sessions
// now? Take it first, so every path holds the key and then the session (one lock order).
export async function firmCallerMay(tx: FirmTx, by: FirmCaller): Promise<boolean> {
  if (by.type === "office") return officeCanPlace(tx, by.id);
  if (by.type === "connector") {
    const [source] = await tx
      .select({ id: rosterSources.id })
      .from(rosterSources)
      .where(
        and(
          eq(rosterSources.id, by.sourceId),
          eq(rosterSources.kind, "connector"),
          eq(rosterSources.enabled, true),
        ),
      )
      .for("share");
    if (!source) return false;
    const [liveKey] = await tx
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(isNull(apiKeys.revokedAt))
      .limit(1);
    return liveKey === undefined;
  }
  const [key] = await tx
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, by.keyId), isNull(apiKeys.revokedAt)))
    .for("share");
  return key !== undefined;
}

// Whether this caller may change this session as a whole: null when it may.
export function sourceRefusal(
  source: RosterSource,
  by: FirmCaller,
): { status: "sheet" } | { status: "planner" } | { status: "not_found" } | null {
  if (by.type !== "office") return source === "api" ? null : { status: "not_found" };
  if (source === "sheets") return { status: "sheet" };
  if (source === "api") return { status: "planner" };
  return null;
}

// Who the action log names: the office user, or the system acting for the firm's planner (by the
// API or a connector).
export function callerActor(by: FirmCaller): { actorType: ActorType; actorId: string | null } {
  return by.type === "office"
    ? { actorType: "office", actorId: by.id }
    : { actorType: "system", actorId: null };
}

// What each of the planner's entries carries beside {by: "firm"}: the key's id (never the key),
// or the connector's source.
export function callerMarks(
  by: FirmCaller,
): { via: "api"; keyId: string } | { via: "api"; sourceId: string } | Record<never, never> {
  if (by.type === "api") return { via: "api", keyId: by.keyId };
  if (by.type === "connector") return { via: "api", sourceId: by.sourceId };
  return {};
}
