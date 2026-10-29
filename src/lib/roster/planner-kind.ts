import { and, eq, isNull } from "drizzle-orm";
import { apiKeys, rosterSources } from "../db/schema";
import type { FirmTx } from "../db/scoped";

// Whether the firm's planner sessions (source "api") are a connector's: its source is on and no
// planner API key is live (one planner: firmCallerMay in src/lib/roster/firm-caller.ts). Then
// people can't book or cancel them in ShiftDesk (P5.5): the firm's own system holds who's booked,
// and a booking made here couldn't reach it (the "confirming" path waits for a system that takes
// writes), so book.ts and cancel.ts answer needs_approval and the office makes the change there,
// which comes back in.
export async function plannerIsConnector(tx: FirmTx): Promise<boolean> {
  const [source] = await tx
    .select({ id: rosterSources.id })
    .from(rosterSources)
    .where(and(eq(rosterSources.kind, "connector"), eq(rosterSources.enabled, true)))
    .limit(1);
  if (!source) return false;
  const [liveKey] = await tx
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(isNull(apiKeys.revokedAt))
    .limit(1);
  return liveKey === undefined;
}
