import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { markFilled } from "@/lib/office/quick-actions";
import { createShifts, editShift } from "@/lib/office/shift-editor";
import { importShiftsFile } from "@/lib/office/shift-import";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The office's shift editor and import (src/lib/office/shift-editor.ts, shift-import.ts) on the
// real database, as the app role. NOW is Monday 2 November 2026, 09:00 London (GMT).

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

async function editorFirm() {
  const f = await bookingFirm(su, withFirm);
  const resourcer = await f.office("resourcer");
  const { rows } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, 'Riverside Arena') returning id::text as id",
    [f.firmId],
  );
  const siteId = rows[0]?.id ?? "";
  const ctx = (officeUserId = resourcer) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock: { now: () => NOW },
  });
  return { f, resourcer, siteId, ctx };
}

const line = (role: string, start: string, end: string, headcount = "1") => ({
  role,
  start,
  end,
  headcount,
});
const shiftRow = async (id: string) =>
  (
    await su.query(
      `select role, site_id::text, starts_at, ends_at, headcount, instructions, status, source
         from shifts where id = $1`,
      [id],
    )
  ).rows[0];
const eventsOf = async (firmId: string, action: string) =>
  (
    await su.query<{ actor_type: string; actor_id: string; entity_id: string; data: unknown }>(
      `select actor_type, actor_id::text, entity_id::text, data from events
        where firm_id = $1 and action = $2 order by id`,
      [firmId, action],
    )
  ).rows;

describe("creating shifts", () => {
  it("one shift: native, open, at London time on that date, logged as the office's", async () => {
    const t = await editorFirm();
    const result = await createShifts(t.ctx(), {
      date: "2026-11-07",
      siteId: t.siteId,
      instructions: "  Meet at gate C.  ",
      lines: [line("Door Supervisor", "08:00", "16:00", "2")],
    });
    expect(result.status).toBe("created");
    const id = result.status === "created" ? (result.shiftIds[0] ?? "") : "";
    expect(await shiftRow(id)).toEqual({
      role: "door_supervisor",
      site_id: t.siteId,
      starts_at: new Date("2026-11-07T08:00:00Z"),
      ends_at: new Date("2026-11-07T16:00:00Z"),
      headcount: 2,
      instructions: "Meet at gate C.",
      status: "open",
      source: "native",
    });
    expect(await eventsOf(t.f.firmId, "shift.created")).toEqual([
      { actor_type: "office", actor_id: t.resourcer, entity_id: id, data: { by: "firm" } },
    ]);
  });

  it("a finish at or before the start is the next morning; summer dates are London time", async () => {
    const t = await editorFirm();
    const night = await createShifts(t.ctx(), {
      date: "2026-11-07",
      siteId: "",
      instructions: "",
      lines: [line("steward", "22:00", "06:00")],
    });
    const nightId = night.status === "created" ? (night.shiftIds[0] ?? "") : "";
    expect(await shiftRow(nightId)).toMatchObject({
      starts_at: new Date("2026-11-07T22:00:00Z"),
      ends_at: new Date("2026-11-08T06:00:00Z"),
      site_id: null,
      instructions: null,
    });
    const summer = await createShifts(t.ctx(), {
      date: "2027-07-10",
      siteId: "",
      instructions: "",
      lines: [line("steward", "09:00", "17:00")],
    });
    const summerId = summer.status === "created" ? (summer.shiftIds[0] ?? "") : "";
    expect(await shiftRow(summerId)).toMatchObject({ starts_at: new Date("2027-07-10T08:00:00Z") });
  });

  it("several for an event: blank lines are ignored", async () => {
    const t = await editorFirm();
    const result = await createShifts(t.ctx(), {
      date: "2026-11-07",
      siteId: t.siteId,
      instructions: "",
      lines: [
        line("steward", "08:00", "16:00", "10"),
        line("", "", "", ""),
        line("", "", "", "1"), // an empty line keeps the places box's 1
        line("door supervisor", "10:00", "18:00", "4"),
        line("first aider", "09:00", "17:00"),
      ],
    });
    expect(result).toMatchObject({ status: "created" });
    expect(result.status === "created" && result.shiftIds).toHaveLength(3);
    expect(await eventsOf(t.f.firmId, "shift.created")).toHaveLength(3);
  });

  it("any wrong line saves nothing, and each problem names its line", async () => {
    const t = await editorFirm();
    const result = await createShifts(t.ctx(), {
      date: "2026-11-02",
      siteId: t.siteId,
      instructions: "",
      lines: [
        line("steward", "10:00", "18:00"), // fine
        line("st@ward!", "10:00", "18:00"),
        line("steward", "10:00", "18:00", "0"),
        line("steward", "08:00", "16:00"), // 08:00 today has passed (NOW is 09:00)
        line("steward", "25:00", "18:00"),
      ],
    });
    expect(result).toEqual({
      status: "invalid",
      problems: [
        { line: 2, problem: "bad_role" },
        { line: 3, problem: "bad_headcount" },
        { line: 4, problem: "in_past" },
        { line: 5, problem: "bad_time" },
      ],
    });
    const { rows } = await su.query("select 1 from shifts where firm_id = $1", [t.f.firmId]);
    expect(rows).toEqual([]);
  });

  it("form-wide problems: the date, another firm's site, no lines, instructions too long", async () => {
    const t = await editorFirm();
    const other = await editorFirm();
    expect(
      await createShifts(t.ctx(), {
        date: "07/11/2026",
        siteId: other.siteId,
        instructions: "x".repeat(2001),
        lines: [line("", "", "", "")],
      }),
    ).toEqual({
      status: "invalid",
      problems: [
        { line: null, problem: "bad_date" },
        { line: null, problem: "bad_site" },
        { line: null, problem: "text_too_long" },
        { line: null, problem: "no_lines" },
      ],
    });
  });

  it("only active admins and resourcers", async () => {
    const t = await editorFirm();
    const payroll = await t.f.office("payroll");
    const disabled = await t.f.office("resourcer", "disabled");
    for (const id of [payroll, disabled]) {
      expect(
        await createShifts(t.ctx(id), {
          date: "2026-11-07",
          siteId: "",
          instructions: "",
          lines: [line("steward", "08:00", "16:00")],
        }),
      ).toEqual({ status: "not_allowed" });
    }
  });
});

describe("editing a shift", () => {
  const edit = (o: Partial<Record<string, string>> = {}) => ({
    date: "2026-11-07",
    start: "08:00",
    end: "16:00",
    role: "door supervisor",
    siteId: "",
    headcount: "1",
    instructions: "",
    ...o,
  });

  it("with nobody booked, anything can change; logged with the field names", async () => {
    const t = await editorFirm();
    const shiftId = await t.f.shift({ startsAt: new Date("2026-11-07T08:00:00Z") });
    expect(
      await editShift(
        t.ctx(),
        shiftId,
        edit({
          start: "09:00",
          end: "17:00",
          role: "steward",
          siteId: t.siteId,
          headcount: "3",
          instructions: "Gate C",
        }),
      ),
    ).toEqual({
      status: "saved",
      fields: ["siteId", "role", "headcount", "instructions", "startsAt", "endsAt"],
    });
    expect(await shiftRow(shiftId)).toMatchObject({
      role: "steward",
      site_id: t.siteId,
      headcount: 3,
      instructions: "Gate C",
      starts_at: new Date("2026-11-07T09:00:00Z"),
      ends_at: new Date("2026-11-07T17:00:00Z"),
    });
    expect(await eventsOf(t.f.firmId, "shift.changed")).toEqual([
      {
        actor_type: "office",
        actor_id: t.resourcer,
        entity_id: shiftId,
        data: {
          by: "firm",
          fields: ["siteId", "role", "headcount", "instructions", "startsAt", "endsAt"],
          from: { startsAt: "2026-11-07T08:00:00.000Z", endsAt: "2026-11-07T16:00:00.000Z" },
          to: { startsAt: "2026-11-07T09:00:00.000Z", endsAt: "2026-11-07T17:00:00.000Z" },
        },
      },
    ]);
    expect(
      await editShift(
        t.ctx(),
        shiftId,
        edit({
          start: "09:00",
          end: "17:00",
          role: "steward",
          siteId: t.siteId,
          headcount: "3",
          instructions: "Gate C",
        }),
      ),
    ).toEqual({ status: "unchanged" });
  });

  it("with people booked: places and instructions only; never fewer places than a booked one", async () => {
    const t = await editorFirm();
    const shiftId = await t.f.shift({ startsAt: new Date("2026-11-07T08:00:00Z"), headcount: 3 });
    const ann = await t.f.worker({ first: "Ann" });
    await t.f.booking(ann, shiftId, "confirmed", 2);
    await su.query("update shifts set status = 'open' where id = $1", [shiftId]);
    const base = edit({ headcount: "3" });
    expect(await editShift(t.ctx(), shiftId, { ...base, start: "09:00" })).toEqual({
      status: "has_bookings",
    });
    expect(await editShift(t.ctx(), shiftId, { ...base, role: "steward" })).toEqual({
      status: "has_bookings",
    });
    expect(await editShift(t.ctx(), shiftId, { ...base, siteId: t.siteId })).toEqual({
      status: "has_bookings",
    });
    expect(await editShift(t.ctx(), shiftId, { ...base, headcount: "1" })).toEqual({
      status: "below_bookings",
    });
    expect(
      await editShift(t.ctx(), shiftId, { ...base, headcount: "2", instructions: "Bring ID" }),
    ).toEqual({
      status: "saved",
      fields: ["headcount", "instructions"],
    });
  });

  it("fewer places on a shift now full: its status follows (filled)", async () => {
    const t = await editorFirm();
    const shiftId = await t.f.shift({ startsAt: new Date("2026-11-07T08:00:00Z"), headcount: 2 });
    const ann = await t.f.worker({ first: "Ann" });
    await t.f.booking(ann, shiftId, "confirmed", 1);
    await editShift(t.ctx(), shiftId, edit({ headcount: "1" }));
    expect(await shiftRow(shiftId)).toMatchObject({ headcount: 1, status: "filled" });
  });

  it("a shift the office marked as filled stays closed when edited (only 'Open it again' opens it)", async () => {
    const t = await editorFirm();
    const shiftId = await t.f.shift({ startsAt: new Date("2026-11-07T08:00:00Z"), headcount: 2 });
    await markFilled(t.ctx(), shiftId);
    expect(
      await editShift(t.ctx(), shiftId, edit({ headcount: "2", instructions: "Gate C" })),
    ).toMatchObject({
      status: "saved",
    });
    expect(await shiftRow(shiftId)).toMatchObject({ status: "filled" });
    expect(
      await editShift(t.ctx(), shiftId, edit({ headcount: "3", instructions: "Gate C" })),
    ).toMatchObject({
      status: "saved",
    });
    expect(await shiftRow(shiftId)).toMatchObject({ status: "filled", headcount: 3 });
    expect(await eventsOf(t.f.firmId, "shift.reopened")).toEqual([]);
  });

  it("a full shift given another place opens again", async () => {
    const t = await editorFirm();
    const shiftId = await t.f.shift({ startsAt: new Date("2026-11-07T08:00:00Z") });
    const ann = await t.f.worker({ first: "Ann" });
    await t.f.booking(ann, shiftId, "confirmed", 1);
    await su.query("update shifts set status = 'filled' where id = $1", [shiftId]);
    await editShift(t.ctx(), shiftId, edit({ headcount: "2" }));
    expect(await shiftRow(shiftId)).toMatchObject({ status: "open", headcount: 2 });
  });

  it("a refusal changes nothing and logs nothing", async () => {
    const t = await editorFirm();
    const shiftId = await t.f.shift({ startsAt: new Date("2026-11-07T08:00:00Z"), headcount: 2 });
    const ann = await t.f.worker({ first: "Ann" });
    await t.f.booking(ann, shiftId, "confirmed", 2);
    const before = await shiftRow(shiftId);
    await editShift(t.ctx(), shiftId, edit({ headcount: "2", start: "10:00" }));
    await editShift(t.ctx(), shiftId, edit({ headcount: "1" }));
    expect(await shiftRow(shiftId)).toEqual(before);
    expect(await eventsOf(t.f.firmId, "shift.changed")).toEqual([]);
  });

  it("another firm's site is refused", async () => {
    const t = await editorFirm();
    const other = await editorFirm();
    const shiftId = await t.f.shift({ startsAt: new Date("2026-11-07T08:00:00Z") });
    expect(await editShift(t.ctx(), shiftId, edit({ siteId: other.siteId }))).toEqual({
      status: "invalid",
      problems: ["bad_site"],
    });
  });

  it("moving a shift nobody's booked on expires the offers still out, and logs the old and new times", async () => {
    const t = await editorFirm();
    const shiftId = await t.f.shift({ startsAt: new Date("2026-11-07T08:00:00Z") });
    const ann = await t.f.worker({ first: "Ann" });
    await su.query(
      `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
       values ($1, $2, $3, 1, 'whatsapp', $4)`,
      [t.f.firmId, shiftId, ann, hoursFromNow(-1)],
    );
    await editShift(t.ctx(), shiftId, edit({ start: "10:00", end: "18:00" }));
    const { rows } = await su.query("select response from offers where shift_id = $1", [shiftId]);
    expect(rows).toEqual([{ response: "expired" }]);
    const [changed] = await eventsOf(t.f.firmId, "shift.changed");
    expect(changed?.data).toEqual({
      by: "firm",
      fields: ["startsAt", "endsAt"],
      from: { startsAt: "2026-11-07T08:00:00.000Z", endsAt: "2026-11-07T16:00:00.000Z" },
      to: { startsAt: "2026-11-07T10:00:00.000Z", endsAt: "2026-11-07T18:00:00.000Z" },
    });
  });

  it("not a started or cancelled shift, not a sheet's, not another firm's; bad input says why", async () => {
    const t = await editorFirm();
    const started = await t.f.shift({ startsAt: hoursFromNow(-1) });
    const cancelled = await t.f.shift({ status: "cancelled" });
    const sheet = await t.f.shift({ source: "sheets" });
    expect(await editShift(t.ctx(), started, edit())).toEqual({ status: "not_open" });
    expect(await editShift(t.ctx(), cancelled, edit())).toEqual({ status: "not_open" });
    expect(await editShift(t.ctx(), sheet, edit())).toEqual({ status: "sheet" });
    const other = await editorFirm();
    const theirs = await other.f.shift({});
    expect(await editShift(t.ctx(), theirs, edit())).toEqual({ status: "not_found" });
    const mine = await t.f.shift({ startsAt: new Date("2026-11-07T08:00:00Z") });
    expect(await editShift(t.ctx(), mine, edit({ date: "2026-11-01", headcount: "x" }))).toEqual({
      status: "invalid",
      problems: ["in_past", "bad_headcount"],
    });
    const payroll = await t.f.office("payroll");
    expect(await editShift(t.ctx(payroll), mine, edit())).toEqual({ status: "not_allowed" });
  });
});

describe("importing a file of shifts", () => {
  const csv = (body: string) => new TextEncoder().encode(body);
  const file = csv(
    "Date,Start,End,Role,Site,Needed\n07/11/2026,08:00,16:00,Steward,Riverside Arena,4\n07/11/2026,nine,17:00,Steward,,1\n",
  );

  it("checking saves nothing; importing then creates the good rows and reports the bad one", async () => {
    const t = await editorFirm();
    const check = await importShiftsFile(t.ctx(), file, true);
    expect(check).toEqual({
      status: "done",
      result: {
        kind: "shifts",
        dryRun: true,
        created: 1,
        updated: 0,
        unchanged: 0,
        skipped: 1,
        problems: [{ row: 3, problem: "bad_time" }],
      },
    });
    const none = await su.query("select 1 from shifts where firm_id = $1", [t.f.firmId]);
    expect(none.rows).toEqual([]);
    expect(await importShiftsFile(t.ctx(), file, false)).toMatchObject({
      status: "done",
      result: { dryRun: false, created: 1, skipped: 1 },
    });
    const { rows } = await su.query<{ headcount: number; source: string }>(
      "select headcount, source from shifts where firm_id = $1",
      [t.f.firmId],
    );
    expect(rows).toEqual([{ headcount: 4, source: "csv" }]);
    // The same file again updates rather than adds.
    expect(await importShiftsFile(t.ctx(), file, false)).toMatchObject({
      result: { created: 0, unchanged: 1 },
    });
  });

  it("a new site for a booked shift is a move: the import leaves it and says why", async () => {
    const t = await editorFirm();
    const first = csv(
      "Shift ID,Date,Start,End,Role,Site\nS1,07/11/2026,08:00,16:00,Steward,Riverside Arena\n",
    );
    await importShiftsFile(t.ctx(), first, false);
    const { rows } = await su.query<{ id: string }>(
      "select id::text as id from shifts where firm_id = $1",
      [t.f.firmId],
    );
    const shiftId = rows[0]?.id ?? "";
    const ann = await t.f.worker({ first: "Ann", roles: ["steward"] });
    await t.f.booking(ann, shiftId, "confirmed", 1);
    const moved = csv(
      "Shift ID,Date,Start,End,Role,Site\nS1,07/11/2026,08:00,16:00,Steward,Other Stadium\n",
    );
    expect(await importShiftsFile(t.ctx(), moved, false)).toMatchObject({
      result: { updated: 0, skipped: 1, problems: [{ row: 2, problem: "shift_has_bookings" }] },
    });
    const site = await su.query<{ name: string }>(
      "select si.name from shifts s join sites si on si.id = s.site_id where s.id = $1",
      [shiftId],
    );
    expect(site.rows).toEqual([{ name: "Riverside Arena" }]);
  });

  it("a file it can't read says why; too big for the web; payroll can't", async () => {
    const t = await editorFirm();
    expect(await importShiftsFile(t.ctx(), csv("Date,Start,End,Role\n"), true)).toEqual({
      status: "file_error",
      code: "empty",
    });
    expect(await importShiftsFile(t.ctx(), csv("Date,Start\n07/11/2026,08:00\n"), true)).toEqual({
      status: "file_error",
      code: "missing_column",
    });
    expect(await importShiftsFile(t.ctx(), new Uint8Array(1_000_000), true)).toEqual({
      status: "too_big",
    });
    const payroll = await t.f.office("payroll");
    expect(await importShiftsFile(t.ctx(payroll), file, true)).toEqual({ status: "not_allowed" });
  });
});
