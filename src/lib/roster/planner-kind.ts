import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { apiKeys, rosterSources, shifts } from "../db/schema";
import type { FirmTx } from "../db/scoped";

// Whether a planner session (source "api") is a connector's while that connector is the firm's
// planner: read from it (shifts.source_read_at, set by every read applied: P5.5's review, so a
// session an API key made, which the connector never reads, isn't one), its source on, and no
// planner API key live (one planner: firmCallerMay in src/lib/roster/firm-caller.ts). Then people
// can't book or cancel it in ShiftDesk (P5.5): the firm's own system holds who's booked, and a
// booking made here couldn't reach it (the "confirming" path waits for a system that takes
// writes), so book.ts and cancel.ts answer needs_approval and the office makes the change there,
// which comes back in. `listed`: the staff refs the system listed as booked at its last read
// (shifts.synced_holders), so cancel.ts can tell a booking it no longer has.
export async function connectorSession(
  tx: FirmTx,
  shiftId: string,
): Promise<{ listed: string[] } | null> {
  const [session] = await tx
    .select({ listed: shifts.syncedHolders })
    .from(shifts)
    .where(and(eq(shifts.id, shiftId), eq(shifts.source, "api"), isNotNull(shifts.sourceReadAt)));
  if (!session) return null;
  const [source] = await tx
    .select({ id: rosterSources.id })
    .from(rosterSources)
    .where(and(eq(rosterSources.kind, "connector"), eq(rosterSources.enabled, true)))
    .limit(1);
  if (!source) return null;
  const [liveKey] = await tx
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(isNull(apiKeys.revokedAt))
    .limit(1);
  return liveKey === undefined ? { listed: session.listed ?? [] } : null;
}
