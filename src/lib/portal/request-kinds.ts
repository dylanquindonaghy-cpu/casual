import { z } from "zod";

// The browser-safe half of worker requests (docs/screens.md, `/requests`, `/requests/new`): the
// kinds a worker can ask for, their fields, the payload check, the outcome shape and the status
// wording. No database code may be imported here: the request form (a client component) uses it
// (tests/unit/client-boundary.test.ts).

export const WORKER_REQUEST_KINDS = ["time_change", "swap"] as const;
export type WorkerRequestKind = (typeof WORKER_REQUEST_KINDS)[number];

export const KIND_LABELS: Record<WorkerRequestKind, string> = {
  time_change: "Change the times",
  swap: "Swap with someone",
};

// The request kinds as the list names them (every kind in the table, for requests made elsewhere).
export const KIND_NAMES: Record<string, string> = {
  time_change: "Time change",
  swap: "Swap",
  availability: "Availability",
  general: "Question",
  review: "Review",
};

export const MAX_REQUEST_NOTE = 500;
export const MAX_SWAP_WITH = 100;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "a time like 09:30");
const note = z.string().trim().max(MAX_REQUEST_NOTE);

// What's stored in requests.payload for each kind (validated here; the table only checks it's an
// object). Times are the worker's local wall-clock times, as they'd say them.
export const requestPayloadSchemas = {
  time_change: z.strictObject({ start: time, end: time, note }).refine((p) => p.start !== p.end, {
    message: "the start and finish must differ",
  }),
  swap: z.strictObject({ swapWith: z.string().trim().max(MAX_SWAP_WITH), note }),
} as const;

export type RequestPayload =
  | z.infer<(typeof requestPayloadSchemas)["time_change"]>
  | z.infer<(typeof requestPayloadSchemas)["swap"]>;

// The form's fields as typed (all strings), checked for one kind. Null means not acceptable.
export function requestPayload(
  kind: WorkerRequestKind,
  fields: Record<string, string>,
): RequestPayload | null {
  const input =
    kind === "time_change"
      ? { start: fields.start ?? "", end: fields.end ?? "", note: fields.note ?? "" }
      : { swapWith: fields.swapWith ?? "", note: fields.note ?? "" };
  const parsed = requestPayloadSchemas[kind].safeParse(input);
  return parsed.success ? parsed.data : null;
}

// Plain words for each status. Escalation is the office's own business: to the worker, it's
// still waiting.
export const STATUS_WORDS: Record<string, string> = {
  open: "Waiting for the office",
  escalated: "Waiting for the office",
  approved: "Approved",
  declined: "Declined",
  auto_resolved: "Sorted",
};

// One request's status in words: a question (`general`) the office approved reads "Answered"
// ("approved" can read as "booked": PLAN.md Messages 13). Stored `approved` all the same.
export function statusWord(type: string, status: string): string {
  if (type === "general" && status === "approved") return "Answered";
  return STATUS_WORDS[status] ?? status;
}

export type CreateRequestOutcome =
  | {
      status: "created";
      ref: string; // the first 8 characters of the request's id, upper case
      kind: WorkerRequestKind;
      when: string | null; // the shift: "Sat 7 Nov, 14:00 to 22:00"
      asked: string | null; // what they asked for: "15:00 to 23:00" (time change), else null
      sentAt: string; // "09:14 on Mon 2 Nov", the firm's local time
      signOff: string;
    }
  | { status: "already_open"; ref: string; kind: WorkerRequestKind } // one already waiting
  | { status: "not_yours" } // not their upcoming booking (or it has started)
  | { status: "invalid" } // the form's fields didn't pass the check
  | { status: "logged_out" }
  | { status: "error" };

// "Ask the office to review" (docs/screens.md, `/shifts/[id]`): the worker asks the office to look
// again at a shift the rules won't let them take. The payload keeps the rules' codes and the
// reasons the worker was shown, and their optional note; the office decides (Phase 5).
export const MAX_REVIEW_ITEMS = 20;
export const MAX_REASON = 300;
export const reviewPayloadSchema = z.strictObject({
  codes: z.array(z.string().max(50)).max(MAX_REVIEW_ITEMS),
  reasons: z.array(z.string().max(MAX_REASON)).max(MAX_REVIEW_ITEMS),
  note,
  // "Tell us what happened" after cancelling (12C.1): the cancelled booking's reference.
  cancellation: z
    .string()
    .regex(/^[0-9A-F]{8}$/)
    .optional(),
});
export type ReviewPayload = z.infer<typeof reviewPayloadSchema>;

export type ReviewOutcome =
  | {
      status: "created";
      ref: string; // the first 8 characters of the request's id, upper case
      sentAt: string; // "09:14 on Mon 2 Nov", the firm's local time
      signOff: string;
    }
  | { status: "already_open"; ref: string } // one already waiting for this shift
  | { status: "eligible_now" } // the rules now say yes (it may still be held by fair rotation)
  | { status: "already_booked" }
  | { status: "not_open" } // filled, started, cancelled or not there
  | { status: "invalid" } // the note is too long
  | { status: "logged_out" }
  | { status: "error" };
