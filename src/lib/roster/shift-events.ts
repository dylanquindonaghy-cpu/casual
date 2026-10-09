import { and, eq, sql } from "drizzle-orm";
import { shiftEvents, sites, type SHIFT_SOURCES } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { dayLabel } from "../rules/reasons";
import { localDateOf } from "../time/zoned";

// Events (shift_events, docs/office-v2.md 3.3): every shift belongs to one. "Shifts for an event"
// makes its own (createNamedEvent). The sheet sync, the file import and "New shift" put a new
// shift in its site and day's automatic event (automaticEventId), as migration 0035 did for the
// shifts already there: named "Acme Demo Arena · Sat 10 Oct" ("Sat 10 Oct" with no site) and found
// again by its key, `auto:{site id or none}:{yyyy-mm-dd}`, held in planner_ref. The day is the
// shift's start in the firm's time zone, so a night shift belongs to the day it starts. A unique
// index allows one automatic event per firm, site and day, whoever makes it. The migration's SQL
// makes the same names and keys (tests/integration/db.event-backfill.test.ts).

export const EVENT_NAME_MAX = 200;
// 200, less " · " and the longest day label ("Wed 10 Sep"): the date always fits.
const SITE_PART_MAX = EVENT_NAME_MAX - 13;

export function automaticEventKey(siteId: string | null, day: string): string {
  return `auto:${siteId ?? "none"}:${day}`;
}

// Cut by characters (code points), as Postgres's left() counts them.
export function automaticEventName(siteName: string | null, day: string): string {
  const label = dayLabel(day);
  return siteName === null ? label : `${[...siteName].slice(0, SITE_PART_MAX).join("")} · ${label}`;
}

export async function automaticEventId(
  tx: FirmTx,
  shift: {
    siteId: string | null;
    startsAt: Date;
    source: (typeof SHIFT_SOURCES)[number];
    timeZone: string;
  },
): Promise<string> {
  const day = localDateOf(shift.startsAt, shift.timeZone);
  const key = automaticEventKey(shift.siteId, day);
  const find = async () => {
    // Both conditions, so the look-up uses the partial unique index and never matches an event
    // whose planner_ref isn't an automatic key.
    const [found] = await tx
      .select({ id: shiftEvents.id })
      .from(shiftEvents)
      .where(and(eq(shiftEvents.plannerRef, key), sql`${shiftEvents.plannerRef} like 'auto:%'`));
    return found?.id;
  };
  const existing = await find();
  if (existing) return existing;
  let siteName: string | null = null;
  if (shift.siteId) {
    const [site] = await tx
      .select({ name: sites.name })
      .from(sites)
      .where(eq(sites.id, shift.siteId));
    if (!site) throw new Error("automaticEventId: no such site");
    siteName = site.name;
  }
  // Another transaction may make the same event first: it waits for that one, then reads it.
  const [added] = await tx
    .insert(shiftEvents)
    .values({
      firmId: sql`app_current_firm_id()`,
      name: automaticEventName(siteName, day),
      siteId: shift.siteId,
      source: shift.source,
      plannerRef: key,
    })
    .onConflictDoNothing({
      target: [shiftEvents.firmId, shiftEvents.plannerRef],
      where: sql`${shiftEvents.plannerRef} like 'auto:%'`,
    })
    .returning({ id: shiftEvents.id });
  const id = added?.id ?? (await find());
  if (!id) throw new Error("automaticEventId: the event is neither new nor there");
  return id;
}

// An event the office names ("Shifts for an event"): never matched by a key.
export async function createNamedEvent(
  tx: FirmTx,
  event: { name: string; siteId: string | null },
): Promise<string> {
  const [added] = await tx
    .insert(shiftEvents)
    .values({
      firmId: sql`app_current_firm_id()`,
      name: event.name,
      siteId: event.siteId,
      source: "native",
    })
    .returning({ id: shiftEvents.id });
  if (!added) throw new Error("event insert returned nothing");
  return added.id;
}
