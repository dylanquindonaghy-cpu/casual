import { eq } from "drizzle-orm";
import { messages } from "../db/schema";
import type { FirmTx } from "../db/scoped";

// Locks an inbound message: true if this run is the one handling it (nobody has yet). The
// inbound-message job's claim (src/lib/inbound/reply.ts, src/lib/inbound/opt-out.ts): it marks the
// message handled in the same transaction, so a reply goes at most once.
export async function lockUnhandled(tx: FirmTx, messageId: string): Promise<boolean> {
  const [m] = await tx
    .select({ handledAt: messages.handledAt })
    .from(messages)
    .where(eq(messages.id, messageId))
    .for("update");
  return m !== undefined && m.handledAt === null;
}
