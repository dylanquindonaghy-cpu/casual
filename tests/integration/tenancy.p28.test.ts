import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { receiveAppMessage } from "@/lib/inbound/app";
import {
  markAnswersSeen,
  markPayAnswersSeen,
  unseenAnswers,
  unseenPayAnswers,
} from "@/lib/portal/request-answers";
import { askAboutMark, myRequests, withdrawRequest } from "@/lib/portal/requests";
import { confirmStillComing } from "@/lib/portal/still-coming";
import { tabCounts } from "@/lib/portal/tab-counts";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { inFirm, pgError, run } from "../helpers/rls-probe";
import { createTenant, FK_CASES } from "../helpers/tenant-rows";

// Phase 28.2 across firms and across casuals in one firm (golden rule 2): every new function, run
// in firm A's transaction with firm B's ids (or another casual's), changes nothing and sees
// nothing; the new foreign key is composite (FK_CASES.messages_shift_fk, which
// tenancy.isolation.test.ts also runs); RLS stays forced on the tables the new columns sit on.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const SECRET = "test-session-secret-for-p28-tenancy-0123456789";

async function firmWithEverything() {
  const f = await bookingFirm(su, withFirm);
  const casual = await f.worker();
  const office = await f.office("resourcer");
  const soon = await f.shift({ startsAt: hoursFromNow(5) });
  const past = await f.shift({ startsAt: hoursFromNow(-30) });
  const booking = await f.booking(casual, soon);
  await f.booking(casual, past, "no_show");
  const { rows } = await su.query<{ id: string }>(
    `insert into requests (firm_id, worker_id, type) values ($1, $2, 'general')
     returning id::text as id`,
    [f.firmId, casual],
  );
  const request = rows[0]?.id ?? "";
  await su.query(
    `update workers set requests_read_at = $2, pay_answers_read_at = $2 where id = $1`,
    [casual, hoursFromNow(-48)],
  );
  await su.query(
    `insert into requests (firm_id, worker_id, type, status, resolved_by, resolved_at)
     values ($1, $2, 'general', 'approved', $3, $4)`,
    [f.firmId, casual, office, hoursFromNow(-1)],
  );
  await su.query(
    `insert into pay_queries (firm_id, worker_id, work_date, issue_type, status, resolved_by,
                              resolved_at, resolution_note, created_at)
     values ($1, $2, '2026-10-30', 'late_pay', 'resolved', $3, $4, 'Paid.', $5)`,
    [f.firmId, casual, office, hoursFromNow(-1), hoursFromNow(-72)],
  );
  const ctx = {
    firm: { id: f.firmId, timezone: "Europe/London", signOff: "Test Shift Team" },
    run: withFirm,
    clock: { now: () => NOW },
  };
  return { f, casual, soon, past, booking, request, ctx };
}

const snapshot = async (firmId: string) =>
  (
    await su.query<{ row: string }>(
      `select concat_ws('|', a.id, a.still_coming_at) as row from assignments a where a.firm_id = $1
       union all
       select concat_ws('|', r.id, r.status, r.resolved_at) from requests r where r.firm_id = $1
       union all
       select concat_ws('|', w.id, w.requests_read_at, w.pay_answers_read_at)
         from workers w where w.firm_id = $1
       union all
       select concat_ws('|', m.id, m.shift_id) from messages m where m.firm_id = $1
       union all
       select concat_ws('|', e.id, e.action) from events e where e.firm_id = $1
       order by 1`,
      [firmId],
    )
  ).rows.map((r) => r.row);

describe("Phase 28.2 across firms", () => {
  it("firm A's transaction with firm B's ids changes nothing in firm B and sees none of it", async () => {
    const a = await firmWithEverything();
    const b = await firmWithEverything();
    const before = await snapshot(b.f.firmId);

    expect(await confirmStillComing(a.ctx, b.casual, b.soon)).toEqual({ status: "not_now" });
    expect(await withdrawRequest(a.ctx, b.casual, b.request)).toEqual({ status: "not_yours" });
    expect(
      await askAboutMark(a.ctx, b.casual, {
        shiftId: b.past,
        payload: { said: "worked", note: "" },
      }),
    ).toEqual({ status: "not_yours" });
    expect(await markAnswersSeen(a.ctx, b.casual)).toBe(false);
    expect(await markPayAnswersSeen(a.ctx, b.casual)).toBe(false);
    expect(await unseenAnswers(a.ctx, b.casual)).toBe(0);
    expect(await unseenPayAnswers(a.ctx, b.casual)).toBe(0);
    expect(await tabCounts(a.ctx, b.casual)).toMatchObject({
      answers: 0,
      replies: 0,
      payAnswers: 0,
    });
    expect(await myRequests(a.ctx, b.casual)).toEqual([]);

    expect(await snapshot(b.f.firmId)).toEqual(before);
    // Firm B's own casual still sees her own.
    expect(await unseenAnswers(b.ctx, b.casual)).toBe(1);
    expect(await unseenPayAnswers(b.ctx, b.casual)).toBe(1);
  });

  it("a message in firm A naming firm B's session stores no session", async () => {
    const a = await firmWithEverything();
    const b = await firmWithEverything();
    const sent = await receiveAppMessage(
      { firmId: a.f.firmId, run: withFirm, secret: SECRET, clock: { now: () => NOW } },
      a.casual,
      "About this shift",
      randomUUID(),
      b.soon,
    );
    expect(sent.status).toBe("sent");
    const { rows } = await su.query<{ shift_id: string | null }>(
      "select shift_id::text as shift_id from messages where firm_id = $1",
      [a.f.firmId],
    );
    expect(rows).toEqual([{ shift_id: null }]);
  });

  it("the composite foreign key: firm A's message can't name firm B's session (control: B's can)", async () => {
    const A = await createTenant(su);
    const B = await createTenant(su);
    const build = FK_CASES.messages_shift_fk;
    if (!build) throw new Error("no FK case for messages_shift_fk");
    expect(await inFirm(app, B.firmId, (c) => run(c, build(B.firmId, B, B)))).toBe(1);
    expect(
      await pgError(inFirm(app, A.firmId, (c) => run(c, build(A.firmId, A, B)))),
    ).toMatchObject({ code: "23503", message: expect.stringContaining("messages_shift_fk") });
  });

  it("RLS stays enabled and forced on the tables the new columns sit on", async () => {
    const { rows } = await su.query<{ name: string; on: boolean; forced: boolean }>(
      `select relname as name, relrowsecurity as on, relforcerowsecurity as forced from pg_class
        where relnamespace = 'public'::regnamespace
          and relname in ('assignments', 'workers', 'messages', 'requests', 'pay_queries')
        order by relname`,
    );
    expect(rows).toEqual(
      ["assignments", "messages", "pay_queries", "requests", "workers"].map((name) => ({
        name,
        on: true,
        forced: true,
      })),
    );
  });
});

describe("Phase 28.2 across casuals in one firm", () => {
  it("one casual can't confirm, take back, ask about, mark or count another's", async () => {
    const t = await firmWithEverything();
    const jo = await t.f.worker({ first: "Jo" });
    const before = await snapshot(t.f.firmId);

    expect(await confirmStillComing(t.ctx, jo, t.soon)).toEqual({ status: "not_now" });
    expect(await withdrawRequest(t.ctx, jo, t.request)).toEqual({ status: "not_yours" });
    expect(
      await askAboutMark(t.ctx, jo, { shiftId: t.past, payload: { said: "worked", note: "" } }),
    ).toEqual({ status: "not_yours" });
    expect(await unseenAnswers(t.ctx, jo)).toBe(0);
    expect(await unseenPayAnswers(t.ctx, jo)).toBe(0);
    expect(await myRequests(t.ctx, jo)).toEqual([]);
    // Jo marking her own answers seen leaves the other casual's marker where it was.
    await markAnswersSeen(t.ctx, jo);
    await markPayAnswersSeen(t.ctx, jo);

    expect(await snapshot(t.f.firmId)).toEqual(before);
    expect(await unseenAnswers(t.ctx, t.casual)).toBe(1);
  });
});
