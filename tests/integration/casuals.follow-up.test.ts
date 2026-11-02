import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runFirmTask } from "@/lib/jobs/firm-job";
import type { OutboundMessage } from "@/lib/messaging/transport";
import {
  CASUAL_REMINDER_QUEUE,
  createCasualReminderTask,
  type CasualReminderDeps,
} from "@/lib/credentials/remind";
import { addCasualNote, markNeedsSorted, remindCasuals } from "@/lib/office/casual-follow-up";
import { casualsList, worstNeed } from "@/lib/office/casuals";
import { loadWatchList } from "@/lib/office/dashboard-cards-data";
import { loadUpdatesPage } from "@/lib/office/updates";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Casuals, round 8 (Phase 26.7: cas-1 to cas-6, aud-12, the Watch list), on the real database as
// the app role: the counts and tabs from each casual's record, a missing photo needing updating,
// Remind (the licence message again, once a day at most, logged, at most once per request), a
// note (never with a phone number, never in the log), Mark as sorted, the dashboard's Watch list,
// and Updates' "Mark who worked" two days after a session. NOW is Monday 2 November 2026, 09:00.

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

const clock = { now: () => NOW };
const DAY = 24;

async function firm() {
  const f = await bookingFirm(su, withFirm);
  const resourcer = await f.office("resourcer");
  const ctx = { firm: { id: f.firmId }, officeUserId: resourcer, run: withFirm, clock };
  return { f, resourcer, ctx };
}

// Marked worked once a week for `weeks` weeks (from a week ago back), and `noShows` not attended.
async function history(
  f: Awaited<ReturnType<typeof bookingFirm>>,
  workerId: string,
  weeks: number,
  noShows = 0,
) {
  for (let w = 0; w < weeks; w++) {
    const s = await f.shift({ role: "steward", startsAt: hoursFromNow(-(w * 7 + 1) * DAY) });
    await f.booking(workerId, s, w < noShows ? "no_show" : "completed");
  }
}

const eventsOf = async (firmId: string, like: string) =>
  (
    await su.query<{ action: string; data: Record<string, unknown> }>(
      "select action, data from events where firm_id = $1 and action like $2 order by id",
      [firmId, like],
    )
  ).rows;

describe("the list's counts, tabs and order", () => {
  it("regulars, reliable, cancel often and not worked lately come from each casual's record", async () => {
    const { f, ctx } = await firm();
    const reg = await f.worker({ first: "Reggie" });
    const shaky = await f.worker({ first: "Shay" });
    const idle = await f.worker({ first: "Ida" });
    await history(f, reg, 8); // 8 worked, every week: regular and reliable
    await history(f, shaky, 6, 2); // 4 worked, 2 no-shows: 66%
    for (const h of [30, 40, 50]) {
      await f.booking(shaky, await f.shift({ startsAt: hoursFromNow(h) }), "cancelled_worker");
    }
    const all = await casualsList(ctx, "all");
    expect(all?.counts).toMatchObject({ all: 3, regulars: 1, reliable: 1, cancel_often: 1 });
    // Ida has never worked; so far nobody else is "not worked lately".
    expect((await casualsList(ctx, "not_worked"))?.rows.map((r) => r.id)).toEqual([idle]);
    expect((await casualsList(ctx, "regulars"))?.rows.map((r) => r.id)).toEqual([reg]);
    // Least reliable first: Shay (a figure, low), Reggie (100%), then the New ones.
    const least = await casualsList(ctx, "all", "least_reliable");
    expect(least?.rows.map((r) => r.id).slice(0, 2)).toEqual([shaky, reg]);
    expect(least?.withFigure).toBe(2);
  });

  it("a missing photo counts as needing updating (cas-5); another firm's casuals never show", async () => {
    const { f, ctx } = await firm();
    const other = await bookingFirm(su, withFirm);
    await other.worker({ first: "Tia" });
    const pat = await f.worker({ first: "Pat" });
    const needs = await casualsList(ctx, "needs");
    expect(needs?.rows.map((r) => [r.id, r.photoNeeds, r.needs.length])).toEqual([[pat, true, 0]]);
    expect((await casualsList(ctx, "all"))?.counts.all).toBe(1);
  });
});

describe("Remind", () => {
  function capture(when = NOW) {
    const sent: OutboundMessage[] = [];
    const deps = (): CasualReminderDeps => ({
      transport: {
        name: "capture",
        async send(m) {
          sent.push(m);
          return { providerMessageId: `id-${sent.length}` };
        },
      },
      baseDomain: "localhost:3000",
      clock: { now: () => when },
    });
    const run = (data: Record<string, unknown>) =>
      runFirmTask(createCasualReminderTask(deps), { id: "job", data }, withFirm);
    return { sent, run };
  }
  const jobsOf = async (firmId: string) =>
    (
      await su.query<{ data: Record<string, unknown> }>(
        `select data from pgboss.job where name = $1 and data ->> 'firmId' = $2
          order by (data ->> 'eventId')::bigint`,
        [CASUAL_REMINDER_QUEUE, firmId],
      )
    ).rows.map((r) => r.data);

  it("sends the expired-licence message again, once a day at most, and only once per request", async () => {
    const { f, ctx } = await firm();
    const kim = await f.worker({
      first: "Kim",
      credentials: [
        { type: "STEWARD_L2", expiresOn: null },
        { type: "SIA_DS", expiresOn: "2026-10-28" },
      ],
    });
    const fine = await f.worker({ first: "Fin" });
    expect(await remindCasuals(ctx, [kim, fine])).toEqual({
      status: "done",
      reminded: 1,
      recent: 0,
      nothing: 1,
      sorted: 0,
    });
    // Again the same day: not twice.
    expect(await remindCasuals(ctx, [kim])).toMatchObject({ reminded: 0, recent: 1 });
    expect(await eventsOf(f.firmId, "casual.reminded")).toEqual([
      { action: "casual.reminded", data: { workerId: kim, type: "SIA_DS" } },
    ]);
    const [job, ...more] = await jobsOf(f.firmId);
    expect(more).toEqual([]);
    expect(Object.keys(job ?? {}).sort()).toEqual(["eventId", "firmId", "idempotencyKey"]);
    const n = capture();
    expect(await n.run(job ?? {})).toMatchObject({ output: { status: "sent" } });
    expect(n.sent.map((m) => ("body" in m ? m.body : ""))).toEqual([
      expect.stringMatching(
        /^Your SIA door supervisor licence expired on 28 Oct\. .*\/profile\/upload\/SIA_DS .*Shift Team$/,
      ),
    ]);
    expect(await n.run(job ?? {})).toMatchObject({ output: { status: "already" } });
    expect(n.sent).toHaveLength(1);
    // The list says who reminded them and when.
    const row = (await casualsList(ctx, "needs"))?.rows.find((r) => r.id === kim);
    expect(row?.lastReminder).toMatchObject({ by: "Office Person" });
    expect(row?.remindAbout).toBe("SIA_DS");
  });

  it("renewed since: not sent; at night: held for the morning", async () => {
    const { f, ctx } = await firm();
    const kim = await f.worker({
      first: "Kim",
      credentials: [
        { type: "STEWARD_L2", expiresOn: null },
        { type: "SIA_DS", expiresOn: "2026-10-28" },
      ],
    });
    await remindCasuals(ctx, [kim]);
    const [job] = await jobsOf(f.firmId);
    const night = capture(new Date("2026-11-02T23:30:00Z"));
    expect(await night.run(job ?? {})).toMatchObject({ output: { status: "held" } });
    expect(night.sent).toEqual([]);
    await su.query(
      "update credentials set expires_on = '2029-01-01', status = 'valid' where worker_id = $1 and type = 'SIA_DS'",
      [kim],
    );
    const n = capture();
    expect(await n.run(job ?? {})).toMatchObject({
      output: { status: "skipped", reason: "sorted" },
    });
    expect(n.sent).toEqual([]);
  });

  it("two offices pressing Remind at once send one; one marked as sorted is left alone", async () => {
    const { f, ctx } = await firm();
    const other = await f.office("resourcer");
    const held = [
      { type: "STEWARD_L2", expiresOn: null },
      { type: "SIA_DS", expiresOn: "2026-10-28" },
    ];
    const kim = await f.worker({ first: "Kim", credentials: held });
    const both = await Promise.all([
      remindCasuals(ctx, [kim]),
      remindCasuals({ ...ctx, officeUserId: other }, [kim]),
    ]);
    expect(both.map((r) => (r.status === "done" ? r.reminded : -1)).sort()).toEqual([0, 1]);
    expect(await eventsOf(f.firmId, "casual.reminded")).toHaveLength(1);
    const lou = await f.worker({ first: "Lou", credentials: held });
    expect(await markNeedsSorted(ctx, lou, worstNeed)).toEqual({ status: "sorted" });
    expect(await remindCasuals(ctx, [lou])).toMatchObject({ reminded: 0, sorted: 1 });
  });

  it("payroll can't; nothing to remind about is said so", async () => {
    const { f } = await firm();
    const payroll = await f.office("payroll");
    const kim = await f.worker({ first: "Kim" });
    expect(
      await remindCasuals({ firm: { id: f.firmId }, officeUserId: payroll, run: withFirm, clock }, [
        kim,
      ]),
    ).toEqual({ status: "not_allowed" });
  });
});

describe("notes and Mark as sorted", () => {
  it("a note is kept (never in the log, never with a phone number); sorted moves them last and out of Remind all", async () => {
    const { f, ctx } = await firm();
    const kim = await f.worker({
      first: "Kim",
      credentials: [
        { type: "STEWARD_L2", expiresOn: null },
        { type: "SIA_DS", expiresOn: "2026-10-28" },
      ],
    });
    const lou = await f.worker({
      first: "Lou",
      credentials: [
        { type: "STEWARD_L2", expiresOn: null },
        { type: "SIA_DS", expiresOn: "2026-10-30" },
      ],
    });
    expect(await addCasualNote(ctx, kim, "Ring 07700 900123 about it")).toEqual({
      status: "invalid",
    });
    expect(await addCasualNote(ctx, kim, "Call 07700/900/123")).toEqual({ status: "invalid" });
    expect(await addCasualNote(ctx, kim, "email kim@example.com")).toEqual({ status: "invalid" });
    expect(await addCasualNote(ctx, kim, "  Has the new card,   bringing it Friday ")).toEqual({
      status: "added",
    });
    const [note] = await eventsOf(f.firmId, "casual.note_added");
    expect(note).toEqual({ action: "casual.note_added", data: { workerId: kim } });
    expect(await markNeedsSorted(ctx, kim, worstNeed)).toEqual({ status: "sorted" });
    const list = await casualsList(ctx, "needs");
    const ids = list?.rows.map((r) => r.id);
    expect(ids?.indexOf(kim)).toBeGreaterThan(ids?.indexOf(lou) ?? 99);
    const kimRow = list?.rows.find((r) => r.id === kim);
    expect(kimRow?.note).toMatchObject({ body: "Has the new card, bringing it Friday" });
    expect(kimRow?.sorted).toMatchObject({ by: "Office Person" });
    expect(list?.remindAll).toEqual([lou]);
  });
});

describe("the Watch list and Mark who worked", () => {
  it("booked casuals under 90% in the next 14 days, least reliable first", async () => {
    const { f } = await firm();
    const shaky = await f.worker({ first: "Shay" });
    const solid = await f.worker({ first: "Sol" });
    await history(f, shaky, 6, 2);
    await history(f, solid, 6);
    for (const w of [shaky, solid]) {
      await f.booking(w, await f.shift({ role: "steward", startsAt: hoursFromNow(48) }));
    }
    const list = await withFirm(f.firmId, (tx) => loadWatchList(tx, NOW, "Europe/London", null));
    expect(list.map((w) => [w.workerId, w.percent])).toEqual([[shaky, 66]]);
  });

  it("a session not marked two days after it ended is in Updates' Needs action", async () => {
    const { f, resourcer } = await firm();
    const sam = await f.worker({ first: "Sam" });
    const old = await f.shift({ role: "steward", startsAt: hoursFromNow(-3 * DAY) });
    const recent = await f.shift({ role: "steward", startsAt: hoursFromNow(-20) });
    await f.booking(sam, old);
    await f.booking(sam, recent, "confirmed", 1);
    const page = await withFirm(f.firmId, (tx) => loadUpdatesPage(tx, NOW, resourcer));
    const toMark = page.needsAction.filter((u) => u.kind === "to-mark");
    expect(toMark).toEqual([expect.objectContaining({ shiftId: old, unmarked: 1 })]);
  });
});
