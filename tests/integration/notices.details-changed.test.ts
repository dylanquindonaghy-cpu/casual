import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runImport } from "@/lib/imports/import";
import { readTable } from "@/lib/imports/table";
import { putPlannerSession } from "@/lib/integrations/sessions";
import { runFirmTask } from "@/lib/jobs/firm-job";
import type { OutboundMessage } from "@/lib/messaging/transport";
import {
  createDetailsNoticeTask,
  DETAILS_NOTICE_DELAY_SECONDS,
  DETAILS_NOTICE_QUEUE,
  type DetailsNoticeDeps,
} from "@/lib/notices/details-changed";
import { editShift, editShiftDetails } from "@/lib/office/shift-editor";
import type { PushPayload } from "@/lib/push/transport";
import { DEFAULT_SHEET_MAPPING } from "@/lib/roster/sheets/mapping";
import { syncSheet } from "@/lib/roster/sheets/sync";
import { fakeGeocoder } from "@/lib/travel/geocoder";
import { registerJobs } from "@/worker/jobs";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool, uniqueSlug } from "../helpers/db";
import {
  FakeSheets,
  londonDate,
  londonTime,
  SHIFT_HEADER,
  shiftRow,
  STAFF_HEADER,
  staffRow,
} from "../helpers/fake-sheets";
import { plannerKey } from "../helpers/planner-api";

// A booked shift's briefing changed (Phase 28.3; docs/api-and-jobs.md `details-notice`; words
// `shift_details_changed` in docs/messaging-templates.md): every writer of `shift.changed` (the
// office's editor, the planner, the rota sheet, a file import) queues one job a session, and the job
// tells each casual booked, once for a burst, naming the parts in plain words and no value. Every
// casual not told is logged with the reason. On the real database, as the app role, with capturing
// transports (nothing is sent anywhere). NOW is Monday 2 November 2026, 09:00 London (GMT); the
// session is Saturday 7 November, 08:00 to 16:00 at Riverside Arena.

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

const SATURDAY = new Date("2026-11-07T08:00:00Z");
const AFTER_DELAY = new Date(NOW.getTime() + (DETAILS_NOTICE_DELAY_SECONDS + 60) * 1000);
const NO_DETAILS = { payRate: "", post: "", meetingPoint: "", uniform: "", requirements: [] };

// A firm with Ann and Ben booked on Saturday's session at the arena (places for two).
async function detailsFirm(settings: Record<string, unknown> = {}) {
  const f = await bookingFirm(su, withFirm, { settings });
  const resourcer = await f.office("resourcer");
  const { rows } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, 'Riverside Arena') returning id::text as id",
    [f.firmId],
  );
  const shiftId = await f.shift({ startsAt: SATURDAY, headcount: 2, role: "steward" });
  await su.query("update shifts set site_id = $2, status = 'filled' where id = $1", [
    shiftId,
    rows[0]?.id,
  ]);
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  const annBooking = await f.booking(ann, shiftId, "confirmed", 1);
  const benBooking = await f.booking(ben, shiftId, "confirmed", 2);
  const ctx = {
    firm: { id: f.firmId },
    officeUserId: resourcer,
    run: withFirm,
    clock: { now: () => NOW },
  };
  return { f, resourcer, shiftId, ann, ben, annBooking, benBooking, ctx };
}

// The job's transports: everything sent, kept; a phone for whoever has one.
function capture() {
  const sent: OutboundMessage[] = [];
  const pushed: { endpoint: string; payload: PushPayload }[] = [];
  const deps = (when: Date, textSender = true): DetailsNoticeDeps => ({
    transport: {
      name: "capture",
      async send(m) {
        sent.push(m);
        return { providerMessageId: `id-${sent.length}` };
      },
    },
    push: {
      name: "capture",
      async send(target, payload) {
        pushed.push({ endpoint: target.endpoint, payload });
        return { status: "sent" };
      },
    },
    baseDomain: "localhost:3000",
    clock: { now: () => when },
    textSender,
  });
  return { sent, pushed, deps };
}

interface Job {
  id: string;
  data: Record<string, unknown>;
  delay: number;
  singleton_key: string | null;
}
const jobsOf = async (firmId: string) =>
  (
    await su.query<Job>(
      `select id::text, data, extract(epoch from start_after - created_on)::float8 as delay,
              singleton_key
         from pgboss.job where name = $1 and data ->> 'firmId' = $2 order by created_on, id`,
      [DETAILS_NOTICE_QUEUE, firmId],
    )
  ).rows;

// Runs every details-notice job of the firm, as the worker would, at `when` (all of them again, as a
// retry would, unless `ran` holds the ones already run), and gives each one's outcome.
async function runJobs(
  firmId: string,
  c: ReturnType<typeof capture>,
  when = AFTER_DELAY,
  o: { textSender?: boolean; ran?: Set<string> } = {},
) {
  const outputs: unknown[] = [];
  for (const job of await jobsOf(firmId)) {
    if (o.ran?.has(job.id)) continue;
    o.ran?.add(job.id);
    const result = await runFirmTask(
      createDetailsNoticeTask(() => c.deps(when, o.textSender ?? true)),
      { id: job.id, data: job.data },
      withFirm,
    );
    outputs.push(result.output);
  }
  return outputs;
}

const eventsOf = async (firmId: string, like: string) =>
  (
    await su.query<{ action: string; entity_id: string; data: Record<string, unknown> }>(
      `select action, entity_id::text, data from events
        where firm_id = $1 and action like $2 order by events.id`,
      [firmId, like],
    )
  ).rows;
const mobileOf = async (workerId: string) =>
  (await su.query<{ m: string }>("select mobile_e164 as m from workers where id = $1", [workerId]))
    .rows[0]?.m;
const bodies = (sent: OutboundMessage[]) => sent.map((m) => ("body" in m ? m.body : ""));

describe("the office's editor", () => {
  it("a new meeting point on a session with two booked: two notices after the delay, in plain words", async () => {
    const t = await detailsFirm();
    // Ann has notifications on her phone; Ben doesn't (a text).
    await su.query(
      `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
       values ($1, $2, 'https://fcm.googleapis.com/fcm/send/details-ann', 'k', 'a')`,
      [t.f.firmId, t.ann],
    );
    expect(
      await editShiftDetails(t.ctx, t.shiftId, {
        ...NO_DETAILS,
        meetingPoint: "Gate C, north side",
      }),
    ).toEqual({ status: "saved", fields: ["meetingPoint"], told: 2 });

    // One job for the session, ids only, two minutes on, with the session's singleton key.
    const jobs = await jobsOf(t.f.firmId);
    expect(jobs).toHaveLength(1);
    const [job] = jobs;
    const changeEventId = await changeId(t.f.firmId);
    expect(job?.data).toEqual({
      firmId: t.f.firmId,
      idempotencyKey: `details-notice:${changeEventId}`,
      shiftId: t.shiftId,
      changeEventId,
    });
    expect(job?.delay).toBeCloseTo(DETAILS_NOTICE_DELAY_SECONDS, 0);
    expect(job?.singleton_key).toBe(`${t.f.firmId}:details-notice:${t.shiftId}`);

    const c = capture();
    expect(await runJobs(t.f.firmId, c)).toEqual([
      { status: "done", sent: 2, failed: 0, skipped: 0 },
    ]);
    // Ann by push, Ben by text: exactly two notices.
    expect(c.pushed).toEqual([
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/details-ann",
        payload: {
          title: "Your shift's details changed",
          body: "Sat 7 Nov 08:00 at Riverside Arena. Tap to see what changed.",
          url: `/shifts/${t.shiftId}`,
        },
      },
    ]);
    const slug = (
      await su.query<{ slug: string }>("select slug from firms where id = $1", [t.f.firmId])
    ).rows[0]?.slug;
    expect(c.sent.map((m) => [m.channel, m.to])).toEqual([["sms", await mobileOf(t.ben)]]);
    expect(bodies(c.sent)).toEqual([
      `Booking Test ${slug}: your shift's details changed (meeting point). Sat 7 Nov 08:00 at Riverside Arena. See what changed: http://${slug}.localhost:3000/shifts/${t.shiftId} - Booking Test ${slug} Shift Team`,
    ]);
    // Never the value.
    for (const text of [...bodies(c.sent), ...c.pushed.map((p) => p.payload.body)]) {
      expect(text).not.toContain("Gate C");
    }
    // Logged: each claim names the parts (codes only), then how it went.
    expect(
      (await eventsOf(t.f.firmId, "shift.details_notice%")).map((e) => [
        e.action,
        e.entity_id,
        e.data.fields ?? e.data.channel,
      ]),
    ).toEqual([
      ["shift.details_notice", t.annBooking, ["meetingPoint"]],
      ["shift.details_notice", t.benBooking, ["meetingPoint"]],
      ["shift.details_notice_sent", expect.any(String), expect.any(String)],
      ["shift.details_notice_sent", expect.any(String), expect.any(String)],
    ]);
    const outcomes = await eventsOf(t.f.firmId, "shift.details_notice_sent");
    expect(
      Object.fromEntries(outcomes.map((e) => [e.entity_id, [e.data.workerId, e.data.channel]])),
    ).toEqual({ [t.annBooking]: [t.ann, "push"], [t.benBooking]: [t.ben, "sms"] });

    // Run again (a retry, or a second job): nothing more is sent, nothing more logged.
    expect(await runJobs(t.f.firmId, c)).toEqual([{ status: "nothing" }]);
    expect(c.sent).toHaveLength(1);
    expect(c.pushed).toHaveLength(1);
  });

  it("three quick saves still send two notices, naming every part and no value or pay figure", async () => {
    const t = await detailsFirm();
    const saves = [
      { ...NO_DETAILS, meetingPoint: "Gate C" },
      { ...NO_DETAILS, meetingPoint: "Gate C", uniform: "Black, hi-vis" },
      { ...NO_DETAILS, meetingPoint: "Gate C", uniform: "Black, hi-vis", payRate: "15.75" },
    ];
    for (const save of saves) {
      expect(await editShiftDetails(t.ctx, t.shiftId, save)).toMatchObject({
        status: "saved",
        told: 2,
      });
    }
    // pg-boss's singleton: one job for the burst (two only if a minute's slot ended between them).
    expect((await jobsOf(t.f.firmId)).length).toBeLessThanOrEqual(2);
    const c = capture();
    await runJobs(t.f.firmId, c);
    expect(c.sent).toHaveLength(2);
    for (const text of bodies(c.sent)) {
      expect(text).toContain("(meeting point, uniform and pay)");
      expect(text).not.toMatch(/£|15\.75|1575|Gate C|hi-vis/);
    }
    expect((await eventsOf(t.f.firmId, "shift.details_notice")).map((e) => e.data.fields)).toEqual([
      ["meetingPoint", "uniform", "payRatePence"],
      ["meetingPoint", "uniform", "payRatePence"],
    ]);
  });

  it("new instructions from 'Edit this session' tell them too; a later save is told on its own", async () => {
    const t = await detailsFirm();
    const edit = {
      date: "2026-11-07",
      start: "08:00",
      end: "16:00",
      role: "steward",
      siteId:
        (
          await su.query<{ id: string }>("select site_id::text as id from shifts where id = $1", [
            t.shiftId,
          ])
        ).rows[0]?.id ?? "",
      headcount: "2",
      instructions: "Bring photo ID",
    };
    expect(await editShift(t.ctx, t.shiftId, edit)).toEqual({
      status: "saved",
      fields: ["instructions"],
      told: 2,
    });
    const c = capture();
    await runJobs(t.f.firmId, c);
    expect(bodies(c.sent).map((b) => /\((.*?)\)/.exec(b)?.[1])).toEqual([
      "instructions",
      "instructions",
    ]);
    expect(bodies(c.sent).join(" ")).not.toContain("photo ID");
    // Later the uniform changes: only that is told. (Here both saves fall in one minute's
    // singleton slot, so the second joins the job already queued; later, it queues its own.
    // Either way the log says what each casual was last told.)
    await editShiftDetails(t.ctx, t.shiftId, { ...NO_DETAILS, uniform: "Black" });
    await runJobs(t.f.firmId, c);
    expect(
      bodies(c.sent)
        .slice(2)
        .map((b) => /\((.*?)\)/.exec(b)?.[1]),
    ).toEqual(["uniform", "uniform"]);
  });

  it("two jobs for one session run out of order: the later names every change, the earlier finds none left", async () => {
    // A new meeting point, then, in the next minute's slot, a new uniform: a job each. The later
    // job runs first (after quiet hours both wake together; or the earlier one's claim failed and
    // is retried after it).
    const t = await detailsFirm();
    await editShiftDetails(t.ctx, t.shiftId, { ...NO_DETAILS, meetingPoint: "Gate C" });
    // The first save's slot has ended: the next save queues a job of its own.
    await su.query(
      `update pgboss.job set singleton_on = singleton_on - interval '1 minute'
        where name = $1 and data ->> 'firmId' = $2`,
      [DETAILS_NOTICE_QUEUE, t.f.firmId],
    );
    await editShiftDetails(t.ctx, t.shiftId, {
      ...NO_DETAILS,
      meetingPoint: "Gate C",
      uniform: "Black",
    });
    expect((await eventsOf(t.f.firmId, "shift.changed")).map((e) => e.data.fields)).toEqual([
      ["meetingPoint"],
      ["uniform"],
    ]);
    const [first, second] = await jobsOf(t.f.firmId);
    expect(second).toBeDefined();
    expect(Number(second?.data.changeEventId)).toBeGreaterThan(Number(first?.data.changeEventId));

    const c = capture();
    const ran = new Set([first?.id ?? ""]);
    // The later job: both casuals told of both changes, not just the uniform.
    expect(await runJobs(t.f.firmId, c, AFTER_DELAY, { ran })).toEqual([
      { status: "done", sent: 2, failed: 0, skipped: 0 },
    ]);
    expect(bodies(c.sent).map((b) => /\((.*?)\)/.exec(b)?.[1])).toEqual([
      "meeting point and uniform",
      "meeting point and uniform",
    ]);
    // Then the earlier one: nothing left to tell, nothing more sent or logged.
    ran.delete(first?.id ?? "");
    expect(await runJobs(t.f.firmId, c, AFTER_DELAY, { ran })).toEqual([{ status: "nothing" }]);
    expect(c.sent).toHaveLength(2);
    expect(
      (await eventsOf(t.f.firmId, "shift.details_notice%")).map((e) => [e.action, e.data.fields]),
    ).toEqual([
      ["shift.details_notice", ["meetingPoint", "uniform"]],
      ["shift.details_notice", ["meetingPoint", "uniform"]],
      ["shift.details_notice_sent", undefined],
      ["shift.details_notice_sent", undefined],
    ]);
  });

  it("places only: nothing queued, nobody told, nothing logged", async () => {
    const t = await detailsFirm();
    const siteId =
      (
        await su.query<{ id: string }>("select site_id::text as id from shifts where id = $1", [
          t.shiftId,
        ])
      ).rows[0]?.id ?? "";
    expect(
      await editShift(t.ctx, t.shiftId, {
        date: "2026-11-07",
        start: "08:00",
        end: "16:00",
        role: "steward",
        siteId,
        headcount: "3",
        instructions: "",
      }),
    ).toEqual({ status: "saved", fields: ["headcount"] });
    expect(await jobsOf(t.f.firmId)).toEqual([]);
    expect(await eventsOf(t.f.firmId, "shift.details_notice%")).toEqual([]);
  });
});

// The planner's PUTs (12J.1), through its key.
async function plannerFirm(settings: Record<string, unknown> = {}) {
  const f = await bookingFirm(su, withFirm, { settings });
  const admin = await f.office("admin");
  const { id: keyId } = await plannerKey(su, f.firmId, admin);
  const ref = `S-${randomBytes(4).toString("hex")}`;
  const put = async (json: Record<string, unknown>) =>
    putPlannerSession(
      {
        run: withFirm,
        firmId: f.firmId,
        by: { type: "api", keyId },
        json,
        now: NOW,
        geocoder: fakeGeocoder,
        localDatabase: true,
      },
      ref,
    );
  const base = {
    event: { ref: "EV-1", name: "Autumn Fair" },
    site: { name: "Riverside Arena" },
    role: "steward",
    starts_at: "2026-11-07T08:00:00Z",
    ends_at: "2026-11-07T16:00:00Z",
    places: 2,
  };
  expect((await put(base)).status).toBe(201);
  const shiftId =
    (
      await su.query<{ id: string }>(
        "select id::text from shifts where firm_id = $1 and external_ref = $2",
        [f.firmId, ref],
      )
    ).rows[0]?.id ?? "";
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  const annBooking = await f.booking(ann, shiftId, "confirmed", 1);
  const benBooking = await f.booking(ben, shiftId, "confirmed", 2);
  return { f, put, base, shiftId, ann, ben, annBooking, benBooking };
}

describe("the firm's planner", () => {
  it("a new meeting point tells both", async () => {
    const p = await plannerFirm();
    expect((await p.put({ ...p.base, meeting_point: "Gate C" })).status).toBe(200);
    const c = capture();
    expect(await runJobs(p.f.firmId, c)).toEqual([
      { status: "done", sent: 2, failed: 0, skipped: 0 },
    ]);
    expect(
      bodies(c.sent).every((b) => b.includes("(meeting point)") && !b.includes("Gate C")),
    ).toBe(true);
  });

  it("an event renamed only: nothing queued, nothing logged", async () => {
    const p = await plannerFirm();
    expect((await p.put({ ...p.base, event: { ref: "EV-1", name: "Winter Fair" } })).status).toBe(
      200,
    );
    expect((await eventsOf(p.f.firmId, "shift.changed")).map((e) => e.data.fields)).toEqual([
      ["eventName"],
    ]);
    expect(await jobsOf(p.f.firmId)).toEqual([]);
    expect(await eventsOf(p.f.firmId, "shift.details_notice%")).toEqual([]);
  });

  it("a move with a new meeting point: the move's own notice tells them (skipped: move_notice)", async () => {
    const p = await plannerFirm();
    const moved = await p.put({
      ...p.base,
      starts_at: "2026-11-07T09:00:00Z",
      ends_at: "2026-11-07T17:00:00Z",
      meeting_point: "Gate C",
      change_reason: "event_changed",
    });
    expect(moved.status).toBe(200);
    expect((await eventsOf(p.f.firmId, "shift.moved")).length).toBe(2);
    const c = capture();
    expect(await runJobs(p.f.firmId, c)).toEqual([
      { status: "done", sent: 0, failed: 0, skipped: 2 },
    ]);
    expect(c.sent).toEqual([]);
    expect(
      (await eventsOf(p.f.firmId, "shift.details_notice_skipped")).map((e) => [
        e.entity_id,
        e.data.workerId,
        e.data.assignmentId,
        e.data.reason,
      ]),
    ).toEqual([
      [p.annBooking, p.ann, p.annBooking, "move_notice"],
      [p.benBooking, p.ben, p.benBooking, "move_notice"],
    ]);
  });

  it("the firm's own system tells its own bookings (skipped: firm_sends); ShiftDesk's are told", async () => {
    const p = await plannerFirm({ firm_system_sends: true });
    await su.query("update assignments set booked_via = 'api' where id = $1", [p.annBooking]);
    await su.query("update assignments set booked_via = 'office' where id = $1", [p.benBooking]);
    await p.put({ ...p.base, uniform: "Black" });
    const c = capture();
    expect(await runJobs(p.f.firmId, c)).toEqual([
      { status: "done", sent: 1, failed: 0, skipped: 1 },
    ]);
    expect(c.sent.map((m) => m.to)).toEqual([await mobileOf(p.ben)]);
    expect(
      (await eventsOf(p.f.firmId, "shift.details_notice_skipped")).map((e) => [
        e.data.workerId,
        e.data.reason,
      ]),
    ).toEqual([[p.ann, "firm_sends"]]);
  });
});

describe("the rota sheet and a file import", () => {
  it("a sheet sync that changes the instructions tells the casuals it booked", async () => {
    const slug = uniqueSlug("g");
    const { rows } = await su.query<{ id: string }>(
      "insert into firms (name, slug, sector) values ($1, $2, 'rail') returning id::text as id",
      [`Sheets Test ${slug}`, slug],
    );
    const firmId = rows[0]?.id ?? "";
    const sheetId = `test_${randomBytes(30).toString("base64url")}`.slice(0, 44);
    await su.query(
      "insert into roster_sources (firm_id, kind, spreadsheet_id, mapping) values ($1, 'sheets', $2, $3)",
      [firmId, sheetId, JSON.stringify(DEFAULT_SHEET_MAPPING)],
    );
    await su.query(
      `insert into credential_rules (firm_id, sector, role, required_types)
       values ($1, 'rail', 'steward', '{}')`,
      [firmId],
    );
    const fake = new FakeSheets();
    fake.create(sheetId, {
      Staff: [
        STAFF_HEADER,
        staffRow({
          ref: "N001",
          first: "Ann",
          last: "Sheet",
          mobile: "+447700900381",
          roles: "steward",
        }),
        staffRow({
          ref: "N002",
          first: "Ben",
          last: "Sheet",
          mobile: "+447700900382",
          roles: "steward",
        }),
      ],
      Shifts: [
        SHIFT_HEADER,
        shiftRow({
          ref: "SH-1",
          date: londonDate(SATURDAY),
          start: londonTime(SATURDAY),
          end: "16:00",
          site: "Riverside Arena",
          role: "steward",
          needed: "2",
          instructions: "Gate A",
          assigned: "N001, N002",
        }),
      ],
    });
    // Booked by the sheet's first sync, a week ago; the instructions change today.
    const weekAgo = new Date(NOW.getTime() - 7 * 24 * 3_600_000);
    const sync = (when: Date) =>
      syncSheet({ run: withFirm, firmId, client: fake, clock: { now: () => when } });
    expect((await sync(weekAgo)).status).toBe("synced");
    expect(await jobsOf(firmId)).toEqual([]);
    fake.setCell(sheetId, "Shifts", 2, "Instructions", "Gate B, bring photo ID");
    expect((await sync(NOW)).status).toBe("synced");
    expect((await eventsOf(firmId, "shift.changed")).map((e) => e.data)).toEqual([
      { source: "sheets", fields: ["instructions"] },
    ]);
    const c = capture();
    expect(await runJobs(firmId, c)).toEqual([{ status: "done", sent: 2, failed: 0, skipped: 0 }]);
    expect(c.sent.map((m) => m.to).sort()).toEqual(["+447700900381", "+447700900382"]);
    expect(bodies(c.sent).every((b) => b.includes("(instructions)") && !b.includes("Gate B"))).toBe(
      true,
    );
  });

  it("a file import that changes the instructions tells the casual booked", async () => {
    const f = await bookingFirm(su, withFirm);
    const office = await f.office("resourcer");
    const file = (notes: string) =>
      readTable(
        new TextEncoder().encode(
          `Shift ID,Date,Start,End,Role,Needed,Instructions\nE1,07/11/2026,08:00,16:00,steward,2,${notes}`,
        ),
      );
    const run = (rows: string[][]) =>
      withFirm(f.firmId, (tx) =>
        runImport(tx, {
          kind: "shifts",
          rows,
          dryRun: false,
          actorId: office,
          timeZone: "Europe/London",
          now: NOW,
        }),
      );
    await run(file("Gate A"));
    const shiftId =
      (
        await su.query<{ id: string }>(
          "select id::text from shifts where firm_id = $1 and external_ref = 'E1'",
          [f.firmId],
        )
      ).rows[0]?.id ?? "";
    const ann = await f.worker({ first: "Ann" });
    await f.booking(ann, shiftId, "confirmed", 1);
    expect(await run(file("Gate B"))).toMatchObject({ updated: 1 });
    const c = capture();
    expect(await runJobs(f.firmId, c)).toEqual([
      { status: "done", sent: 1, failed: 0, skipped: 0 },
    ]);
    expect(c.sent.map((m) => m.to)).toEqual([await mobileOf(ann)]);
    expect(bodies(c.sent)[0]).toContain("(instructions)");
  });
});

describe("not told, and logged why", () => {
  it("the session started before the job ran (skipped: started)", async () => {
    const t = await detailsFirm();
    await editShiftDetails(t.ctx, t.shiftId, { ...NO_DETAILS, post: "Gate 4" });
    const c = capture();
    expect(await runJobs(t.f.firmId, c, new Date("2026-11-07T08:30:00Z"))).toEqual([
      { status: "done", sent: 0, failed: 0, skipped: 2 },
    ]);
    expect(c.sent).toEqual([]);
    expect(
      (await eventsOf(t.f.firmId, "shift.details_notice_skipped")).map((e) => e.data.reason),
    ).toEqual(["started", "started"]);
  });

  it("nothing can reach them (skipped: no_way): no phone, texts off, no email", async () => {
    const t = await detailsFirm();
    await su.query("update workers set sms_opted_out_at = now(), email = null where id = $1", [
      t.ben,
    ]);
    // The office is told the truth before the job runs: only Ann can be reached.
    expect(
      await editShiftDetails(t.ctx, t.shiftId, { ...NO_DETAILS, uniform: "Black" }),
    ).toMatchObject({ told: 1 });
    const c = capture();
    expect(await runJobs(t.f.firmId, c)).toEqual([
      { status: "done", sent: 1, failed: 0, skipped: 1 },
    ]);
    expect(c.sent.map((m) => m.to)).toEqual([await mobileOf(t.ann)]);
    expect(
      (await eventsOf(t.f.firmId, "shift.details_notice_skipped")).map((e) => [
        e.data.workerId,
        e.data.assignmentId,
        e.data.reason,
      ]),
    ).toEqual([[t.ben, t.benBooking, "no_way"]]);
  });

  it("no text sender and no email: nobody can be reached, and the office's count says so", async () => {
    const t = await detailsFirm();
    await editShiftDetails(t.ctx, t.shiftId, { ...NO_DETAILS, uniform: "Black" });
    const c = capture();
    expect(await runJobs(t.f.firmId, c, AFTER_DELAY, { textSender: false })).toEqual([
      { status: "done", sent: 0, failed: 0, skipped: 2 },
    ]);
    expect(
      (await eventsOf(t.f.firmId, "shift.details_notice_skipped")).map((e) => e.data.reason),
    ).toEqual(["no_way", "no_way"]);
  });

  it("a booking made after the change hears nothing; a cancelled one isn't booked", async () => {
    const t = await detailsFirm();
    await su.query(
      `update assignments set status = 'cancelled_worker', cancelled_at = now(),
              cancel_reason = 'Unwell', notice_hours = 20 where id = $1`,
      [t.benBooking],
    );
    await editShiftDetails(t.ctx, t.shiftId, { ...NO_DETAILS, uniform: "Black" });
    // Ann booked again after the change (as if she took it a moment later).
    await su.query(
      "update assignments set confirmed_at = now() + interval '1 minute' where id = $1",
      [t.annBooking],
    );
    const c = capture();
    expect(await runJobs(t.f.firmId, c)).toEqual([{ status: "nothing" }]);
    expect(await eventsOf(t.f.firmId, "shift.details_notice%")).toEqual([]);
  });
});

describe("quiet hours", () => {
  it("hold the notice until they end, logged, then it goes", async () => {
    const t = await detailsFirm();
    await editShiftDetails(t.ctx, t.shiftId, { ...NO_DETAILS, meetingPoint: "Gate C" });
    const c = capture();
    // 23:00 on Monday, with the session on Saturday: not urgent, so it waits for 07:00.
    const night = new Date("2026-11-02T23:00:00Z");
    const ran = new Set<string>();
    expect(await runJobs(t.f.firmId, c, night, { ran })).toEqual([
      { status: "held", until: new Date("2026-11-03T07:00:00Z"), skipped: 0 },
    ]);
    expect(c.sent).toEqual([]);
    expect(
      (await eventsOf(t.f.firmId, "shift.details_notice_held")).map((e) => [
        e.data.workerId,
        e.data.until,
        e.data.afterStart,
      ]),
    ).toEqual([
      [t.ann, "2026-11-03T07:00:00.000Z", false],
      [t.ben, "2026-11-03T07:00:00.000Z", false],
    ]);
    const again = (await jobsOf(t.f.firmId)).filter((j) => !ran.has(j.id));
    expect(again.map((j) => String(j.data.idempotencyKey).endsWith(":after-quiet"))).toEqual([
      true,
    ]);
    // At 07:00 it goes.
    expect(await runJobs(t.f.firmId, c, new Date("2026-11-03T07:00:00Z"), { ran })).toEqual([
      { status: "done", sent: 2, failed: 0, skipped: 0 },
    ]);
    expect(c.sent).toHaveLength(2);
  });

  it("a session starting within the urgent window goes at night when the firm lets urgent through", async () => {
    const t = await detailsFirm({
      quiet_hours: { start: "22:00", end: "07:00", urgent_override: true },
    });
    await su.query("update shifts set starts_at = $2, ends_at = $3 where id = $1", [
      t.shiftId,
      new Date("2026-11-03T06:00:00Z"),
      new Date("2026-11-03T14:00:00Z"),
    ]);
    await editShiftDetails(t.ctx, t.shiftId, { ...NO_DETAILS, meetingPoint: "Gate C" });
    const c = capture();
    expect(await runJobs(t.f.firmId, c, new Date("2026-11-02T23:00:00Z"))).toEqual([
      { status: "done", sent: 2, failed: 0, skipped: 0 },
    ]);
  });
});

describe("the worker runs it", () => {
  it("registers the details-notice queue", async () => {
    const worked: string[] = [];
    const boss = {
      createQueue: async () => undefined,
      updateQueue: async () => undefined,
      work: async (name: string) => {
        worked.push(name);
        return "id";
      },
      schedule: async () => undefined,
      unschedule: async () => undefined,
    } as unknown as PgBoss;
    await registerJobs(boss);
    expect(worked).toContain(DETAILS_NOTICE_QUEUE);
  });
});

// The newest shift.changed entry's id (the one that queued the job).
async function changeId(firmId: string): Promise<number> {
  const { rows } = await su.query<{ id: string }>(
    "select max(id)::text as id from events where firm_id = $1 and action = 'shift.changed'",
    [firmId],
  );
  return Number(rows[0]?.id);
}
