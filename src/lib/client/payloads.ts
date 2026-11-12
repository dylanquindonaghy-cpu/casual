import { z } from "zod";
import {
  CLIENT_REQUEST_KINDS,
  SESSION_REQUEST_KINDS,
  type ClientRequestKind,
} from "../db/schema/client";
import { normaliseRole } from "../roster/names";

// What a client may ask for (Phase 36.4; docs/screens.md "## Phase 36", "36.4"): one zod schema per
// kind, checked when it's sent (src/lib/client/requests.ts) and again whenever it's read back
// (payloadOf), so a row the database holds is only ever used as its kind's shape. No database
// calls: the client's form and the office's page use these too.

export const CLIENT_NOTE_MAX = 1000;
export const NEW_EVENT_SESSIONS_MAX = 12;
export const MORE_PLACES_MAX = 200;
export const CLIENT_TEXT_MAX = 1000;
export const EVENT_NAME_MAX = 200;
export const ADDRESS_MAX = 300;
export const SESSION_NOTES_MAX = 500;

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "a time like 09:30");
const day = z.iso.date();
const role = z
  .string()
  .max(100)
  .transform((r, ctx) => {
    const code = normaliseRole(r);
    if (!code) {
      ctx.addIssue({ code: "custom", message: "a role" });
      return z.NEVER;
    }
    return code;
  });

export const newEventPayload = z.strictObject({
  name: z.string().trim().min(1).max(EVENT_NAME_MAX),
  // One of the contract's venues, or an address for one the firm doesn't have yet.
  venue: z.union([
    z.strictObject({ siteId: z.uuid() }),
    z.strictObject({ address: z.string().trim().min(5).max(ADDRESS_MAX) }),
  ]),
  date: day,
  sessions: z
    .array(
      z.strictObject({
        role,
        places: z.int().min(1).max(1000),
        start: clock,
        end: clock,
        notes: z.string().trim().max(SESSION_NOTES_MAX).optional(),
      }),
    )
    .min(1)
    .max(NEW_EVENT_SESSIONS_MAX),
});
export const morePlacesPayload = z.strictObject({ places: z.int().min(1).max(MORE_PLACES_MAX) });
export const fewerPlacesPayload = z.strictObject({ places: z.int().min(1).max(1000) });
// The session's new date and clock times, the firm's time zone (a finish before the start is the
// next day, as the office's editor reads it).
export const newTimesPayload = z.strictObject({ date: day, start: clock, end: clock });
export const cancelSessionPayload = z.strictObject({});
export const otherPayload = z.strictObject({
  text: z.string().trim().min(1).max(CLIENT_TEXT_MAX),
});

export const PAYLOADS = {
  new_event: newEventPayload,
  more_places: morePlacesPayload,
  fewer_places: fewerPlacesPayload,
  new_times: newTimesPayload,
  cancel_session: cancelSessionPayload,
  other: otherPayload,
} as const satisfies Record<ClientRequestKind, z.ZodType>;

export type NewEventPayload = z.output<typeof newEventPayload>;
export type ClientPayload = { [K in ClientRequestKind]: z.output<(typeof PAYLOADS)[K]> };

// A request as the client sends it: the kind, what it's about, the details, and a note.
const note = z
  .string()
  .trim()
  .max(CLIENT_NOTE_MAX)
  .optional()
  .transform((n) => (n ? n : null));
const id = z.uuid();
export const clientRequestInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new_event"), payload: newEventPayload, note }),
  z.strictObject({ kind: z.literal("more_places"), shiftId: id, payload: morePlacesPayload, note }),
  z.strictObject({
    kind: z.literal("fewer_places"),
    shiftId: id,
    payload: fewerPlacesPayload,
    note,
  }),
  z.strictObject({ kind: z.literal("new_times"), shiftId: id, payload: newTimesPayload, note }),
  z.strictObject({
    kind: z.literal("cancel_session"),
    shiftId: id,
    payload: cancelSessionPayload,
    note,
  }),
  // Something else: about a session, an event, or nothing in particular.
  z.strictObject({
    kind: z.literal("other"),
    shiftId: id.optional(),
    eventId: id.optional(),
    payload: otherPayload,
    note,
  }),
]);
export type ClientRequestInput = z.output<typeof clientRequestInput>;

export const isSessionKind = (k: ClientRequestKind) =>
  (SESSION_REQUEST_KINDS as readonly string[]).includes(k);

// A stored row's payload as its kind's shape, or null if it isn't one (never trusted as it lies).
export function payloadOf<K extends ClientRequestKind>(
  kind: K,
  raw: unknown,
): ClientPayload[K] | null {
  const parsed = PAYLOADS[kind].safeParse(raw);
  return parsed.success ? (parsed.data as ClientPayload[K]) : null;
}

export const isClientRequestKind = (v: unknown): v is ClientRequestKind =>
  typeof v === "string" && (CLIENT_REQUEST_KINDS as readonly string[]).includes(v);
