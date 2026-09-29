import { and, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { DAY, systemClock } from "../auth/clock";
import type { ActiveSession } from "../auth/sessions";
import { isSteppedUp } from "../auth/step-up";
import { assignments, payQueries, shifts, sites } from "../db/schema";
import { withFirm, type FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { dayLabel } from "../rules/reasons";
import { addDays, localDateOf, wallTimeOf } from "../time/zoned";
import { roleLabel, shiftWhen } from "./format";
import type { PortalContext } from "./my-shifts";
import { StepUpRequiredError } from "./pay";
import {
  PAY_QUERY_DAYS_BACK,
  PAY_QUERY_SHIFT_WEEKS,
  type PayIssue,
  type PayQueryInput,
  type RaisePayQueryOutcome,
} from "./pay-query-kinds";

// Pay queries (docs/architecture.md "Pay query"; docs/screens.md `/pay`, `/pay/query`): a worker's
// structured question about their pay, for payroll. Server only; the browser-safe half is
// pay-query-kinds.ts. Every function here is for a session that passed the pay-page code in the
// last 30 minutes, and checks that itself (the rule on steppedUpWorker()).
// - payQueryShifts: the worker's shifts that started in the last 8 weeks (booked, worked or marked
//   not attended), newest first, for the form's picker;
// - myPayQueries: their queries from the last 90 days, newest first, with their status;
// - raisePayQuery: a shift of theirs from that list, or a day in the last 90 days (not ahead); an
//   issue; details (required for "Something else"). One open query per worker, day, shift and
//   issue: asking again returns its reference. The row and a pay_query.created event {issueType,
//   shiftId, workDate} go in together; the typed details stay on the row, never in the log. No
//   AI reads or answers any of it (golden rule 9).

type Ctx = PortalContext & { firm: { id: string; timezone: string; signOff: string } };
type Stepped = { worker: { id: string }; session: ActiveSession };

const LIVE = ["confirmed", "completed", "no_show"] as const;
const refOf = (id: string) => id.slice(0, 8).toUpperCase();
const pad = (n: number) => String(n).padStart(2, "0");

function checkStepped(stepped: Stepped, now: Date): void {
  const { session, worker } = stepped;
  if (session.kind !== "worker" || session.subjectId !== worker.id || !isSteppedUp(session, now)) {
    throw new StepUpRequiredError();
  }
}

export interface PayQueryShift {
  shiftId: string;
  label: string; // "Sat 7 Nov, 08:00 to 16:00 · Steward at Riverside Arena"
  day: string; // the shift's day, firm time
}

async function shiftsOf(tx: FirmTx, workerId: string, now: Date, timeZone: string) {
  const rows = await tx
    .select({
      shiftId: shifts.id,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      role: shifts.role,
      site: sites.name,
    })
    .from(assignments)
    .innerJoin(
      shifts,
      and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
    )
    .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
    .where(
      and(
        eq(assignments.workerId, workerId),
        inArray(assignments.status, [...LIVE]),
        lte(shifts.startsAt, now),
        gt(shifts.startsAt, new Date(now.getTime() - PAY_QUERY_SHIFT_WEEKS * 7 * DAY)),
      ),
    )
    .orderBy(desc(shifts.startsAt))
    .limit(100);
  return rows.map((r) => ({
    shiftId: r.shiftId,
    when: shiftWhen(r.startsAt, r.endsAt, timeZone),
    label: `${shiftWhen(r.startsAt, r.endsAt, timeZone)} · ${roleLabel(r.role)}${r.site ? ` at ${r.site}` : ""}`,
    day: localDateOf(r.startsAt, timeZone),
  }));
}

export async function payQueryShifts(ctx: Ctx, stepped: Stepped): Promise<PayQueryShift[]> {
  const now = (ctx.clock ?? systemClock).now();
  checkStepped(stepped, now);
  const run = ctx.run ?? withFirm;
  const rows = await run(ctx.firm.id, (tx) =>
    shiftsOf(tx, stepped.worker.id, now, ctx.firm.timezone),
  );
  return rows.map(({ shiftId, label, day }) => ({ shiftId, label, day }));
}

export interface MyPayQuery {
  ref: string;
  issue: PayIssue;
  day: string; // the day worked
  status: string;
  createdAt: Date;
}

export async function myPayQueries(ctx: Ctx, stepped: Stepped): Promise<MyPayQuery[]> {
  const now = (ctx.clock ?? systemClock).now();
  checkStepped(stepped, now);
  const run = ctx.run ?? withFirm;
  const rows = await run(ctx.firm.id, (tx) =>
    tx
      .select({
        id: payQueries.id,
        issue: payQueries.issueType,
        day: payQueries.workDate,
        status: payQueries.status,
        createdAt: payQueries.createdAt,
      })
      .from(payQueries)
      .where(
        and(
          eq(payQueries.workerId, stepped.worker.id),
          gt(payQueries.createdAt, new Date(now.getTime() - PAY_QUERY_DAYS_BACK * DAY)),
        ),
      )
      .orderBy(desc(payQueries.createdAt), desc(payQueries.id)),
  );
  return rows.map((r) => ({
    ref: refOf(r.id),
    issue: r.issue,
    day: r.day,
    status: r.status,
    createdAt: r.createdAt,
  }));
}

export async function raisePayQuery(
  ctx: Ctx,
  stepped: Stepped,
  input: PayQueryInput,
): Promise<RaisePayQueryOutcome> {
  const now = (ctx.clock ?? systemClock).now();
  checkStepped(stepped, now);
  const workerId = stepped.worker.id;
  const tz = ctx.firm.timezone;
  const today = localDateOf(now, tz);
  if (!input.shiftId) {
    if (!input.day) return { status: "invalid", problems: ["no_shift_or_day"] };
    if (input.day > today) return { status: "invalid", problems: ["future_day"] };
    if (input.day < addDays(today, -PAY_QUERY_DAYS_BACK)) {
      return { status: "invalid", problems: ["too_old"] };
    }
  }
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx): Promise<RaisePayQueryOutcome> => {
    // One at a time per worker, so two taps can't both find no open query and both add one.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('pay-query:' || app_current_firm_id()::text || ':' || ${workerId}, 0))`,
    );
    let workDate: string;
    let when: string;
    if (input.shiftId) {
      const shift = (await shiftsOf(tx, workerId, now, tz)).find(
        (s) => s.shiftId === input.shiftId,
      );
      if (!shift) return { status: "not_yours" };
      workDate = shift.day;
      when = shift.when;
    } else {
      workDate = input.day ?? today;
      when = dayLabel(workDate);
    }
    const [waiting] = await tx
      .select({ id: payQueries.id })
      .from(payQueries)
      .where(
        and(
          eq(payQueries.workerId, workerId),
          eq(payQueries.workDate, workDate),
          eq(payQueries.issueType, input.issue),
          input.shiftId
            ? eq(payQueries.shiftId, input.shiftId)
            : sql`${payQueries.shiftId} is null`,
          inArray(payQueries.status, ["open", "in_digest"]),
        ),
      );
    if (waiting) return { status: "already_open", ref: refOf(waiting.id) };
    const [created] = await tx
      .insert(payQueries)
      .values({
        firmId: ctx.firm.id,
        workerId,
        shiftId: input.shiftId,
        workDate,
        issueType: input.issue,
        details: input.details,
      })
      .returning({ id: payQueries.id });
    if (!created) throw new Error("pay query insert returned nothing");
    await recordEvent(tx, {
      actorType: "worker",
      actorId: workerId,
      action: "pay_query.created",
      entityType: "pay_query",
      entityId: created.id,
      data: { issueType: input.issue, shiftId: input.shiftId, workDate },
    });
    const w = wallTimeOf(now, tz);
    return {
      status: "created",
      ref: refOf(created.id),
      issue: input.issue,
      when,
      sentAt: `${pad(w.hour)}:${pad(w.minute)} on ${dayLabel(today)}`,
      signOff: ctx.firm.signOff,
    };
  });
}
