import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DAY } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { eraseWorker } from "@/lib/gdpr/worker-erase";
import { collectWorkerData } from "@/lib/gdpr/worker-export";
import { resolveRequest } from "@/lib/requests/resolve";
import {
  markAnswersSeen,
  markPayAnswersSeen,
  unseenAnswers,
  unseenPayAnswers,
} from "@/lib/portal/request-answers";
import {
  askAboutMark,
  canWithdrawRequest,
  myRequests,
  withdrawRequest,
} from "@/lib/portal/requests";
import { confirmStillComing } from "@/lib/portal/still-coming";
import { tabCounts } from "@/lib/portal/tab-counts";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { race } from "../helpers/race";
import { appRolePool, superuserPool } from "../helpers/db";
import { inFirm, pgError } from "../helpers/rls-probe";

// Phase 28.2's requests and answers on the real database as the app role
// (src/lib/portal/requests.ts, request-answers.ts, tab-counts.ts): taking back a waiting request,
// asking about a mark, the answers she hasn't seen, the four tab counts, and what export and
// erasure do with the new columns and values.

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

const SIGN_OFF = "Booking Test Shift Team";

async function setup() {
  const f = await bookingFirm(su, withFirm);
  const sam = await f.worker();
  const jo = await f.worker({ first: "Jo" });
  const resourcer = await f.office("resourcer");
  const ctx = (now = NOW) => ({
    firm: { id: f.firmId, timezone: "Europe/London", signOff: SIGN_OFF },
    run: withFirm,
    clock: { now: () => now },
  });
  const one = async (text: string, values: unknown[]) => {
    const { rows } = await su.query<{ id: string }>(`${text} returning id::text as id`, values);
    const id = rows[0]?.id;
    if (!id) throw new Error(`insert returned no id: ${text}`);
    return id;
  };
  const request = (
    workerId: string,
    o: {
      type?: string;
      status?: string;
      shiftId?: string | null;
      createdAt?: Date;
      resolvedAt?: Date | null;
      payload?: Record<string, unknown>;
    } = {},
  ) => {
    const status = o.status ?? "open";
    const answered = status === "approved" || status === "declined";
    return one(
      `insert into requests (firm_id, worker_id, shift_id, type, status, payload, created_at,
                             resolved_at, resolved_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        f.firmId,
        workerId,
        o.shiftId ?? null,
        o.type ?? "general",
        status,
        JSON.stringify(o.payload ?? {}),
        o.createdAt ?? hoursFromNow(-48),
        o.resolvedAt ?? (status === "open" || status === "escalated" ? null : hoursFromNow(-1)),
        answered ? resourcer : null,
      ],
    );
  };
  const payQuery = (workerId: string, o: { resolvedAt?: Date | null; createdAt?: Date } = {}) =>
    one(
      `insert into pay_queries (firm_id, worker_id, work_date, issue_type, status, resolved_by,
                                resolved_at, resolution_note, created_at)
       values ($1, $2, '2026-10-30', 'late_pay', $3, $4, $5, $6, $7)`,
      [
        f.firmId,
        workerId,
        o.resolvedAt ? "resolved" : "open",
        o.resolvedAt ? resourcer : null,
        o.resolvedAt ?? null,
        o.resolvedAt ? "Paid on Friday." : null,
        o.createdAt ?? hoursFromNow(-72),
      ],
    );
  const readMarkers = async (workerId: string, requestsAt: Date | null, payAt: Date | null) =>
    su.query("update workers set requests_read_at = $2, pay_answers_read_at = $3 where id = $1", [
      workerId,
      requestsAt,
      payAt,
    ]);
  const requestRow = async (id: string) =>
    (
      await su.query<{
        status: string;
        resolved_at: Date | null;
        resolved_by: string | null;
        payload: Record<string, unknown>;
      }>("select status, resolved_at, resolved_by, payload from requests where id = $1", [id])
    ).rows[0];
  const eventsOf = async (action: string) =>
    (
      await su.query<{
        actor_type: string;
        actor_id: string | null;
        entity_type: string;
        entity_id: string;
        data: Record<string, unknown>;
      }>(
        `select actor_type, actor_id::text as actor_id, entity_type, entity_id::text as entity_id,
                data
           from events where firm_id = $1 and action = $2 order by id`,
        [f.firmId, action],
      )
    ).rows;
  return {
    f,
    sam,
    jo,
    resourcer,

    ctx,
    request,
    payQuery,
    readMarkers,
    requestRow,
    eventsOf,
  };
}

const refOf = (id: string) => id.slice(0, 8).toUpperCase();

describe("withdrawRequest", () => {
  it("takes back an open or an escalated request: resolved_at set, resolved_by null, logged", async () => {
    const t = await setup();
    const shift = await t.f.shift({ startsAt: hoursFromNow(48) });
    await t.f.booking(t.sam, shift);
    const open = await t.request(t.sam, { type: "time_change", shiftId: shift });
    const escalated = await t.request(t.sam, { status: "escalated" });

    expect(await withdrawRequest(t.ctx(), t.sam, open)).toEqual({
      status: "withdrawn",
      ref: refOf(open),
    });
    expect(await withdrawRequest(t.ctx(), t.sam, escalated)).toEqual({
      status: "withdrawn",
      ref: refOf(escalated),
    });
    for (const id of [open, escalated]) {
      expect(await t.requestRow(id)).toMatchObject({
        status: "withdrawn",
        resolved_at: NOW,
        resolved_by: null,
      });
    }
    expect(await t.eventsOf("request.withdrawn")).toEqual([
      {
        actor_type: "worker",
        actor_id: t.sam,
        entity_type: "request",
        entity_id: open,
        data: { type: "time_change", workerId: t.sam, shiftId: shift },
      },
      {
        actor_type: "worker",
        actor_id: t.sam,
        entity_type: "request",
        entity_id: escalated,
        data: { type: "general", workerId: t.sam },
      },
    ]);
    // A second tap: already taken back, nothing more logged.
    expect(await withdrawRequest(t.ctx(), t.sam, open)).toEqual({
      status: "already",
      ref: refOf(open),
    });
    expect(await t.eventsOf("request.withdrawn")).toHaveLength(2);
    // My requests shows it, with its id and words-ready status.
    const mine = await myRequests(t.ctx(), t.sam);
    expect(mine.find((r) => r.id === open)).toMatchObject({
      status: "withdrawn",
      shiftId: shift,
      mark: null,
    });
  });

  it("one the office answered first: 'answered first', nothing changes", async () => {
    const t = await setup();
    const approved = await t.request(t.sam, { status: "approved" });
    const sorted = await t.request(t.sam, { status: "auto_resolved" });
    expect(await withdrawRequest(t.ctx(), t.sam, approved)).toEqual({
      status: "answered_first",
      ref: refOf(approved),
    });
    expect(await withdrawRequest(t.ctx(), t.sam, sorted)).toEqual({
      status: "answered_first",
      ref: refOf(sorted),
    });
    expect((await t.requestRow(approved))?.status).toBe("approved");
    expect((await t.requestRow(sorted))?.status).toBe("auto_resolved");
    expect(await t.eventsOf("request.withdrawn")).toEqual([]);
  });

  it("someone else's request, or not an id: not hers, nothing changes", async () => {
    const t = await setup();
    const jos = await t.request(t.jo);
    expect(await withdrawRequest(t.ctx(), t.sam, jos)).toEqual({ status: "not_yours" });
    expect(await withdrawRequest(t.ctx(), t.sam, "nope")).toEqual({ status: "not_yours" });
    expect((await t.requestRow(jos))?.status).toBe("open");
  });

  it("racing the office's answer: exactly one outcome, never both", async () => {
    for (let round = 0; round < 3; round += 1) {
      const t = await setup();
      const id = await t.request(t.sam, { type: "general" });
      const [taken, answered] = await Promise.all([
        withdrawRequest(t.ctx(), t.sam, id),
        resolveRequest(
          withFirm,
          t.f.firmId,
          {
            requestId: id,
            decision: "approved",
            note: "",
            by: { type: "office", id: t.resourcer },
          },
          { clock: { now: () => NOW } },
        ),
      ]);
      const row = await t.requestRow(id);
      if (taken.status === "withdrawn") {
        expect(row?.status).toBe("withdrawn");
        expect(answered).toMatchObject({ status: "already", current: "withdrawn" });
      } else {
        expect(taken).toEqual({ status: "answered_first", ref: refOf(id) });
        expect(row?.status).toBe("approved");
        expect(answered).toMatchObject({ status: "resolved" });
      }
      const withdrawn = (await t.eventsOf("request.withdrawn")).length;
      const approvedEvents = (await t.eventsOf("request.approved")).length;
      expect(withdrawn + approvedEvents).toBe(1);
    }
  });

  // One she can take back (canWithdrawRequest): an attendance question, racing the office's
  // decline. The office's reply to her (the request-update job) goes only if the office won.
  it("racing the office's reply on one she can take back: one outcome, a reply only if the office won", async () => {
    for (let round = 0; round < 3; round += 1) {
      const t = await setup();
      const shift = await t.f.shift({ startsAt: hoursFromNow(-30) });
      const booking = await t.f.booking(t.sam, shift, "no_show");
      const id = await t.request(t.sam, {
        type: "attendance",
        shiftId: shift,
        payload: { said: "worked", note: "" },
      });
      const [mine] = await myRequests(t.ctx(), t.sam);
      expect(mine && canWithdrawRequest(mine)).toBe(true);
      const [taken, answered] = await Promise.all([
        withdrawRequest(t.ctx(), t.sam, id),
        resolveRequest(
          withFirm,
          t.f.firmId,
          {
            requestId: id,
            decision: "declined",
            note: "The gate log shows no sign-in.",
            by: { type: "office", id: t.resourcer },
          },
          { clock: { now: () => NOW } },
        ),
      ]);
      const row = await t.requestRow(id);
      const { rows: replies } = await su.query<{ n: number }>(
        "select count(*)::int as n from pgboss.job where name = 'request-update' and data ->> 'idempotencyKey' = $1",
        [`request-update:${id}`],
      );
      if (taken.status === "withdrawn") {
        expect(row?.status).toBe("withdrawn");
        expect(answered).toEqual({ status: "already", current: "withdrawn" });
        expect(replies[0]?.n).toBe(0);
      } else {
        expect(taken).toEqual({ status: "answered_first", ref: refOf(id) });
        expect(row?.status).toBe("declined");
        expect(answered).toEqual({ status: "resolved", decision: "declined" });
        expect(replies[0]?.n).toBe(1);
      }
      const withdrawn = (await t.eventsOf("request.withdrawn")).length;
      const declined = (await t.eventsOf("request.declined")).length;
      expect(withdrawn + declined).toBe(1);
      // Neither changes her mark.
      const { rows: mark } = await su.query<{ status: string }>(
        "select status from assignments where id = $1",
        [booking],
      );
      expect(mark[0]?.status).toBe("no_show");
    }
  });

  it("canWithdrawRequest: only one still waiting, and never a question she sent as a message", () => {
    const message = "00000000-0000-4000-8000-000000000001";
    expect(canWithdrawRequest({ type: "time_change", status: "open" })).toBe(true);
    expect(canWithdrawRequest({ type: "attendance", status: "escalated", messageId: null })).toBe(
      true,
    );
    expect(canWithdrawRequest({ type: "general", status: "open", messageId: null })).toBe(true);
    expect(canWithdrawRequest({ type: "general", status: "open", messageId: message })).toBe(false);
    expect(canWithdrawRequest({ type: "general", status: "escalated", messageId: message })).toBe(
      false,
    );
    for (const status of ["approved", "declined", "auto_resolved", "withdrawn"]) {
      expect(canWithdrawRequest({ type: "time_change", status })).toBe(false);
    }
  });
});

describe("askAboutMark", () => {
  it("an attendance question on her own marked session: stored, logged with ids and codes only", async () => {
    const t = await setup();
    const shift = await t.f.shift({ startsAt: hoursFromNow(-30) });
    const booking = await t.f.booking(t.sam, shift, "no_show");
    const result = await askAboutMark(t.ctx(), t.sam, {
      shiftId: shift,
      payload: { said: "worked", note: "I signed in at the gate." },
    });
    expect(result).toMatchObject({
      status: "created",
      sentAt: "09:00 on Mon 2 Nov",
      signOff: SIGN_OFF,
    });
    const ref = result.status === "created" ? result.ref : "";
    const { rows } = await su.query<{
      id: string;
      type: string;
      status: string;
      shift_id: string;
      payload: Record<string, unknown>;
    }>(
      `select id::text as id, type, status, shift_id::text as shift_id, payload
         from requests where firm_id = $1`,
      [t.f.firmId],
    );
    expect(rows).toEqual([
      {
        id: expect.any(String),
        type: "attendance",
        status: "open",
        shift_id: shift,
        payload: { said: "worked", note: "I signed in at the gate." },
      },
    ]);
    expect(refOf(rows[0]?.id ?? "")).toBe(ref);
    expect(await t.eventsOf("request.created")).toEqual([
      {
        actor_type: "worker",
        actor_id: t.sam,
        entity_type: "request",
        entity_id: rows[0]?.id,
        data: { type: "attendance", shiftId: shift, assignmentId: booking, said: "worked" },
      },
    ]);
    // The mark is never changed by a request (golden rule 12).
    const { rows: mark } = await su.query<{ status: string }>(
      "select status from assignments where id = $1",
      [booking],
    );
    expect(mark[0]?.status).toBe("no_show");
    // My requests names the session's mark as it is now.
    const [mine] = await myRequests(t.ctx(), t.sam);
    expect(mine).toMatchObject({ type: "attendance", status: "open", mark: "no_show" });
    // A second one while it waits: the waiting one's reference.
    expect(
      await askAboutMark(t.ctx(), t.sam, { shiftId: shift, payload: { said: "worked", note: "" } }),
    ).toEqual({ status: "already_open", ref });
  });

  it("is refused for another worker's booking, an unmarked one, or a session that started 91 days ago (89 is fine, by starts_at)", async () => {
    const t = await setup();
    const ask = (shiftId: string, said: "worked" | "not_worked" = "worked") =>
      askAboutMark(t.ctx(), t.sam, { shiftId, payload: { said, note: "" } });
    const jos = await t.f.shift({ startsAt: hoursFromNow(-30) });
    await t.f.booking(t.jo, jos, "no_show");
    const unmarked = await t.f.shift({ startsAt: hoursFromNow(-30) });
    await t.f.booking(t.sam, unmarked, "confirmed");
    const old = await t.f.shift({ startsAt: new Date(NOW.getTime() - 91 * DAY) });
    await t.f.booking(t.sam, old, "no_show");
    const recent = await t.f.shift({ startsAt: new Date(NOW.getTime() - 89 * DAY) });
    await t.f.booking(t.sam, recent, "no_show");
    const worked = await t.f.shift({ startsAt: hoursFromNow(-50) });
    await t.f.booking(t.sam, worked, "completed");

    expect(await ask(jos)).toEqual({ status: "not_yours" });
    expect(await ask(unmarked)).toEqual({ status: "not_yours" });
    expect(await ask(old)).toEqual({ status: "not_yours" });
    expect(await ask(recent)).toMatchObject({ status: "created" });
    // Saying what the mark already says isn't a question about it.
    expect(await ask(worked, "worked")).toEqual({ status: "matches_mark" });
    expect(await ask(worked, "not_worked")).toMatchObject({ status: "created" });
    expect(await ask("not-an-id")).toEqual({ status: "not_yours" });
    const { rows } = await su.query<{ n: number }>(
      "select count(*)::int as n from requests where firm_id = $1",
      [t.f.firmId],
    );
    expect(rows[0]?.n).toBe(2);
  });

  it("refuses a note holding a phone number or an email address, or over 500 characters", async () => {
    const t = await setup();
    const shift = await t.f.shift({ startsAt: hoursFromNow(-30) });
    await t.f.booking(t.sam, shift, "no_show");
    for (const note of ["Call me on 07700 900123", "mail sam@example.com", "x".repeat(501)]) {
      expect(
        await askAboutMark(t.ctx(), t.sam, { shiftId: shift, payload: { said: "worked", note } }),
      ).toEqual({ status: "invalid" });
    }
    expect(
      await askAboutMark(t.ctx(), t.sam, {
        shiftId: shift,
        payload: { said: "worked", note: "x".repeat(500) },
      }),
    ).toMatchObject({ status: "created" });
  });

  it("two submissions at once create one request", async () => {
    const t = await setup();
    const shift = await t.f.shift({ startsAt: hoursFromNow(-30) });
    await t.f.booking(t.sam, shift, "no_show");
    const results = await race(3, t.f.firmId, (tx) =>
      askAboutMark({ ...t.ctx(), run: (_f, fn) => fn(tx) }, t.sam, {
        shiftId: shift,
        payload: { said: "worked", note: "" },
      }),
    );
    const statuses = results.map((r) => (r.status === "fulfilled" ? r.value.status : "failed"));
    expect(statuses.filter((s) => s === "created")).toHaveLength(1);
    expect(statuses.filter((s) => s === "already_open")).toHaveLength(2);
    const { rows } = await su.query<{ n: number }>(
      "select count(*)::int as n from requests where firm_id = $1 and type = 'attendance'",
      [t.f.firmId],
    );
    expect(rows[0]?.n).toBe(1);
    expect(await t.eventsOf("request.created")).toHaveLength(1);
  });
});

describe("answers she hasn't seen, and the tab counts", () => {
  it("count only answers after their read markers; marking clears them; never another casual's", async () => {
    const t = await setup();
    const marker = hoursFromNow(-10);
    await t.readMarkers(t.sam, marker, marker);
    await t.readMarkers(t.jo, null, null);
    // Before the marker: seen. After: new. Still waiting: not an answer. Jo's: not hers.
    await t.request(t.sam, { status: "approved", resolvedAt: hoursFromNow(-20) });
    await t.request(t.sam, { status: "approved", resolvedAt: hoursFromNow(-5) });
    await t.request(t.sam, { status: "declined", resolvedAt: hoursFromNow(-2) });
    await t.request(t.sam, { status: "open" });
    await t.request(t.sam, { status: "withdrawn", resolvedAt: hoursFromNow(-1) });
    await t.request(t.sam, { status: "auto_resolved", resolvedAt: hoursFromNow(-1) });
    // Answered after the marker, but asked more than 90 days ago: not on My requests, not counted.
    await t.request(t.sam, {
      status: "approved",
      resolvedAt: hoursFromNow(-3),
      createdAt: new Date(NOW.getTime() - 91 * DAY),
    });
    await t.request(t.jo, { status: "approved", resolvedAt: hoursFromNow(-3) });
    await t.payQuery(t.sam, { resolvedAt: hoursFromNow(-20) });
    await t.payQuery(t.sam, { resolvedAt: hoursFromNow(-4) });
    await t.payQuery(t.sam, {});
    await t.payQuery(t.jo, { resolvedAt: hoursFromNow(-4) });

    expect(await unseenAnswers(t.ctx(), t.sam)).toBe(2);
    expect(await unseenPayAnswers(t.ctx(), t.sam)).toBe(1);
    expect(await unseenAnswers(t.ctx(), t.jo)).toBe(1);
    expect(await unseenPayAnswers(t.ctx(), t.jo)).toBe(1);

    expect(await tabCounts(t.ctx(), t.sam)).toEqual({
      needs: 0,
      answers: 2,
      replies: 0,
      payAnswers: 1,
    });

    expect(await markAnswersSeen(t.ctx(), t.sam)).toBe(true);
    expect(await unseenAnswers(t.ctx(), t.sam)).toBe(0);
    expect(await markAnswersSeen(t.ctx(), t.sam)).toBe(false); // nothing newer: never moved back
    expect(await unseenPayAnswers(t.ctx(), t.sam)).toBe(1); // separate markers
    expect(await markPayAnswersSeen(t.ctx(), t.sam)).toBe(true);
    expect(await unseenPayAnswers(t.ctx(), t.sam)).toBe(0);
    // Jo's are untouched by Sam's marking.
    expect(await unseenAnswers(t.ctx(), t.jo)).toBe(1);
    expect(await unseenPayAnswers(t.ctx(), t.jo)).toBe(1);

    // An answer after the marking counts again.
    await t.request(t.sam, { status: "approved", resolvedAt: hoursFromNow(-0.5) });
    expect(await unseenAnswers(t.ctx(), t.sam)).toBe(1);
  });

  it("marking up to a time leaves a later answer counted", async () => {
    const t = await setup();
    await t.readMarkers(t.sam, hoursFromNow(-30), hoursFromNow(-30));
    await t.request(t.sam, { status: "approved", resolvedAt: hoursFromNow(-6) });
    await t.request(t.sam, { status: "declined", resolvedAt: hoursFromNow(-1) });
    expect(await markAnswersSeen(t.ctx(), t.sam, hoursFromNow(-3))).toBe(true);
    expect(await unseenAnswers(t.ctx(), t.sam)).toBe(1);
  });

  it("a new casual starts with nothing new (the markers default to when her row was made)", async () => {
    const t = await setup();
    const { rows } = await su.query<{ requests: Date | null; pay: Date | null }>(
      "select requests_read_at as requests, pay_answers_read_at as pay from workers where id = $1",
      [t.sam],
    );
    expect(rows[0]?.requests).toBeInstanceOf(Date);
    expect(rows[0]?.pay).toBeInstanceOf(Date);
  });

  it("tabCounts: the Profile needs, unseen answers, the office's replies and payroll's answers", async () => {
    const t = await setup();
    await t.readMarkers(t.sam, hoursFromNow(-10), hoursFromNow(-10));
    // A qualification she needs is missing (no credentials), so Profile needs her.
    const kit = await t.f.worker({ first: "Kit", roles: ["steward"], credentials: [] });
    await t.readMarkers(kit, hoursFromNow(-10), hoursFromNow(-10));
    await su.query(
      `insert into messages (firm_id, direction, channel, provider_message_id, worker_id, body)
       values ($1, 'out', 'app', 'app-out:p28-1', $2, 'Yes, see you then.')`,
      [t.f.firmId, kit],
    );
    await t.request(kit, { status: "declined", resolvedAt: hoursFromNow(-1) });
    await t.payQuery(kit, { resolvedAt: hoursFromNow(-1) });
    const counts = await tabCounts(t.ctx(), kit);
    expect(counts.needs).toBeGreaterThan(0);
    expect(counts).toMatchObject({ answers: 1, replies: 1, payAnswers: 1 });
  });
});

describe("the database's checks on the new values", () => {
  it("withdrawn needs resolved_at and no office user; attendance needs a session", async () => {
    const t = await setup();
    const shift = await t.f.shift({ startsAt: hoursFromNow(-30) });
    const insert = (o: {
      type: string;
      status: string;
      shiftId: string | null;
      resolvedAt: Date | null;
      resolvedBy: string | null;
    }) =>
      inFirm(app, t.f.firmId, (c) =>
        c.query(
          `insert into requests (firm_id, worker_id, shift_id, type, status, resolved_at, resolved_by)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [t.f.firmId, t.sam, o.shiftId, o.type, o.status, o.resolvedAt, o.resolvedBy],
        ),
      );
    const base = { type: "general", shiftId: null, resolvedBy: null };
    expect(await pgError(insert({ ...base, status: "withdrawn", resolvedAt: null }))).toMatchObject(
      { code: "23514", message: expect.stringContaining("requests_resolution") },
    );
    expect(
      await pgError(
        insert({ ...base, status: "withdrawn", resolvedAt: NOW, resolvedBy: t.resourcer }),
      ),
    ).toMatchObject({ code: "23514", message: expect.stringContaining("requests_resolution") });
    await expect(insert({ ...base, status: "withdrawn", resolvedAt: NOW })).resolves.toMatchObject({
      rowCount: 1,
    });
    expect(
      await pgError(insert({ ...base, type: "attendance", status: "open", resolvedAt: null })),
    ).toMatchObject({ code: "23514", message: expect.stringContaining("requests_shift_required") });
    await expect(
      insert({ ...base, type: "attendance", status: "open", shiftId: shift, resolvedAt: null }),
    ).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe("export and erasure of Phase 28.2's columns and values", () => {
  it("the export holds still_coming_at, the read markers and attendance and withdrawn requests; erasure clears them", async () => {
    const t = await setup();
    const admin = await t.f.office("admin");
    const soon = await t.f.shift({ startsAt: hoursFromNow(5) });
    const past = await t.f.shift({ startsAt: hoursFromNow(-30) });
    const booking = await t.f.booking(t.sam, soon);
    await t.f.booking(t.sam, past, "no_show");
    await confirmStillComing(t.ctx(), t.sam, soon);
    const asked = await askAboutMark(t.ctx(), t.sam, {
      shiftId: past,
      payload: { said: "worked", note: "I was on gate 3." },
    });
    expect(asked.status).toBe("created");
    const waiting = await t.request(t.sam, { type: "general", payload: { note: "Parking?" } });
    await withdrawRequest(t.ctx(), t.sam, waiting);

    const data = await withFirm(t.f.firmId, (tx) => collectWorkerData(tx, t.sam, NOW));
    expect(data?.worker).toMatchObject({
      requestsReadAt: expect.any(Date),
      payAnswersReadAt: expect.any(Date),
    });
    expect(data?.sections.bookings).toContainEqual(
      expect.objectContaining({ id: booking, stillComingAt: NOW }),
    );
    expect(data?.sections.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "attendance",
          status: "open",
          payload: { said: "worked", note: "I was on gate 3." },
        }),
        expect.objectContaining({ id: waiting, status: "withdrawn", resolvedBy: null }),
      ]),
    );

    // Erasure is refused while she's booked on a session that hasn't ended: end it first (the
    // office would cancel it with a reason; here the session is simply over).
    await su.query("update shifts set starts_at = $2, ends_at = $3 where id = $1", [
      soon,
      hoursFromNow(-10),
      hoursFromNow(-2),
    ]);
    expect(
      await eraseWorker(
        { firm: { id: t.f.firmId }, officeUserId: admin, run: withFirm, clock: { now: () => NOW } },
        t.sam,
      ),
    ).toMatchObject({ status: "erased" });
    const { rows: bookings } = await su.query<{ at: Date | null }>(
      "select still_coming_at as at from assignments where worker_id = $1",
      [t.sam],
    );
    expect(bookings.map((b) => b.at)).toEqual([null, null]);
    const { rows: worker } = await su.query<{ requests: Date | null; pay: Date | null }>(
      "select requests_read_at as requests, pay_answers_read_at as pay from workers where id = $1",
      [t.sam],
    );
    expect(worker[0]).toEqual({ requests: null, pay: null });
    // Their typed words go; the attendance question keeps only what she said (a code).
    const { rows: requests } = await su.query<{ type: string; payload: Record<string, unknown> }>(
      "select type, payload from requests where worker_id = $1 order by type",
      [t.sam],
    );
    expect(requests).toEqual([
      { type: "attendance", payload: { said: "worked" } },
      { type: "general", payload: {} },
    ]);
  });

  // A message in the app about a session she can see but isn't booked on (messages.shift_id): the
  // export says when and where that session is, never a bare id (the guardrails review of 28.2).
  it("a message about a session she isn't booked on: the export's shifts name it", async () => {
    const t = await setup();
    const open = await t.f.shift({ startsAt: hoursFromNow(30) });
    await su.query(
      `insert into messages (firm_id, direction, channel, provider_message_id, worker_id, body,
                             shift_id, created_at)
       values ($1, 'in', 'app', $2, $3, 'Is there parking?', $4, $5)`,
      [t.f.firmId, `app:${randomUUID()}`, t.sam, open, hoursFromNow(-1)],
    );
    const data = await withFirm(t.f.firmId, (tx) => collectWorkerData(tx, t.sam, NOW));
    expect(data?.sections.messages).toEqual([expect.objectContaining({ shiftId: open })]);
    expect(data?.sections.bookings).toEqual([]);
    expect(data?.sections.shifts).toEqual([
      expect.objectContaining({
        id: open,
        startsAt: hoursFromNow(30),
        endsAt: expect.any(Date),
        role: expect.any(String),
      }),
    ]);
  });
});
