import { inArray } from "drizzle-orm";
import { z } from "zod";
import { workers } from "../db/schema";
import { declineAsk, type DeclineAskResult } from "../roster/asks";
import { officeCanPlace, type BookingResult } from "../roster/book";
import { assignWorker } from "./quick-actions";
import { parts, type OfficeContext } from "./office-context";

// The office's side of "Casuals ask, you choose" on a session's page (Phase 26.6, ses-3, ses-4):
// "Not this time" for one ask (declineAsk), and "Book the best N": the people the office confirmed
// (the page's best asks, most reliable first, as many as places free), each booked in turn through
// the one booking path (bookShift by the office: every rule and licence check, first yes wins),
// and only while their ask is still waiting (checked under the shift's lock in the booking's own
// transaction: someone answered or booked since is left alone). A refusal on the way is reported
// and the next is tried; a full session stops it. Nobody the office didn't confirm is booked.

export function notThisTime(
  ctx: OfficeContext,
  shiftId: string,
  workerId: string,
): Promise<DeclineAskResult> {
  const { run, deps } = parts(ctx);
  return declineAsk(run, ctx.firm.id, { shiftId, workerId, by: ctx.officeUserId }, deps);
}

export const BOOK_BEST_MAX = 50;
export const bookBestSchema = z.array(z.uuid()).min(1).max(BOOK_BEST_MAX);

export type BookBestResult =
  | {
      status: "done";
      booked: string[]; // names
      notAsking: string[]; // answered since the page was drawn: not booked
      refused: { name: string; result: BookingResult }[];
    }
  | { status: "nobody" } // nobody confirmed
  | { status: "not_allowed" };

export async function bookTheBest(
  ctx: OfficeContext,
  shiftId: string,
  workerIds: string[],
): Promise<BookBestResult> {
  const ids = bookBestSchema.safeParse([...new Set(workerIds)]);
  if (!ids.success) return { status: "nobody" };
  const { run } = parts(ctx);
  const names = await run(ctx.firm.id, async (tx) => {
    if (!(await officeCanPlace(tx, ctx.officeUserId))) return null;
    const rows = await tx
      .select({ id: workers.id, first: workers.firstName, last: workers.lastName })
      .from(workers)
      .where(inArray(workers.id, ids.data));
    return new Map(rows.map((w) => [w.id, `${w.first} ${w.last}`]));
  });
  if (names === null) return { status: "not_allowed" };
  const booked: string[] = [];
  const notAsking: string[] = [];
  const refused: { name: string; result: BookingResult }[] = [];
  for (const workerId of ids.data) {
    const name = names.get(workerId);
    if (!name) continue; // not this firm's
    const result = await assignWorker(ctx, shiftId, workerId, null, { fromAsk: true });
    if (result.status === "booked") booked.push(name);
    else if (result.status === "filled") break;
    else if (result.status === "not_asking") notAsking.push(name);
    else refused.push({ name, result });
  }
  return { status: "done", booked, notAsking, refused };
}
