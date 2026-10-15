import { sql } from "drizzle-orm";
import { z } from "zod";
import type { FirmTx } from "../db/scoped";
import { WEBHOOK_TYPES, isWebhookAction, type WebhookType } from "./outbox";
import { bookingWithSession, iso, type CancellationRecord } from "./records";

// What a webhook says (docs/office-v2.md 5.3.3; docs/integrations.md prints these schemas; 12J.2).
// Built when it is sent, from the rows, by 12J.1's record builder (records.ts), so a
// `booking.cancelled` body's `data` is exactly the object GET /api/v1/cancellations returns. One
// zod schema per type is the contract: every body is parsed with its schema before it is signed,
// and the tests parse real bodies with them, so a body that is privacy-safe but missing a field
// fails. Strict objects throughout: nothing can be added (a mobile, an email, a casual's postcode or
// travel data, health or free text) without the schema changing first.

// ---- The contract (docs/integrations.md prints this block as it is: tests/unit/
// integrations.webhooks.test.ts holds the two the same) ----
const isoTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);
const text = z.string().max(500);

export const sessionSchema = z.strictObject({
  id: z.uuid(),
  ref: z.string().max(500).nullable(),
  source: z.enum(["native", "sheets", "csv", "api"]),
  event: z.strictObject({ id: z.uuid(), ref: z.string().max(500).nullable(), name: text }),
  site: z.strictObject({ name: text, postcode: z.string().max(10).nullable() }).nullable(),
  role: z.string().max(500),
  starts_at: isoTime,
  ends_at: isoTime,
  status: z.enum(["draft", "open", "filled", "cancelled"]),
  places: z.number().int().min(0),
  booked: z.number().int().min(0),
  pay_rate_pence: z.number().int().min(0).nullable(),
  post: text.nullable(),
  meeting_point: text.nullable(),
  uniform: text.nullable(),
  requirements: z.array(z.string().max(500)),
});

export const strikeSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.enum(["issued", "none", "withdrawn"]),
    live_strikes: z.number().int().min(0),
  }),
  z.strictObject({
    status: z.literal("exempt"),
    exempt_reason: z.enum(["booked_by_office", "rules_override", "office_changed_it"]),
    live_strikes: z.number().int().min(0),
  }),
]);

// A reason is a code, never anyone's words: a casual's is always casual_own_reason ("I'm unwell" is
// health data), the office's and the planner's their fixed code, the rota sheet's sheet_change.
export const cancellationSchema = z.strictObject({
  at: isoTime,
  by: z.enum(["casual", "office", "planner", "sheet"]),
  via: z.enum(["app", "office", "sheet", "import", "api"]).nullable(),
  notice_hours: z.number(),
  reason_code: z.string().regex(/^[a-z_]{1,40}$/),
  strike: strikeSchema,
});

const casualSchema = z.strictObject({
  id: z.uuid(),
  staff_ref: z.string().max(500).nullable(),
  first_name: z.string().max(500),
  last_name: z.string().max(500),
});

const bookingFields = {
  id: z.uuid(),
  ref: z.string().regex(/^[0-9A-F]{8}$/),
  casual: casualSchema.nullable(),
  erased: z.literal(true).optional(),
  booked_at: isoTime.nullable(),
  booked_by: z.enum(["casual", "office", "sheet"]),
};

// After an erasure the casual is null, with "erased": true; otherwise always there.
const erasedMatches = (b: { casual: unknown; erased?: true }) =>
  (b.casual === null) === (b.erased === true);
const ERASED_MESSAGE = "casual is null exactly when erased is true";

// A new booking. Built when sent, so a late retry may already show it cancelled, worked or a
// no-show (a receiver applies the latest status).
export const bookingSchema = z
  .strictObject({
    ...bookingFields,
    status: z.enum(["booked", "cancelled", "worked", "no_show"]),
    cancellation: cancellationSchema.optional(),
  })
  .refine(erasedMatches, ERASED_MESSAGE)
  .refine((b) => (b.status === "cancelled") === (b.cancellation !== undefined), {
    message: "a cancelled booking carries its cancellation, and only then",
  });

export const cancelledBookingSchema = z
  .strictObject({
    ...bookingFields,
    status: z.literal("cancelled"),
    cancellation: cancellationSchema,
  })
  .refine(erasedMatches, ERASED_MESSAGE);

const firmSchema = z.strictObject({ id: z.uuid(), slug: z.string().max(40) });

const envelope = <T extends WebhookType, D extends z.ZodType>(type: T, data: D) =>
  z.strictObject({
    id: z.string().regex(/^evt_[A-Za-z]{22}$/), // EVENT_ID_PATTERN
    type: z.literal(type),
    timestamp: isoTime,
    firm: firmSchema,
    data,
  });

export const TEST_PING_MESSAGE = "This is a test event from ShiftDesk.";

export const WEBHOOK_SCHEMAS = {
  "booking.created": envelope(
    "booking.created",
    z.strictObject({ session: sessionSchema, booking: bookingSchema }),
  ),
  "booking.cancelled": envelope(
    "booking.cancelled",
    z.strictObject({ session: sessionSchema, booking: cancelledBookingSchema }),
  ),
  "strike.withdrawn": envelope(
    "strike.withdrawn",
    z.strictObject({
      session: sessionSchema,
      booking: cancelledBookingSchema.refine((b) => b.cancellation.strike.status === "withdrawn", {
        message: "a withdrawn strike's booking shows the strike as withdrawn",
      }),
    }),
  ),
  "test.ping": envelope("test.ping", z.strictObject({ message: z.literal(TEST_PING_MESSAGE) })),
} as const;
// ---- End of the contract ----

export type WebhookBody<T extends WebhookType = WebhookType> = z.infer<(typeof WEBHOOK_SCHEMAS)[T]>;

export type BuiltWebhook =
  | {
      status: "built";
      type: WebhookType;
      body: string; // the JSON, exactly as signed and sent
      bookingId: string | null; // null: a test event
    }
  | { status: "gone" }; // nothing to tell: no such entry, booking or strike in this firm

// The log entry a delivery is about, in this firm (row-level security).
async function logEntry(tx: FirmTx, logEntryId: number) {
  const { rows } = await tx.execute<{
    action: string;
    entity_id: string | null;
    created_at: string | Date;
  }>(sql`
    select e.action, e.entity_id::text as entity_id, e.created_at
      from events e where e.id = ${logEntryId}
  `);
  return rows[0] ?? null;
}

// A strike's booking (strike.withdrawn's entry is on the strike).
async function strikeBooking(tx: FirmTx, strikeId: string): Promise<string | null> {
  const { rows } = await tx.execute<{ assignment_id: string }>(sql`
    select s.assignment_id::text as assignment_id from strikes s where s.id = ${strikeId}::uuid
  `);
  return rows[0]?.assignment_id ?? null;
}

const toBody = (
  b: { id: string; type: WebhookType; timestamp: string; firm: { id: string; slug: string } },
  data: unknown,
): string => {
  const body = WEBHOOK_SCHEMAS[b.type].parse({ ...b, data });
  return JSON.stringify(body);
};

// One delivery's body, from the rows as they are now.
export async function buildWebhook(
  tx: FirmTx,
  w: {
    eventId: string; // evt_…
    firm: { id: string; slug: string };
    now: Date;
    logEntryId?: number;
    testId?: string;
  },
): Promise<BuiltWebhook> {
  if (w.logEntryId === undefined) {
    return {
      status: "built",
      type: "test.ping",
      body: toBody(
        { id: w.eventId, type: "test.ping", timestamp: iso(w.now), firm: w.firm },
        { message: TEST_PING_MESSAGE },
      ),
      bookingId: null,
    };
  }
  const entry = await logEntry(tx, w.logEntryId);
  if (!entry?.entity_id || !isWebhookAction(entry.action)) return { status: "gone" };
  const type = WEBHOOK_TYPES[entry.action];
  const bookingId =
    entry.action === "strike.withdrawn"
      ? await strikeBooking(tx, entry.entity_id)
      : entry.entity_id;
  if (!bookingId) return { status: "gone" };
  const record: CancellationRecord | null = await bookingWithSession(tx, bookingId, w.now);
  if (!record) return { status: "gone" };
  return {
    status: "built",
    type,
    body: toBody(
      { id: w.eventId, type, timestamp: iso(new Date(entry.created_at)), firm: w.firm },
      record,
    ),
    bookingId,
  };
}
