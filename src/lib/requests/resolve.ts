import { eq } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { retryAborted } from "../db/retry";
import { requests } from "../db/schema";
import type { WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { queueRequestUpdate } from "../notices/request-update";
import { officeCanPlace, rosterId } from "../roster/book";

// The office answering a worker's request (docs/screens.md `/office/requests`; product spec P0-6).
// One transaction:
// - an active admin or resourcer (the roles that place staff);
// - the request row locked, so two office users can't both answer it; only an open (or escalated)
//   one can be answered;
// - approved or declined, with a note to the worker: optional to approve, required to decline (a
//   "no" needs a reason they can act on). At most 500 characters, kept on the row: it's free text,
//   so the event says only whether there was one;
// - request.approved / request.declined {type, shiftId, withNote}, and a request-update job to
//   tell the worker.
// Any kind (time change, swap, availability, question, review). Deciding doesn't change the shift:
// the office makes the change on the shift's page.

export const MAX_RESOLUTION_NOTE = 500;
export const REQUEST_DECISIONS = ["approved", "declined"] as const;
export type RequestDecision = (typeof REQUEST_DECISIONS)[number];

export const resolveRequestSchema = z.strictObject({
  requestId: rosterId,
  decision: z.enum(REQUEST_DECISIONS),
  note: z.string(), // at most MAX_RESOLUTION_NOTE once trimmed: checked below, with its own answer
  by: z.strictObject({ type: z.literal("office"), id: rosterId }),
});
export type ResolveRequestInput = z.input<typeof resolveRequestSchema>;

export type ResolveRequestResult =
  | { status: "resolved"; decision: RequestDecision }
  | { status: "already"; current: string } // answered already (by someone, or sorted itself)
  // A question from the shifts line whose message is still there: it's answered on Enquiries,
  // with the message locked (src/lib/office/enquiry-actions.ts), so it's never answered twice.
  | { status: "on_enquiries" }
  | { status: "note_needed" } // a decline with no note
  | { status: "note_too_long" }
  | { status: "not_found" }
  | { status: "not_allowed" };

export async function resolveRequest(
  run: WithFirm,
  firmId: string,
  raw: ResolveRequestInput,
  deps: { clock?: Clock } = {},
): Promise<ResolveRequestResult> {
  const input = resolveRequestSchema.parse(raw);
  const now = (deps.clock ?? systemClock).now();
  const note = input.note.trim();
  if (note.length > MAX_RESOLUTION_NOTE) return { status: "note_too_long" };
  if (input.decision === "declined" && !note) return { status: "note_needed" };
  return retryAborted(() =>
    run(firmId, async (tx): Promise<ResolveRequestResult> => {
      if (!(await officeCanPlace(tx, input.by.id))) return { status: "not_allowed" };
      const [request] = await tx
        .select({
          status: requests.status,
          type: requests.type,
          shiftId: requests.shiftId,
          messageId: requests.messageId,
        })
        .from(requests)
        .where(eq(requests.id, input.requestId))
        .for("no key update");
      if (!request) return { status: "not_found" };
      if (request.type === "general" && request.messageId !== null) {
        return { status: "on_enquiries" };
      }
      if (request.status !== "open" && request.status !== "escalated") {
        return { status: "already", current: request.status };
      }
      await tx
        .update(requests)
        .set({
          status: input.decision,
          resolvedBy: input.by.id,
          resolvedAt: now,
          resolutionNote: note || null,
        })
        .where(eq(requests.id, input.requestId));
      await recordEvent(tx, {
        actorType: "office",
        actorId: input.by.id,
        action: input.decision === "approved" ? "request.approved" : "request.declined",
        entityType: "request",
        entityId: input.requestId,
        data: { type: request.type, shiftId: request.shiftId, withNote: note !== "" },
      });
      await queueRequestUpdate(tx, { requestId: input.requestId });
      return { status: "resolved", decision: input.decision };
    }),
  );
}
