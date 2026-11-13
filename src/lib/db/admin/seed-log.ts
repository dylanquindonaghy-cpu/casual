import { recordEventAt, type EventInput } from "../../events/record";
import type { FirmTx } from "../scoped";

// The seed's log entries (Phase 26.10, fix-8): collected while one firm's made-up rows are loaded,
// each at its story's own time (a booking at its confirmation, a cancellation when it was
// cancelled), then written in the order they happened when the firm's rows are in. The office's
// history lists read newest first by the entry's number (the action log, the notice report, a
// session's and an event's History), so the numbers must follow the times. Never after the seed's
// own now (a time ahead of it would sit above everything a visitor does). An entry can name an
// earlier one's id in its data (a change notice, its cancellation): `add` returns a ref for that,
// filled in as the entries are written. Only the seed uses it (tests/unit/events.boundary.test.ts).

export interface SeedRef {
  readonly seedRef: number;
}

const isRef = (value: unknown): value is SeedRef =>
  typeof value === "object" &&
  value !== null &&
  Object.keys(value).length === 1 &&
  typeof (value as { seedRef?: unknown }).seedRef === "number";

// Text worked out from an earlier entry's id once it's written (a strike evidence attempt's
// request key names its series, the strike.issued entry's id: src/lib/strikes/evidence-queue.ts).
export interface SeedRefText {
  readonly seedRef: number;
  readonly text: (id: number) => string;
}
export const refText = (ref: SeedRef, text: (id: number) => string): SeedRefText => ({
  seedRef: ref.seedRef,
  text,
});
const isRefText = (value: unknown): value is SeedRefText =>
  typeof value === "object" &&
  value !== null &&
  Object.keys(value).length === 2 &&
  typeof (value as { seedRef?: unknown }).seedRef === "number" &&
  typeof (value as { text?: unknown }).text === "function";

export interface SeedLog {
  readonly now: Date; // the seed's now
  // An entry at `at` (default: the seed's now). Throws for a time after now.
  add(event: EventInput, at?: Date): SeedRef;
  // Writes what was added, oldest first (ties in the order added), and empties the list.
  write(tx: FirmTx): Promise<number>;
}

export function seedLog(now: Date): SeedLog {
  let entries: { event: EventInput; at: Date }[] = [];
  return {
    now,
    add(event, at = now) {
      if (at.getTime() > now.getTime()) {
        throw new Error(`seed log: ${event.action} at ${at.toISOString()} is after the seed's now`);
      }
      entries.push({ event, at });
      return { seedRef: entries.length - 1 };
    },
    async write(tx) {
      const order = entries
        .map((e, i) => ({ ...e, i }))
        .sort((a, b) => a.at.getTime() - b.at.getTime() || a.i - b.i);
      const ids = new Map<number, number>();
      for (const e of order) {
        const data = e.event.data
          ? Object.fromEntries(
              Object.entries(e.event.data).map(([key, value]) => {
                if (!isRef(value) && !isRefText(value)) return [key, value];
                const id = ids.get(value.seedRef);
                if (id === undefined) {
                  throw new Error(
                    `seed log: ${e.event.action} names an entry not written before it`,
                  );
                }
                return [key, isRefText(value) ? value.text(id) : id];
              }),
            )
          : undefined;
        ids.set(e.i, await recordEventAt(tx, { ...e.event, ...(data ? { data } : {}) }, e.at));
      }
      const written = order.length;
      entries = [];
      return written;
    },
  };
}
