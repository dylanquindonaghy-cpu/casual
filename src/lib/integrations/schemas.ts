import { z } from "zod";
import { SHIFT_CHANGE_REASON_CODES } from "../roster/firm-reasons";
import { EVENT_NAME_MAX } from "../roster/shift-events";
import { normaliseRole } from "../roster/sheets/parse";
import { POSTCODE_INPUT_MAX, tidyPostcode } from "../travel/postcode";

// What the planner API accepts (docs/office-v2.md 5.3.2; docs/integrations.md), checked at the
// boundary before anything is read from the database. Bodies are z.strictObject: an unknown field
// is a 400, so a typo (or "urgent", which is the office's own) never fails silently. A refusal
// names each field's path and what was wrong (fieldsOf), never the value sent.

// A planner's own id for a session or an event: it ends with a letter or a digit, so sentence
// punctuation after it in a message or a log can never be taken as part of it.
export const REF_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,198}[A-Za-z0-9])?$/;
export const isRef = (value: string): boolean => REF_PATTERN.test(value);

// The office editor's own limits (src/lib/office/shift-editor.ts, held equal by a test), repeated
// here so the API's routes never load the office's code (nor, through it, the AI's: the AI
// boundary test, tests/unit/ai.boundary.test.ts).
export const API_LIMITS = {
  placesMin: 1,
  placesMax: 1000,
  payRatePenceMax: 100_000, // £1,000 an hour
  post: 200,
  meetingPoint: 300,
  uniform: 300,
  instructions: 2000,
  eventName: EVENT_NAME_MAX,
  siteName: 200,
  role: 100,
  requirements: 20,
  requirementCode: 50,
} as const;

// A refinement's own code for the refusal's fields (zod's issue code otherwise).
const because = (code: string) => ({ params: { code } });

// Trimmed text up to `max` characters; "" (or only spaces) clears it, as null does.
const clearableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

// An ISO 8601 time with its offset ("2026-10-07T10:30:00+01:00", or "Z"), in whole minutes.
const instant = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v))
  .refine((d) => d.getTime() % 60_000 === 0, because("whole_minutes"));

const eventRef = z
  .string()
  .max(200)
  .refine(isRef, because("bad_ref"))
  // Automatic events keep "auto:" keys in the same column (src/lib/roster/shift-events.ts).
  .refine((v) => !v.toLowerCase().startsWith("auto:"), because("reserved_ref"));

// "Door supervisor" → "door_supervisor" (the sheet parser's reading); only the shape is checked
// here: the firm's own role codes are checked in its transaction.
const role = z
  .string()
  .trim()
  .min(1)
  .max(API_LIMITS.role)
  .transform((v) => normaliseRole(v))
  .refine((v): v is string => v !== null, because("bad_role"));

// Qualification codes, as the office shows them ("SIA_DS"); each once, in order.
const requirements = z
  .array(
    z
      .string()
      .trim()
      .max(API_LIMITS.requirementCode)
      .transform((v) => v.toUpperCase())
      .refine((v) => /^[A-Z][A-Z0-9_]*$/.test(v), because("bad_code")),
  )
  .max(API_LIMITS.requirements)
  .transform((codes) => [...new Set(codes)].sort())
  .nullable()
  .optional();

export const putSessionSchema = z.strictObject({
  event: z
    .strictObject({
      ref: eventRef,
      name: z.string().trim().min(1).max(API_LIMITS.eventName),
    })
    .nullable()
    .optional(),
  site: z
    .strictObject({
      name: z.string().trim().min(1).max(API_LIMITS.siteName),
      // Only fills a site that has none; null or left out leaves the site's postcode alone.
      postcode: z
        .string()
        .max(POSTCODE_INPUT_MAX)
        .transform((v) => tidyPostcode(v))
        .refine((v): v is string => v !== null, because("bad_postcode"))
        .nullable()
        .optional(),
    })
    .optional(),
  role: role.optional(),
  starts_at: instant.optional(),
  ends_at: instant.optional(),
  places: z.number().int().min(API_LIMITS.placesMin).max(API_LIMITS.placesMax).optional(),
  status: z.enum(["open", "cancelled"]).optional(),
  pay_rate_pence: z.number().int().min(0).max(API_LIMITS.payRatePenceMax).nullable().optional(),
  post: clearableText(API_LIMITS.post),
  meeting_point: clearableText(API_LIMITS.meetingPoint),
  uniform: clearableText(API_LIMITS.uniform),
  instructions: clearableText(API_LIMITS.instructions),
  requirements,
  change_reason: z.enum(SHIFT_CHANGE_REASON_CODES).optional(),
});
export type PutSessionBody = z.output<typeof putSessionSchema>;

// A session's start and finish: the finish after the start, and less than a day later (the
// office's rule, src/lib/roster/shift-window.ts). Null when they're fine.
const DAY_MS = 24 * 60 * 60 * 1000;
export function windowProblem(startsAt: Date, endsAt: Date): ApiField | null {
  const length = endsAt.getTime() - startsAt.getTime();
  if (length <= 0) return { path: "ends_at", code: "not_after_start" };
  if (length >= DAY_MS) return { path: "ends_at", code: "over_24_hours" };
  return null;
}

export interface ApiField {
  path: string;
  code: string;
}

const MAX_FIELDS = 50;
const FIELD_NAME = /^[A-Za-z0-9_]{1,64}$/;

// Each problem's path (site.postcode, requirements.2) and code: zod's issue code
// ("invalid_type", "too_big", "unrecognized_keys"…) or a refinement's own ("bad_role"). An unknown
// field is named by its path (field names, never values); one that isn't a plain name is "?".
export function fieldsOf(error: z.ZodError): ApiField[] {
  const out: ApiField[] = [];
  const pathOf = (path: readonly PropertyKey[]) =>
    path
      .map((p) => (typeof p === "number" || FIELD_NAME.test(String(p)) ? String(p) : "?"))
      .join(".");
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        out.push({ path: pathOf([...issue.path, key]), code: "unrecognized_key" });
      }
      continue;
    }
    const own = issue.code === "custom" ? issue.params?.code : undefined;
    out.push({ path: pathOf(issue.path), code: typeof own === "string" ? own : issue.code });
  }
  return out.slice(0, MAX_FIELDS);
}

// --- GET /api/v1/cancellations ---

export const CANCELLATIONS_PAGE = 100;

// The keyset position after a record: its cancellation time to the microsecond (as Postgres keeps
// it, so a page never repeats or skips a row a millisecond would round) and its booking id.
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const cursorSchema = z.strictObject({ t: z.string().regex(CURSOR_TIME), b: z.uuid() });
export type CancellationCursor = z.output<typeof cursorSchema>;

export const encodeCursor = (c: CancellationCursor): string =>
  Buffer.from(JSON.stringify({ t: c.t, b: c.b })).toString("base64url");

export function decodeCursor(raw: string): CancellationCursor | null {
  if (raw.length === 0 || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const c = cursorSchema.safeParse(parsed);
  if (!c.success || Number.isNaN(Date.parse(c.data.t))) return null;
  // Only the exact form ShiftDesk gives out.
  return encodeCursor(c.data) === raw ? { t: c.data.t, b: c.data.b.toLowerCase() } : null;
}

export type CancellationsQuery =
  { from: "since"; since: Date } | { from: "cursor"; cursor: CancellationCursor };

// since= or cursor=, exactly one.
export function cancellationsQuery(
  url: URL,
): CancellationsQuery | { problem: "bad_since" | "bad_cursor" } {
  const since = url.searchParams.getAll("since");
  const cursor = url.searchParams.getAll("cursor");
  if (since.length + cursor.length !== 1) return { problem: "bad_since" };
  if (cursor[0] !== undefined) {
    const c = decodeCursor(cursor[0]);
    return c ? { from: "cursor", cursor: c } : { problem: "bad_cursor" };
  }
  const t = z.iso.datetime({ offset: true }).safeParse(since[0]);
  return t.success ? { from: "since", since: new Date(t.data) } : { problem: "bad_since" };
}
