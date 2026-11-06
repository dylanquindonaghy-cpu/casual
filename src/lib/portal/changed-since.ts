import { and, asc, count, eq, gt, inArray, sql } from "drizzle-orm";
import { events } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { BRIEFING_FIELDS, briefingFieldsOf, type BriefingField } from "../notices/briefing-fields";

// What changed on her booking since she booked it (Phase 28.5; docs/screens.md "The casual app,
// Phase 28" 28.5), read from the action log inside the firm's transaction (RLS scopes it):
//
// - The briefing ("Changed since you booked: instructions and meeting point (Tue 3 Nov, 14:05)"):
//   the session's `shift.changed` entries written after her booking's confirmed_at, by any of the
//   four writers (the office's editor, its planner, the rota sheet, a file import). Only each
//   entry's `data -> 'fields'` and its time are read, and only the names on 28.2's briefing-field
//   list are kept (src/lib/notices/briefing-fields.ts): never a value, never places, the event's
//   name, the times or the site, and never the rota sheet's `overridden` list, which names other
//   casuals (it isn't even selected).
// - The times ("The times changed. Add it to your calendar again."): the office's moves and
//   shortenings of her own booking (`shift.moved`, `shift.curtailed`, logged on the booking) after
//   confirmed_at. Their count is the calendar file's SEQUENCE (src/lib/portal/calendar.ts), so a
//   calendar that already holds the old times takes the new ones.
//
// An entry in the same transaction as her booking is the booking's own moment, not a change since.
// Reads only (golden rule 1: the page shows what the log says; nothing here decides anything).

export interface ChangedSince {
  fields: BriefingField[]; // in the list's order, each once
  at: Date; // when the last of them changed
}

export interface SinceBooked {
  changes: ChangedSince | null;
  moves: number; // times the office moved or shortened her booking since she booked it
}

const NOTHING: SinceBooked = { changes: null, moves: 0 };

export async function sinceBooked(
  tx: FirmTx,
  o: { shiftId: string; assignmentId: string; confirmedAt: Date | null },
): Promise<SinceBooked> {
  if (!o.confirmedAt) return NOTHING;
  const changed = await tx
    .select({ fields: sql<unknown>`${events.data} -> 'fields'`, at: events.createdAt })
    .from(events)
    .where(
      and(
        eq(events.action, "shift.changed"),
        eq(events.entityType, "shift"),
        eq(events.entityId, o.shiftId),
        gt(events.createdAt, o.confirmedAt),
      ),
    )
    .orderBy(asc(events.createdAt), asc(events.id));
  const named = new Set<BriefingField>();
  let at: Date | null = null;
  for (const entry of changed) {
    const fields = briefingFieldsOf(entry.fields);
    if (fields.length === 0) continue;
    for (const f of fields) named.add(f);
    at = entry.at;
  }
  const [moved] = await tx
    .select({ n: count() })
    .from(events)
    .where(
      and(
        inArray(events.action, ["shift.moved", "shift.curtailed"]),
        eq(events.entityType, "assignment"),
        eq(events.entityId, o.assignmentId),
        gt(events.createdAt, o.confirmedAt),
      ),
    );
  return {
    changes: at ? { fields: BRIEFING_FIELDS.filter((f) => named.has(f)), at } : null,
    moves: moved?.n ?? 0,
  };
}
