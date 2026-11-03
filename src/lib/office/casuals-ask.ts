import { eq } from "drizzle-orm";
import { z } from "zod";
import { shiftEvents } from "../db/schema";
import { recordEvent } from "../events/record";
import { officeCanPlace } from "../roster/book";
import { parts, type OfficeContext } from "./office-context";

// An event's "Casuals ask, you choose" switch (Phase 26.6, ses-1; decision 2): on, casuals tap
// "I can do this" on its sessions and the office books from who asked (src/lib/roster/asks.ts);
// off (the default), the first to tap takes a place. ShiftDesk's own, like the casuals switch
// (src/lib/office/showing.ts): the planner, sheet sync and import never read or write it. Active
// admins and resourcers only. Logged `event.asks_on` / `event.asks_off`; no change, no entry.
//
// The event row is locked first (for no key update, as the casuals switch does), so a casual's
// booking or ask that read the setting under a share of it finishes first, and one after reads the
// new setting. Nothing here waits on another lock after the event row. Asks already made stay
// when it's switched off: the office still sees them on the session's page, and casuals take
// places again.

export const setCasualsAskSchema = z.strictObject({ eventId: z.string(), on: z.boolean() });

export type SetCasualsAskResult =
  | { status: "on" }
  | { status: "off" }
  | { status: "unchanged" }
  | { status: "not_found" }
  | { status: "not_allowed" };

export async function setCasualsAsk(
  ctx: OfficeContext,
  raw: z.input<typeof setCasualsAskSchema>,
): Promise<SetCasualsAskResult> {
  const input = setCasualsAskSchema.parse(raw);
  if (!z.uuid().safeParse(input.eventId).success) return { status: "not_found" };
  const { run } = parts(ctx);
  return run(ctx.firm.id, async (tx) => {
    if (!(await officeCanPlace(tx, ctx.officeUserId))) return { status: "not_allowed" };
    const [current] = await tx
      .select({ on: shiftEvents.casualsAsk })
      .from(shiftEvents)
      .where(eq(shiftEvents.id, input.eventId))
      .for("no key update");
    if (!current) return { status: "not_found" };
    if (current.on === input.on) return { status: "unchanged" };
    await tx
      .update(shiftEvents)
      .set({ casualsAsk: input.on })
      .where(eq(shiftEvents.id, input.eventId));
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      // Written out in full, so the action log's test finds every kind.
      action: input.on ? "event.asks_on" : "event.asks_off",
      entityType: "shift_event",
      entityId: input.eventId,
      data: { by: "firm" },
    });
    return { status: input.on ? "on" : "off" };
  });
}
