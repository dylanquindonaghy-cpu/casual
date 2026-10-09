import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActiveSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { StepUpRequiredError } from "@/lib/portal/pay";
import { myPayQueries, payQueryShifts, raisePayQuery } from "@/lib/portal/pay-queries";
import type { PayQueryInput } from "@/lib/portal/pay-query-kinds";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Pay queries (docs/architecture.md "Pay query"; docs/screens.md `/pay/query`): a worker's
// structured question about their pay, behind the pay-page code. On the real database, as the app
// role. NOW is Monday 2 November 2026, 09:00 London (GMT).

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(3);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const session = (workerId: string, steppedUpUntil: Date | null, kind = "worker"): ActiveSession =>
  ({
    id: "00000000-0000-4000-8000-000000000001",
    kind,
    subjectId: workerId,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    rotatedAt: NOW,
    steppedUpUntil,
    rotationDue: false,
  }) as ActiveSession;
const stepped = (workerId: string) => ({
  worker: { id: workerId },
  session: session(workerId, new Date(NOW.getTime() + 10 * 60_000)),
});

async function payFirm() {
  const f = await bookingFirm(su, withFirm);
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  const { rows } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, 'Riverside Arena') returning id::text as id",
    [f.firmId],
  );
  // Ann: Saturday 31 October 08:00 (worked), Wednesday 28 October (booked), next Saturday (ahead),
  // 10 weeks ago (too old for the list), and one she cancelled.
  const saturday = await f.shift({ startsAt: new Date("2026-10-31T08:00:00Z"), role: "steward" });
  await su.query("update shifts set site_id = $2 where id = $1", [saturday, rows[0]?.id]);
  const wednesday = await f.shift({ startsAt: new Date("2026-10-28T18:00:00Z") });
  const ahead = await f.shift({ startsAt: hoursFromNow(120) });
  const old = await f.shift({ startsAt: hoursFromNow(-24 * 70) });
  const cancelled = await f.shift({ startsAt: new Date("2026-10-30T08:00:00Z") });
  await f.booking(ann, saturday, "completed");
  await f.booking(ann, wednesday, "confirmed");
  await f.booking(ann, ahead, "confirmed");
  await f.booking(ann, old, "completed");
  await f.booking(ann, cancelled, "cancelled_worker");
  const ctx = (when = NOW) => ({
    firm: { id: f.firmId, timezone: "Europe/London", signOff: "Acme Events Shift Team" },
    run: withFirm,
    clock: { now: () => when },
  });
  const raise = (input: Partial<PayQueryInput>, who = ann, when = NOW) =>
    raisePayQuery(ctx(when), stepped(who), {
      shiftId: null,
      day: null,
      issue: "missing_hours",
      details: null,
      ...input,
    });
  return { f, ann, ben, saturday, wednesday, ahead, old, cancelled, ctx, raise };
}

const queriesOf = async (firmId: string) =>
  (
    await su.query(
      `select worker_id::text as worker_id, shift_id::text as shift_id, work_date::text as work_date,
              issue_type, details, group_key, status
         from pay_queries where firm_id = $1 order by created_at, id`,
      [firmId],
    )
  ).rows;

describe("raising a pay query", () => {
  it("lists the worker's own shifts from the last 8 weeks that have started, newest first", async () => {
    const t = await payFirm();
    const shifts = await payQueryShifts(t.ctx(), stepped(t.ann));
    expect(shifts).toEqual([
      {
        shiftId: t.saturday,
        label: "Sat 31 Oct, 08:00 to 16:00 · Steward at Riverside Arena",
        day: "2026-10-31",
      },
      {
        shiftId: t.wednesday,
        label: "Wed 28 Oct, 18:00 to 02:00 Thu · Door supervisor",
        day: "2026-10-28",
      },
    ]);
    expect(await payQueryShifts(t.ctx(), stepped(t.ben))).toEqual([]);
  });

  it("about a shift: stored with its day, logged without the details, and a confirmation", async () => {
    const t = await payFirm();
    const result = await t.raise({
      shiftId: t.saturday,
      issue: "wrong_rate",
      details: "Paid £11 an hour, not £13. My card ends 4321.",
    });
    expect(result).toMatchObject({
      status: "created",
      issue: "wrong_rate",
      when: "Sat 31 Oct, 08:00 to 16:00",
      sentAt: "09:00 on Mon 2 Nov",
      signOff: "Acme Events Shift Team",
    });
    expect(await queriesOf(t.f.firmId)).toEqual([
      {
        worker_id: t.ann,
        shift_id: t.saturday,
        work_date: "2026-10-31",
        issue_type: "wrong_rate",
        details: "Paid £11 an hour, not £13. My card ends 4321.",
        // Grouped by code: wrong rate, the week of Mon 26 Oct, no pay line imported for the day.
        group_key: "pay1:wrong_rate:2026-10-26:rate:none",
        status: "open",
      },
    ]);
    const { rows } = await su.query<{
      action: string;
      actor_id: string;
      data: Record<string, unknown>;
    }>(
      "select action, actor_id::text as actor_id, data from events where firm_id = $1 and action like 'pay_query.%'",
      [t.f.firmId],
    );
    expect(rows).toEqual([
      {
        action: "pay_query.created",
        actor_id: t.ann,
        data: {
          issueType: "wrong_rate",
          shiftId: t.saturday,
          workDate: "2026-10-31",
          groupKey: "pay1:wrong_rate:2026-10-26:rate:none",
        },
      },
    ]);
    expect(result.status === "created" && result.ref).toMatch(/^[0-9A-F]{8}$/);
  });

  it("about a day: today back to 90 days ago, not ahead", async () => {
    const t = await payFirm();
    expect(await t.raise({ day: "2026-11-02", issue: "late_pay" })).toMatchObject({
      status: "created",
      when: "Mon 2 Nov",
    });
    expect(await t.raise({ day: "2026-08-04", issue: "late_pay" })).toMatchObject({
      status: "created",
    });
    expect(await t.raise({ day: "2026-11-03" })).toEqual({
      status: "invalid",
      problems: ["future_day"],
    });
    expect(await t.raise({ day: "2026-08-03" })).toEqual({
      status: "invalid",
      problems: ["too_old"],
    });
    expect(await t.raise({})).toEqual({ status: "invalid", problems: ["no_shift_or_day"] });
    expect((await queriesOf(t.f.firmId)).map((q) => [q.work_date, q.shift_id])).toEqual([
      ["2026-11-02", null],
      ["2026-08-04", null],
    ]);
  });

  it("only the worker's own shifts from the list: not ahead, too old, cancelled, someone else's or another firm's", async () => {
    const t = await payFirm();
    const other = await payFirm();
    for (const shiftId of [t.ahead, t.old, t.cancelled, other.saturday]) {
      expect(await t.raise({ shiftId })).toEqual({ status: "not_yours" });
    }
    expect(await t.raise({ shiftId: t.saturday }, t.ben)).toEqual({ status: "not_yours" });
    expect(await queriesOf(t.f.firmId)).toEqual([]);
  });

  it("the same question again gives its reference; a different issue, or after it's sorted, is new", async () => {
    const t = await payFirm();
    const first = await t.raise({ shiftId: t.saturday });
    const again = await t.raise({ shiftId: t.saturday, details: "Still missing" });
    expect(again).toEqual({
      status: "already_open",
      ref: first.status === "created" ? first.ref : "",
    });
    expect(await t.raise({ shiftId: t.saturday, issue: "late_pay" })).toMatchObject({
      status: "created",
    });
    // The same day without the shift is a different question.
    expect(await t.raise({ day: "2026-10-31" })).toMatchObject({ status: "created" });
    await su.query("update pay_queries set status = 'resolved' where firm_id = $1", [t.f.firmId]);
    expect(await t.raise({ shiftId: t.saturday })).toMatchObject({ status: "created" });
    // Two taps at once: one query.
    const both = await Promise.all([
      t.raise({ shiftId: t.wednesday, issue: "other", details: "?" }),
      t.raise({ shiftId: t.wednesday, issue: "other", details: "?" }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual(["already_open", "created"]);
    expect(await queriesOf(t.f.firmId)).toHaveLength(5);
  });

  it("only with the pay code from the last 30 minutes, for this worker", async () => {
    const t = await payFirm();
    const noCode = { worker: { id: t.ann }, session: session(t.ann, null) };
    const expired = { worker: { id: t.ann }, session: session(t.ann, hoursFromNow(-1)) };
    const someoneElse = { worker: { id: t.ann }, session: session(t.ben, hoursFromNow(1)) };
    const office = { worker: { id: t.ann }, session: session(t.ann, hoursFromNow(1), "office") };
    const input = { shiftId: null, day: "2026-11-01", issue: "late_pay", details: null } as const;
    for (const s of [noCode, expired, someoneElse, office]) {
      await expect(raisePayQuery(t.ctx(), s, input)).rejects.toThrow(StepUpRequiredError);
      await expect(payQueryShifts(t.ctx(), s)).rejects.toThrow(StepUpRequiredError);
      await expect(myPayQueries(t.ctx(), s)).rejects.toThrow(StepUpRequiredError);
    }
    expect(await queriesOf(t.f.firmId)).toEqual([]);
  });

  it("the worker's own queries from the last 90 days, newest first, with their status", async () => {
    const t = await payFirm();
    await t.raise({ day: "2026-10-01", issue: "late_pay" });
    await t.raise({ shiftId: t.saturday, issue: "missing_hours" });
    await t.raise({ day: "2026-10-20", issue: "other", details: "Holiday pay?" }, t.ben);
    await su.query(
      "update pay_queries set status = 'resolved' where firm_id = $1 and issue_type = 'late_pay'",
      [t.f.firmId],
    );
    // One from four months ago doesn't show.
    await su.query(
      `insert into pay_queries (firm_id, worker_id, work_date, issue_type, created_at)
       values ($1, $2, '2026-06-01', 'wrong_rate', '2026-07-01T10:00:00Z')`,
      [t.f.firmId, t.ann],
    );
    const mine = await myPayQueries(t.ctx(), stepped(t.ann));
    expect(mine.map((q) => [q.issue, q.day, q.status])).toEqual([
      ["missing_hours", "2026-10-31", "open"],
      ["late_pay", "2026-10-01", "resolved"],
    ]);
  });
});
