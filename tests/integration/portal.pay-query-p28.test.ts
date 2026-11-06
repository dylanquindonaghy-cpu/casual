import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MINUTE } from "@/lib/auth/clock";
import { sendLoginCode } from "@/lib/auth/send-login-code";
import { createSession, findSession, type ActiveSession } from "@/lib/auth/sessions";
import { isSteppedUp, verifyStepUpCode } from "@/lib/auth/step-up";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { resolvePayQueries } from "@/lib/pay/resolve";
import { StepUpRequiredError } from "@/lib/portal/pay";
import {
  myPayQueries,
  payQueryShifts,
  raisePayQuery,
  seePayAnswers,
} from "@/lib/portal/pay-queries";
import {
  isPayQueryPath,
  payQueryPath,
  preselectedShift,
  type PayIssue,
} from "@/lib/portal/pay-query-kinds";
import { unseenPayAnswers } from "@/lib/portal/request-answers";
import { tabCounts } from "@/lib/portal/tab-counts";
import { captureTransport } from "../helpers/auth";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Phase 28.10 (docs/screens.md "### 28.10"; src/app/pay/, src/lib/portal/pay-queries.ts,
// pay-query-kinds.ts) on the real database as the app role: /pay/query?shift= chooses only one of
// her own shifts (never another casual's, never another firm's); the code step on the pay query
// opens it with a real code and comes back only to /pay/query; payroll's answers count on the Pay
// tab until an answer is shown through the seen action, and the page's own reads never clear them.
// NOW is Monday 2 November 2026, 09:00 London (GMT).

const SECRET = "test-only-secret-not-for-any-real-use-2810";

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

const fakeSession = (workerId: string, steppedUpUntil: Date | null): ActiveSession =>
  ({
    id: randomUUID(),
    kind: "worker",
    subjectId: workerId,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    rotatedAt: NOW,
    steppedUpUntil,
    rotationDue: false,
  }) as ActiveSession;
// A session that passed the code, open for 25 more minutes from `at` (NOW by default).
const stepped = (workerId: string, at = NOW) => ({
  worker: { id: workerId },
  session: fakeSession(workerId, new Date(at.getTime() + 25 * MINUTE)),
});
const notStepped = (workerId: string) => ({
  worker: { id: workerId },
  session: fakeSession(workerId, null),
});

// Two firms. In A, Ann worked Saturday 31 October and Ben worked Friday 30 October; in B, Cal
// worked Saturday too.
async function scene() {
  const a = await bookingFirm(su, withFirm);
  const b = await bookingFirm(su, withFirm);
  const ann = await a.worker({ first: "Ann" });
  const ben = await a.worker({ first: "Ben" });
  const cal = await b.worker({ first: "Cal" });
  const annShift = await a.shift({ startsAt: new Date("2026-10-31T08:00:00Z") });
  const benShift = await a.shift({ startsAt: new Date("2026-10-30T08:00:00Z") });
  const calShift = await b.shift({ startsAt: new Date("2026-10-31T08:00:00Z") });
  await a.booking(ann, annShift, "completed");
  await a.booking(ben, benShift, "completed");
  await b.booking(cal, calShift, "completed");
  const payroll = await a.office("payroll");
  const ctx = (firmId: string, when = NOW) => ({
    firm: { id: firmId, timezone: "Europe/London", signOff: "Acme Events Shift Team" },
    run: withFirm,
    clock: { now: () => when },
  });
  return { a, b, ann, ben, cal, annShift, benShift, calShift, payroll, ctx };
}

describe("/pay/query?shift= (28.10)", () => {
  it("chooses her own shift; another casual's, another firm's or a made-up one is ignored", async () => {
    const t = await scene();
    const mine = await payQueryShifts(t.ctx(t.a.firmId), stepped(t.ann));
    expect(mine.map((s) => s.shiftId)).toEqual([t.annShift]);

    expect(preselectedShift(mine, t.annShift)).toBe(t.annShift);
    expect(preselectedShift(mine, t.annShift.toUpperCase())).toBe(t.annShift);
    // Ben's shift, in her own firm: not hers, so not chosen.
    expect(preselectedShift(mine, t.benShift)).toBeNull();
    // Firm B's shift: never in her list.
    expect(preselectedShift(mine, t.calShift)).toBeNull();
    expect(preselectedShift(mine, randomUUID())).toBeNull();
    expect(preselectedShift(mine, "../office")).toBeNull();

    // Her list in firm B's transaction is empty (row level security), so nothing is chosen there.
    const acrossFirms = await payQueryShifts(t.ctx(t.b.firmId), stepped(t.ann));
    expect(acrossFirms).toEqual([]);
    expect(preselectedShift(acrossFirms, t.annShift)).toBeNull();

    // And sending one that isn't hers is refused by the server anyway.
    const raise = (shiftId: string) =>
      raisePayQuery(t.ctx(t.a.firmId), stepped(t.ann), {
        shiftId,
        day: null,
        issue: "wrong_rate",
        details: null,
      });
    expect(await raise(t.benShift)).toEqual({ status: "not_yours" });
    expect(await raise(t.calShift)).toEqual({ status: "not_yours" });
    expect((await raise(t.annShift)).status).toBe("created");
  });

  it("the code step: a real code opens the query, and it comes back only to /pay/query", async () => {
    const t = await scene();
    const firm = { id: t.a.firmId };
    const session = await withFirm(t.a.firmId, (tx) =>
      createSession(tx, { kind: "worker", subjectId: t.ann, now: NOW }),
    );
    const active = async (at: Date) =>
      withFirm(t.a.firmId, (tx) =>
        findSession(tx, { kind: "worker", token: session.token, now: at }),
      );
    const before = await active(NOW);
    if (!before) throw new Error("no session");
    // Before the code: the query's shifts can't be read, so the page shows the code step.
    await expect(
      payQueryShifts(t.ctx(t.a.firmId), { worker: { id: t.ann }, session: before }),
    ).rejects.toBeInstanceOf(StepUpRequiredError);

    // The same code as the pay page's: sent by the job, typed in, 30 minutes open.
    const { transport } = captureTransport();
    const sent = await sendLoginCode(
      { firmId: t.a.firmId, idempotencyKey: randomUUID(), sessionId: session.id },
      withFirm,
      { transport, clock: { now: () => NOW }, secret: SECRET, newCode: () => "281028" },
    );
    expect(sent.sent).toBe(true);
    const checked = await verifyStepUpCode(
      {
        firm,
        run: withFirm,
        clock: { now: () => new Date(NOW.getTime() + MINUTE) },
        secret: SECRET,
      },
      session.token,
      "281028",
    );
    expect(checked.status).toBe("ok");
    const after = await active(new Date(NOW.getTime() + 2 * MINUTE));
    if (!after) throw new Error("no session");
    expect(isSteppedUp(after, new Date(NOW.getTime() + 2 * MINUTE))).toBe(true);
    expect(after.steppedUpUntil?.getTime()).toBe(NOW.getTime() + 31 * MINUTE);

    // Where the page sends her: the address's shift only, whatever else the address carries.
    const address = { shift: t.annShift, next: "https://evil.example/pay", returnTo: "//evil" };
    const back = payQueryPath(address.shift);
    expect(back).toBe(`/pay/query?shift=${t.annShift}`);
    expect(isPayQueryPath(back)).toBe(true);
    expect(back).not.toContain("evil");
    for (const crafted of ["https://evil.example/pay", "//evil.example", "/office", undefined]) {
      expect(payQueryPath(crafted)).toBe("/pay/query");
    }
    for (const path of ["https://evil.example", "/pay/query?next=/office", "/pay", "/office"]) {
      expect(isPayQueryPath(path)).toBe(false);
    }

    // Back on the query, open now: her shift is chosen.
    const shifts = await payQueryShifts(t.ctx(t.a.firmId, new Date(NOW.getTime() + 2 * MINUTE)), {
      worker: { id: t.ann },
      session: after,
    });
    expect(preselectedShift(shifts, address.shift)).toBe(t.annShift);
  });
});

describe("payroll's answers on the Pay tab (28.10)", () => {
  it("count once sorted, stay through the page's reads, and go once shown through the seen action", async () => {
    const t = await scene();
    const A = (h: number) => t.ctx(t.a.firmId, hoursFromNow(h));
    const annAt = (h: number) => stepped(t.ann, hoursFromNow(h)); // her code still open then
    // Her marker as when her row was made, before any of this (the column's default is the real
    // time, after this test's NOW).
    await su.query("update workers set pay_answers_read_at = $2 where id in ($1, $3)", [
      t.ann,
      hoursFromNow(-24),
      t.ben,
    ]);
    const raise = async (issue: PayIssue, who = t.ann) => {
      const r = await raisePayQuery(A(0), stepped(who), {
        shiftId: null,
        day: "2026-10-30",
        issue,
        details: null,
      });
      if (r.status !== "created") throw new Error(`not raised: ${r.status}`);
      const { rows } = await su.query<{ id: string }>(
        "select id::text as id from pay_queries where worker_id = $1 and issue_type = $2",
        [who, issue],
      );
      return rows[0]?.id ?? "";
    };
    const sort = (ids: string[], h: number) =>
      resolvePayQueries(
        withFirm,
        t.a.firmId,
        { ids, note: "Paid on Friday with the rest.", by: { type: "office", id: t.payroll } },
        { clock: { now: () => hoursFromNow(h) } },
      );

    const late = await raise("late_pay");
    const bens = await raise("late_pay", t.ben);
    expect(await unseenPayAnswers(A(1), t.ann)).toBe(0); // with payroll: nothing to count

    expect(await sort([late, bens], 1)).toMatchObject({ status: "sorted", count: 2 });
    expect((await tabCounts(A(2), t.ann)).payAnswers).toBe(1);

    // What the Pay page reads to draw itself marks nothing: the answer, then the count.
    const shown = await myPayQueries(A(2), annAt(2));
    expect(shown[0]).toMatchObject({ status: "resolved", note: "Paid on Friday with the rest." });
    expect(await unseenPayAnswers(A(2), t.ann)).toBe(1);
    expect(await unseenPayAnswers(A(2), t.ann)).toBe(1);

    // Without the code, the seen action can't mark it.
    await expect(seePayAnswers(A(2), notStepped(t.ann), hoursFromNow(2))).rejects.toBeInstanceOf(
      StepUpRequiredError,
    );
    // From firm B's side, nothing of hers moves.
    expect(await seePayAnswers(t.ctx(t.b.firmId, hoursFromNow(2)), annAt(2), hoursFromNow(2))).toBe(
      false,
    );
    expect(await unseenPayAnswers(A(2), t.ann)).toBe(1);

    // Shown through the seen action (the page drawn at hour 2): the count goes, Ben's stays.
    expect(await seePayAnswers(A(2), annAt(2), hoursFromNow(2))).toBe(true);
    expect((await tabCounts(A(2), t.ann)).payAnswers).toBe(0);
    expect(await unseenPayAnswers(A(2), t.ben)).toBe(1);
    expect(await seePayAnswers(A(2), annAt(2), hoursFromNow(2))).toBe(false); // nothing new

    // An answer sorted after the page was drawn still counts, whenever the action arrives.
    const rate = await raise("wrong_rate");
    expect(await sort([rate], 3)).toMatchObject({ status: "sorted", count: 1 });
    expect(await seePayAnswers(A(4), annAt(4), hoursFromNow(2))).toBe(false);
    expect(await unseenPayAnswers(A(4), t.ann)).toBe(1);
    // A drawing time in the future is held to now.
    expect(await seePayAnswers(A(2.5), annAt(2.5), hoursFromNow(99))).toBe(false);
    expect(await unseenPayAnswers(A(4), t.ann)).toBe(1);
    expect(await seePayAnswers(A(4), annAt(4), hoursFromNow(4))).toBe(true);
    expect(await unseenPayAnswers(A(4), t.ann)).toBe(0);

    // The marking changes no pay query.
    const { rows } = await su.query<{ status: string }>(
      "select status from pay_queries where worker_id = $1 order by created_at",
      [t.ann],
    );
    expect(rows.map((r) => r.status)).toEqual(["resolved", "resolved"]);
  });
});
