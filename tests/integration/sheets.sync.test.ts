import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { sheetsRosterPlug } from "@/lib/roster/native";
import { automaticEventName } from "@/lib/roster/shift-events";
import type { RosterPlug } from "@/lib/roster/plug";
import { eventsAboutWorker, loadActionLog, parseLogQuery } from "@/lib/office/action-log";
import { loadToday } from "@/lib/office/today";
import { DEFAULT_SHEET_MAPPING } from "@/lib/roster/sheets/mapping";
import {
  CANCELLED_ON_SHEET,
  CHANGED_ON_SHEET,
  REMOVED_ON_SHEET,
  SITE_CHANGED_ON_SHEET,
  syncSheet,
  SYNC_LEASE_MS,
} from "@/lib/roster/sheets/sync";
import { appRolePool, superuserPool, uniqueSlug } from "../helpers/db";
import {
  FakeSheets,
  londonDate,
  londonTime,
  SHIFT_HEADER,
  shiftRow,
  STAFF_HEADER,
  staffRow,
  type ShiftCells,
  type StaffCells,
} from "../helpers/fake-sheets";
import {
  book as bookWithPass,
  describeRosterContract,
  NOW,
  SCENARIO,
  type CancellationRecord,
  type RosterFixture,
} from "../helpers/roster-contract";
import { runFirmTask } from "@/lib/jobs/firm-job";
import { createTravelEstimatesTask } from "@/lib/travel/estimates";
import { fakePoint } from "@/lib/travel/geocoder";
import { fakeTravelProvider } from "@/lib/travel/provider";

// A firm's Google Sheet kept in step with our tables, both ways (PLAN.md Phase 2: "a seeded Sheet
// syncs both ways"), on the real database as the app role, against an in-memory fake of Google
// Sheets that counts every read and write. First the shared RosterPlug contract for the Sheets
// plug (the portal's view of a Sheets firm), then the sync itself.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(8);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const at = (d: Date) => ({ now: () => d });
const HOUR = 3_600_000;

interface SheetFirm {
  firmId: string;
  sheetId: string;
  fake: FakeSheets;
}

async function one(text: string, values: unknown[]): Promise<string> {
  const { rows } = await su.query<{ id: string }>(`${text} returning id::text as id`, values);
  const id = rows[0]?.id;
  if (!id) throw new Error(`insert returned no id: ${text}`);
  return id;
}

async function sheetFirm(staff: string[][], shifts: string[][]): Promise<SheetFirm> {
  const slug = uniqueSlug("g");
  const firmId = await one("insert into firms (name, slug, sector) values ($1, $2, 'rail')", [
    `Sheets Test ${slug}`,
    slug,
  ]);
  const sheetId = `test_${randomBytes(30).toString("base64url")}`.slice(0, 44);
  await su.query(
    "insert into roster_sources (firm_id, kind, spreadsheet_id, mapping) values ($1, 'sheets', $2, $3)",
    [firmId, sheetId, JSON.stringify(DEFAULT_SHEET_MAPPING)],
  );
  // The sync books the sheet's names through the rules engine, which fails closed on a role
  // with no credential rule: these roles need no credential (tests of refused names add one).
  await su.query(
    `insert into credential_rules (firm_id, sector, role, required_types)
     select $1, 'rail', r, '{}' from unnest(array['track_operative', 'coss', 'steward', 'door_supervisor']) r`,
    [firmId],
  );
  const fake = new FakeSheets();
  fake.create(sheetId, { Staff: [STAFF_HEADER, ...staff], Shifts: [SHIFT_HEADER, ...shifts] });
  return { firmId, sheetId, fake };
}

const sync = (f: SheetFirm, when: Date = NOW) =>
  syncSheet({ run: withFirm, firmId: f.firmId, client: f.fake, clock: at(when) });

const idOf = async (table: "workers" | "shifts", firmId: string, ref: string) => {
  const { rows } = await su.query<{ id: string }>(
    `select id::text as id from ${table} where firm_id = $1 and external_ref = $2`,
    [firmId, ref],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`no ${table} row ${ref}`);
  return id;
};

const holdersOf = async (firmId: string, shiftRef: string) =>
  (
    await su.query<{ ref: string }>(
      `select w.external_ref as ref from assignments a
         join shifts s on s.id = a.shift_id join workers w on w.id = a.worker_id
        where s.firm_id = $1 and s.external_ref = $2 and a.worker_id is not null
          and a.status not in ('cancelled_worker', 'cancelled_firm')
        order by a.slot`,
      [firmId, shiftRef],
    )
  ).rows.map((r) => r.ref);

const eventsOf = async (firmId: string, action: string) =>
  (
    await su.query<{ data: Record<string, unknown>; entity_id: string | null }>(
      "select data, entity_id::text from events where firm_id = $1 and action = $2 order by id",
      [firmId, action],
    )
  ).rows;

// A portal booking straight on the Sheets plug (these tests are about the sync, not the rules:
// bookShift in book.ts is the real booking path and has its own tests).
const book = (firmId: string, shiftId: string, workerId: string, when = NOW) =>
  withFirm(firmId, (tx) =>
    bookWithPass(sheetsRosterPlug(tx, { clock: at(when) }), shiftId, workerId),
  );

// --- The shared contract, for the Sheets plug over a synced sheet ----------------------------

const BOOKED_AT = new Date(NOW.getTime() - 7 * 24 * HOUR); // the first sync, a week before NOW

async function contractFixture(): Promise<RosterFixture> {
  const staff = SCENARIO.staff.map((s) =>
    staffRow({
      ref: `S-${s.key}`,
      first: s.firstName,
      last: s.lastName,
      mobile: s.mobileE164,
      roles: s.roles.join(", "),
      status: s.status === "active" ? "" : s.status,
    }),
  );
  const shifts = SCENARIO.shifts.map((s) =>
    shiftRow({
      ref: `SH-${s.key}`,
      date: londonDate(s.startsAt),
      start: londonTime(s.startsAt),
      end: londonTime(s.endsAt),
      site: s.siteName ?? "",
      role: s.role,
      needed: String(s.headcount),
      status: s.status === "draft" || s.status === "cancelled" ? s.status : "",
      instructions: s.instructions ?? "",
      assigned: s.holders.map((h) => `S-${h}`).join(", "),
    }),
  );
  const f = await sheetFirm(staff, shifts);
  expect((await sync(f, BOOKED_AT)).status).toBe("synced");
  const ids = { staff: {}, shifts: {} } as RosterFixture["ids"];
  const refs = { staff: {}, shifts: {} } as RosterFixture["refs"];
  for (const s of SCENARIO.staff) {
    ids.staff[s.key] = await idOf("workers", f.firmId, `S-${s.key}`);
    refs.staff[s.key] = `S-${s.key}`;
  }
  for (const s of SCENARIO.shifts) {
    ids.shifts[s.key] = await idOf("shifts", f.firmId, `SH-${s.key}`);
    refs.shifts[s.key] = `SH-${s.key}`;
  }
  const call = <T>(fn: (plug: RosterPlug) => Promise<T>) =>
    withFirm(f.firmId, (tx) => fn(sheetsRosterPlug(tx, { clock: at(NOW) })));
  const { source, canWrite } = await call(async (p) => ({
    source: p.source,
    canWrite: p.canWrite,
  }));
  const plug: RosterPlug = {
    source,
    canWrite,
    listStaff: () => call((p) => p.listStaff()),
    getShifts: (from, to) => call((p) => p.getShifts(from, to)),
    assign: (shiftId, workerId, pass) => call((p) => p.assign(shiftId, workerId, pass)),
    markCancelled: (shiftId, workerId, cancel) =>
      call((p) => p.markCancelled(shiftId, workerId, cancel)),
  };
  const cancellations = (): Promise<CancellationRecord[]> =>
    withFirm(f.firmId, async (tx) => {
      const { rows } = await tx.execute<{
        id: string;
        ref: string;
        status: string;
        cancel_reason: string;
        notice_hours: string;
      }>(sql`
        select a.id, w.external_ref as ref, a.status, a.cancel_reason, a.notice_hours::text
          from assignments a join workers w on w.firm_id = a.firm_id and w.id = a.worker_id
         where a.status in ('cancelled_worker', 'cancelled_firm') order by a.cancelled_at, a.id
      `);
      return rows.map((r) => ({
        assignmentId: r.id,
        staffRef: r.ref,
        by: r.status === "cancelled_firm" ? ("firm" as const) : ("worker" as const),
        reason: r.cancel_reason,
        noticeHours: Number(r.notice_hours),
      }));
    });
  return { plug, ids, refs, cancellations };
}

describeRosterContract("Google Sheets adapter (the synced mirror of a fake sheet)", {
  writable: contractFixture,
  twoFirms: async () => ({ mine: await contractFixture(), theirs: await contractFixture() }),
});

// --- The sync -------------------------------------------------------------------------------

const ADA: StaffCells = {
  ref: "N001",
  first: "Ada",
  last: "Example",
  mobile: "07700 900301",
  roles: "Track Operative, COSS",
};
const BEN: StaffCells = {
  ref: "N002",
  first: "Ben",
  last: "Example",
  mobile: "07700 900302",
  roles: "track_operative",
};
const CAL: StaffCells = {
  ref: "N003",
  first: "Cal",
  last: "Example",
  mobile: "07700 900303",
  roles: "track_operative",
};
// Saturday night possession (GMT) starting 37 hours after NOW, and a June day shift (BST).
const P1: ShiftCells = {
  ref: "P1",
  date: "07/11/2026",
  start: "22:00",
  end: "06:00",
  site: "Demo Junction",
  role: "Track Operative",
  needed: "2",
  assigned: "N001",
};
const P2: ShiftCells = {
  ref: "P2",
  date: "14/06/2027",
  start: "09:30",
  end: "17:30",
  role: "coss",
  assigned: "",
};

const northline = () => sheetFirm([ADA, BEN, CAL].map(staffRow), [P1, P2].map(shiftRow));
const SHIFTS = "Shifts";

describe("sheets.sync: from the sheet into our tables", () => {
  it("a seeded sheet syncs in: staff by staff id, sites, shifts in UTC, and who holds each, with one read", async () => {
    const f = await northline();
    const outcome = await sync(f);
    expect(outcome).toMatchObject({
      status: "synced",
      staff: 3,
      shifts: 2,
      booked: 1,
      writes: 0,
      problems: [],
    });
    expect(f.fake.reads).toBe(1);
    expect(f.fake.writes).toBe(0);

    const { rows: people } = await su.query(
      "select external_ref, first_name, mobile_e164, roles, status from workers where firm_id = $1 order by external_ref",
      [f.firmId],
    );
    expect(people).toEqual([
      {
        external_ref: "N001",
        first_name: "Ada",
        mobile_e164: "+447700900301",
        roles: ["track_operative", "coss"],
        status: "active",
      },
      {
        external_ref: "N002",
        first_name: "Ben",
        mobile_e164: "+447700900302",
        roles: ["track_operative"],
        status: "active",
      },
      {
        external_ref: "N003",
        first_name: "Cal",
        mobile_e164: "+447700900303",
        roles: ["track_operative"],
        status: "active",
      },
    ]);
    const { rows: shifts } = await su.query(
      `select s.external_ref, s.source, s.role, s.starts_at, s.ends_at, s.headcount, s.status, si.name as site,
              s.synced_holders
         from shifts s left join sites si on si.id = s.site_id where s.firm_id = $1 order by s.external_ref`,
      [f.firmId],
    );
    expect(shifts).toEqual([
      {
        external_ref: "P1",
        source: "sheets",
        role: "track_operative",
        starts_at: new Date("2026-11-07T22:00:00Z"),
        ends_at: new Date("2026-11-08T06:00:00Z"),
        headcount: 2,
        status: "open",
        site: "Demo Junction",
        synced_holders: ["N001"],
      },
      {
        external_ref: "P2",
        source: "sheets",
        role: "coss",
        starts_at: new Date("2027-06-14T08:30:00Z"),
        ends_at: new Date("2027-06-14T16:30:00Z"),
        headcount: 1,
        status: "open",
        site: null,
        synced_holders: [],
      },
    ]);
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N001"]);
    const [synced] = await eventsOf(f.firmId, "roster.synced");
    expect(synced?.data).toMatchObject({ staff: 3, shifts: 2, booked: 1, writes: 0, problems: 0 });
  });

  it("syncing again with nothing changed writes nothing and books nothing", async () => {
    const f = await northline();
    await sync(f);
    const again = await sync(f, new Date(NOW.getTime() + 60_000));
    expect(again).toMatchObject({ status: "synced", booked: 0, cancelled: 0, writes: 0 });
    expect(f.fake.writes).toBe(0);
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N001"]);
  });

  it("a name the office adds in the sheet becomes a booking, logged as the firm's", async () => {
    const f = await northline();
    await sync(f);
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N001, N002");
    expect(await sync(f)).toMatchObject({ booked: 1, writes: 0 });
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N001", "N002"]);
    const assigned = await eventsOf(f.firmId, "shift.assigned");
    // P1 starts 37 hours after NOW: the booking gave 37 hours' notice.
    expect(assigned.at(-1)?.data).toEqual({
      source: "sheets",
      by: "firm",
      shiftId: await idOf("shifts", f.firmId, "P1"),
      workerId: await idOf("workers", f.firmId, "N002"),
      slot: 2,
      noticeHours: 37,
      reason: "Put on the rota sheet by the office",
    });
  });

  it("a name the office removes in the sheet is a cancellation by the firm, with notice hours, logged", async () => {
    const f = await northline();
    await sync(f);
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "");
    const later = new Date(NOW.getTime() + 2 * HOUR); // P1 starts 37 h after NOW: 35 h notice
    expect(await sync(f, later)).toMatchObject({ cancelled: 1, writes: 0 });
    expect(await holdersOf(f.firmId, "P1")).toEqual([]);
    const { rows } = await su.query(
      `select a.status, a.cancel_reason, a.notice_hours::text, a.cancelled_at from assignments a
         join shifts s on s.id = a.shift_id where s.firm_id = $1 and s.external_ref = 'P1'
          and a.status like 'cancelled%'`,
      [f.firmId],
    );
    expect(rows).toEqual([
      {
        status: "cancelled_firm",
        cancel_reason: REMOVED_ON_SHEET,
        notice_hours: "35.00",
        cancelled_at: later,
      },
    ]);
    // The open row that reopened the cancelled booking's place (its slot's one live row).
    const { rows: reopened } = await su.query<{ id: string }>(
      `select a.id::text as id from assignments a
         join shifts s on s.id = a.shift_id
         join assignments c on c.shift_id = a.shift_id and c.slot = a.slot
                           and c.status = 'cancelled_firm'
        where s.firm_id = $1 and s.external_ref = 'P1' and a.status = 'open'`,
      [f.firmId],
    );
    expect(reopened).toHaveLength(1);
    const [event] = await eventsOf(f.firmId, "shift.cancelled");
    expect(event?.data).toEqual({
      source: "sheets",
      by: "firm",
      shiftId: await idOf("shifts", f.firmId, "P1"),
      workerId: await idOf("workers", f.firmId, "N001"),
      reason: REMOVED_ON_SHEET,
      noticeHours: 35,
      strike: "by_firm", // the sheet is the firm's: never a strike (12C.1)
      place: "reopened", // what became of the place (12C.3)
      reopenedId: reopened[0]?.id,
    });
    // 35 hours out is outside the 24-hour urgent window: not urgent.
    expect(await eventsOf(f.firmId, "shift.marked_urgent")).toEqual([]);
  });

  it("a name the office removes close to the start leaves an urgent gap", async () => {
    const f = await northline();
    await sync(f);
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "");
    const late = new Date(NOW.getTime() + 30 * HOUR); // P1 starts 37 h after NOW: 7 h to go
    expect(await sync(f, late)).toMatchObject({ cancelled: 1 });
    const shiftId = await idOf("shifts", f.firmId, "P1");
    const { rows } = await su.query("select is_urgent from shifts where id = $1", [shiftId]);
    expect(rows).toEqual([{ is_urgent: true }]);
    expect(await eventsOf(f.firmId, "shift.marked_urgent")).toEqual([
      {
        entity_id: shiftId,
        data: { source: "sheets", by: "system", cause: "dropout", hoursToStart: 7 },
      },
    ]);
    // And offers go out: wave 1 is queued.
    const { rows: jobs } = await su.query(
      "select data ->> 'wave' as wave from pgboss.job where name = 'offer-wave' and data ->> 'shiftId' = $1",
      [shiftId],
    );
    expect(jobs).toEqual([{ wave: "1" }]);
  });

  it("a name swapped for another close to the start is no dropout: nothing urgent", async () => {
    const f = await northline();
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N001, N002"); // P1 full: 2 of 2
    await sync(f);
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N001, N003"); // N002 out, N003 in
    const late = new Date(NOW.getTime() + 30 * HOUR); // 7 h to go
    expect(await sync(f, late)).toMatchObject({ cancelled: 1, booked: 1 });
    const shiftId = await idOf("shifts", f.firmId, "P1");
    const { rows } = await su.query("select is_urgent, status from shifts where id = $1", [
      shiftId,
    ]);
    expect(rows).toEqual([{ is_urgent: false, status: "filled" }]);
    expect(await eventsOf(f.firmId, "shift.marked_urgent")).toEqual([]);
  });

  it("a whole shift cancelled on the sheet close to the start isn't an urgent gap", async () => {
    const f = await northline();
    await sync(f);
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Status", "Cancelled");
    const late = new Date(NOW.getTime() + 30 * HOUR); // 7 h to go
    expect(await sync(f, late)).toMatchObject({ cancelled: 1 });
    const shiftId = await idOf("shifts", f.firmId, "P1");
    const { rows } = await su.query("select is_urgent, status from shifts where id = $1", [
      shiftId,
    ]);
    expect(rows).toEqual([{ is_urgent: false, status: "cancelled" }]);
    expect(await eventsOf(f.firmId, "shift.marked_urgent")).toEqual([]);
  });

  it("new times on a booked shift are logged per booked worker as moved or curtailed, with notice", async () => {
    const f = await northline();
    await sync(f);
    f.fake.setCell(f.sheetId, SHIFTS, 2, "End", "04:00"); // 22:00-06:00 cut to 22:00-04:00
    await sync(f);
    const [curtailed] = await eventsOf(f.firmId, "shift.curtailed");
    expect(curtailed?.data).toEqual({
      source: "sheets",
      by: "firm",
      shiftId: expect.any(String),
      workerId: expect.any(String),
      reason: CHANGED_ON_SHEET,
      oldStartsAt: "2026-11-07T22:00:00.000Z",
      oldEndsAt: "2026-11-08T06:00:00.000Z",
      newStartsAt: "2026-11-07T22:00:00.000Z",
      newEndsAt: "2026-11-08T04:00:00.000Z",
      // The site too, as the office editor logs it (Phase 10): here it didn't change.
      oldSiteId: expect.any(String),
      newSiteId: expect.any(String),
      noticeHours: 37,
      // The rules' answer for Ada at the new times (Phase 10): fine.
      rulesOk: true,
    });
    expect(curtailed?.data.oldSiteId).toBe(curtailed?.data.newSiteId);
    // The shift and worker named are the booking's own (the notice report reads them).
    const { rows: booking } = await su.query<{ shift_id: string; worker_id: string }>(
      "select shift_id::text, worker_id::text from assignments where id = $1",
      [curtailed?.entity_id],
    );
    expect([curtailed?.data.shiftId, curtailed?.data.workerId]).toEqual([
      booking[0]?.shift_id,
      booking[0]?.worker_id,
    ]);
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Start", "21:00"); // starts earlier: a move
    await sync(f);
    const moved = await eventsOf(f.firmId, "shift.moved");
    expect(moved).toHaveLength(1);
    // Notice from the earlier (new) start, 21:00: 36 hours, not 37 from the old 22:00 (audit M6).
    expect(moved[0]?.data).toMatchObject({ noticeHours: 36 });
  });

  it("a shift the office marks cancelled cancels each booking as the firm's, and can't be taken", async () => {
    const f = await northline();
    await sync(f);
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Status", "Cancelled");
    expect(await sync(f)).toMatchObject({ cancelled: 1 });
    const shiftId = await idOf("shifts", f.firmId, "P1");
    const { rows } = await su.query("select status from shifts where id = $1", [shiftId]);
    expect(rows[0]?.status).toBe("cancelled");
    const [event] = await eventsOf(f.firmId, "shift.cancelled");
    expect(event?.data).toMatchObject({ by: "firm", reason: CANCELLED_ON_SHEET, noticeHours: 37 });
    expect(await book(f.firmId, shiftId, await idOf("workers", f.firmId, "N002"))).toEqual({
      status: "not_open",
    });
  });

  it("a draft row's names are the office's plan: nobody is booked and the cell is left alone", async () => {
    const f = await sheetFirm([ADA].map(staffRow), [shiftRow({ ...P1, status: "Draft" })]);
    expect(await sync(f)).toMatchObject({ booked: 0, writes: 0 });
    expect(await holdersOf(f.firmId, "P1")).toEqual([]);
    expect(f.fake.cell(f.sheetId, SHIFTS, 2, "Assigned")).toBe("N001");
  });

  it("a worker already here with the same mobile and no staff id is linked, not duplicated", async () => {
    const f = await northline();
    // The same person (name case and spacing aside), added before the sheet was connected.
    await su.query(
      "insert into workers (firm_id, first_name, last_name, mobile_e164) values ($1, 'ada', ' Example', '+447700900301')",
      [f.firmId],
    );
    await sync(f);
    const { rows } = await su.query(
      "select external_ref, first_name, last_name from workers where firm_id = $1 and mobile_e164 = '+447700900301'",
      [f.firmId],
    );
    // Linked, and the sheet's spelling of the name kept from now on.
    expect(rows).toEqual([{ external_ref: "N001", first_name: "Ada", last_name: "Example" }]);
  });

  // Audit L71, L78: a Staff ID whose mobile belongs to someone else here is never linked to them.
  it("a new staff id whose mobile is a worker's with another name isn't linked or renamed; the office is told", async () => {
    const f = await northline();
    const other = await one(
      "insert into workers (firm_id, first_name, last_name, mobile_e164) values ($1, 'Zoe', 'Other', '+447700900301')",
      [f.firmId],
    );
    const result = await sync(f);
    expect(result).toMatchObject({ status: "synced" });
    expect(result.status === "synced" ? result.problems : []).toContainEqual({
      tab: "staff",
      row: 2,
      problem: "name_mismatch",
    });
    const { rows } = await su.query(
      "select external_ref, first_name, last_name from workers where id = $1",
      [other],
    );
    expect(rows).toEqual([{ external_ref: null, first_name: "Zoe", last_name: "Other" }]);
    // N001 isn't booked anywhere: there's no N001 here.
    expect(await holdersOf(f.firmId, "P1")).toEqual([]);
    // The office's action log says so, with the sync.
    const log = await withFirm(f.firmId, (tx) =>
      loadActionLog(tx, parseLogQuery({ type: "sheet" }), new Date()),
    );
    expect(log.entries.map((e) => e.words)).toContain(
      "The rota sheet was read (2 shifts). 1 staff row wasn't taken: a mobile or Staff ID in it belongs to someone else here with another name. Check the sheet's Staff tab.",
    );
  });
});

describe("sheets.sync: from our tables back to the sheet", () => {
  it("a booking made in the portal reaches the sheet in one batch write; requests never touch the sheet", async () => {
    const f = await northline();
    await sync(f);
    const [reads, writes] = [f.fake.reads, f.fake.writes];
    const shiftId = await idOf("shifts", f.firmId, "P1");
    expect(await book(f.firmId, shiftId, await idOf("workers", f.firmId, "N002"))).toMatchObject({
      status: "assigned",
      slot: 2,
    });
    // The portal's booking and reads touched only our tables.
    await withFirm(f.firmId, (tx) => sheetsRosterPlug(tx).listStaff());
    expect([f.fake.reads, f.fake.writes]).toEqual([reads, writes]);

    expect(await sync(f)).toMatchObject({ writes: 1, skippedWrites: 0 });
    expect(f.fake.writes).toBe(writes + 1);
    expect(f.fake.reads).toBe(reads + 2); // the sheet, then its id column just before writing
    expect(f.fake.lastWrites).toEqual([{ range: "'Shifts'!J2", value: "N001, N002" }]);
    expect(f.fake.cell(f.sheetId, SHIFTS, 2, "Assigned")).toBe("N001, N002");
    const { rows } = await su.query("select synced_holders from shifts where id = $1", [shiftId]);
    expect(rows[0]?.synced_holders).toEqual(["N001", "N002"]);

    await sync(f);
    expect(f.fake.writes).toBe(writes + 1); // in step now: nothing more to write
  });

  it("a cancel in the portal takes the name off the sheet", async () => {
    const f = await northline();
    await sync(f);
    const cancel = await withFirm(f.firmId, async (tx) =>
      sheetsRosterPlug(tx, { clock: at(NOW) }).markCancelled(
        await idOf("shifts", f.firmId, "P1"),
        await idOf("workers", f.firmId, "N001"),
        { reason: "Unwell", by: "worker", at: NOW },
      ),
    );
    expect(cancel.status).toBe("cancelled");
    expect(await sync(f)).toMatchObject({ writes: 1 });
    expect(f.fake.cell(f.sheetId, SHIFTS, 2, "Assigned")).toBe("");
  });

  it("when both sides changed one shift, each side's removals and additions are kept", async () => {
    const f = await northline();
    await sync(f); // P1: N001, needs 2
    const shiftId = await idOf("shifts", f.firmId, "P1");
    await book(f.firmId, shiftId, await idOf("workers", f.firmId, "N002")); // portal: + N002
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N003"); // office: N001 out, N003 in
    const outcome = await sync(f);
    expect(outcome).toMatchObject({ booked: 1, cancelled: 1, notBooked: 0, writes: 1 });
    // N001's slot 1 went to N003; N002 keeps slot 2. The cell lists holders in slot order.
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N003", "N002"]);
    expect(f.fake.cell(f.sheetId, SHIFTS, 2, "Assigned")).toBe("N003, N002");
  });

  it("a portal booking beats a sheet name for the last place; the clash is logged for the office", async () => {
    const f = await northline();
    await sync(f);
    const shiftId = await idOf("shifts", f.firmId, "P1");
    await book(f.firmId, shiftId, await idOf("workers", f.firmId, "N002")); // P1 now full
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N001, N003"); // office adds N003 too
    expect(await sync(f)).toMatchObject({ notBooked: 1, writes: 1 });
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N001", "N002"]);
    // The portal booking goes into the sheet. N003 can't stay: the cell would name three people
    // for two places (the next read couldn't use it). It's on Today and in the log instead.
    expect(f.fake.cell(f.sheetId, SHIFTS, 2, "Assigned")).toBe("N001, N002");
    expect((await eventsOf(f.firmId, "roster.sheet_booking_refused"))[0]?.data).toMatchObject({
      workerId: await idOf("workers", f.firmId, "N003"),
      codes: ["no_place"],
    });
    const [clash] = await eventsOf(f.firmId, "roster.sheet_conflict");
    expect(clash).toEqual({ data: { source: "sheets", notBooked: 1 }, entity_id: shiftId });
  });

  it("if the write fails, nothing booked here is lost: the next sync writes it", async () => {
    const f = await northline();
    await sync(f);
    const shiftId = await idOf("shifts", f.firmId, "P1");
    await book(f.firmId, shiftId, await idOf("workers", f.firmId, "N002"));
    f.fake.failNextWrite = "sheets_unavailable";
    expect(await sync(f)).toEqual({ status: "failed", code: "sheets_unavailable" });
    const { rows } = await su.query(
      "select last_error_code, sync_started_at from roster_sources where firm_id = $1",
      [f.firmId],
    );
    expect(rows[0]).toEqual({ last_error_code: "sheets_unavailable", sync_started_at: null });
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N001", "N002"]);
    expect(f.fake.cell(f.sheetId, SHIFTS, 2, "Assigned")).toBe("N001");

    expect(await sync(f)).toMatchObject({ status: "synced", writes: 1 });
    expect(f.fake.cell(f.sheetId, SHIFTS, 2, "Assigned")).toBe("N001, N002");
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N001", "N002"]);
  });

  it("a row that moved between the read and the write isn't written; the next sync writes it", async () => {
    const f = await northline();
    await sync(f);
    await book(
      f.firmId,
      await idOf("shifts", f.firmId, "P1"),
      await idOf("workers", f.firmId, "N002"),
    );
    const readsBefore = f.fake.reads;
    f.fake.beforeRead = (n) => {
      // The office inserts a row at the top between our read and our write.
      if (n === readsBefore + 2)
        f.fake.tab(f.sheetId, SHIFTS).splice(1, 0, shiftRow({ ...P2, ref: "P0" }));
    };
    expect(await sync(f)).toMatchObject({ writes: 0, skippedWrites: 1 });
    expect(f.fake.cell(f.sheetId, SHIFTS, 3, "Assigned")).toBe("N001"); // untouched
    f.fake.beforeRead = null;
    expect(await sync(f)).toMatchObject({ writes: 1 });
    expect(f.fake.cell(f.sheetId, SHIFTS, 3, "Assigned")).toBe("N001, N002");
  });
});

describe("sheets.sync: bad data, failures and safety", () => {
  it("bad rows are skipped and reported by row and code, never their contents; good rows still sync", async () => {
    const f = await sheetFirm(
      [staffRow(ADA), staffRow({ ...BEN, mobile: "call 07700 900999 after 6" })],
      [
        shiftRow(P1),
        shiftRow({ ...P2, date: "someday" }),
        shiftRow({ ...P2, ref: "P3", assigned: "N404" }),
      ],
    );
    const outcome = await sync(f);
    expect(outcome).toMatchObject({ status: "synced", staff: 1, shifts: 2 });
    if (outcome.status !== "synced") return;
    expect(outcome.problems).toEqual([
      { tab: "staff", row: 3, problem: "bad_mobile" },
      { tab: "shifts", row: 3, problem: "bad_date" },
      { tab: "shifts", row: 4, problem: "unknown_staff" },
    ]);
    const { rows } = await su.query("select data::text from events where firm_id = $1", [f.firmId]);
    expect(rows.map((r) => r.data).join(" ")).not.toContain("900999");
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N001"]);
    expect(await holdersOf(f.firmId, "P3")).toEqual([]);
  });

  it.each([
    ["a missing column", "missing_column"],
    ["a sheet not shared with us", "sheet_not_shared"],
  ])("%s fails the sync with a code, logs it and frees the lease", async (label, code) => {
    const f = await northline();
    if (code === "missing_column") f.fake.tab(f.sheetId, SHIFTS)[0]?.splice(9, 1);
    else f.fake.failNextRead = "sheet_not_shared";
    expect(await sync(f)).toEqual({ status: "failed", code });
    const { rows } = await su.query(
      "select last_error_code, sync_started_at, last_synced_at from roster_sources where firm_id = $1",
      [f.firmId],
    );
    expect(rows[0]).toEqual({ last_error_code: code, sync_started_at: null, last_synced_at: null });
    const [failed] = await eventsOf(f.firmId, "roster.sync_failed");
    expect(failed?.data).toEqual({ code });
    expect(label).toBeTruthy();
  });

  // Audit M17: cells are read as the sheet shows them, and a date as day/month/year. A sheet in a
  // US locale shows 12 June 2027 as "6/12/2027", which would be read as 6 December.
  it("a sheet whose locale isn't United Kingdom isn't read at all; the office is told why, once", async () => {
    const f = await northline();
    f.fake.setLocale(f.sheetId, "en_US");
    expect(await sync(f)).toEqual({ status: "failed", code: "sheet_locale_not_uk" });
    expect(await sync(f, new Date(NOW.getTime() + 5 * 60_000))).toEqual({
      status: "failed",
      code: "sheet_locale_not_uk",
    });
    // Nothing read past the locale, nothing imported, nothing written.
    expect(f.fake.reads).toBe(0);
    expect(f.fake.writes).toBe(0);
    const { rows: imported } = await su.query<{ n: number }>(
      `select (select count(*) from shifts where firm_id = $1)::int
            + (select count(*) from workers where firm_id = $1)::int as n`,
      [f.firmId],
    );
    expect(imported[0]?.n).toBe(0);
    const failed = await eventsOf(f.firmId, "roster.sync_failed");
    expect(failed.map((e) => e.data)).toEqual([{ code: "sheet_locale_not_uk" }]);
    // As the office's action log shows it (events are stamped with the real clock).
    const log = await withFirm(f.firmId, (tx) =>
      loadActionLog(tx, parseLogQuery({ type: "sheet" }), new Date()),
    );
    expect(log.entries.map((e) => e.words)).toContain(
      "Reading the rota sheet failed: the sheet's locale isn't United Kingdom, so its dates could be read the wrong way round. In Google Sheets: File, Settings, Locale: United Kingdom, then Save settings. Then check the sheet's dates: ones typed before the change may have moved.",
    );

    // The office changes it: the next sync goes ahead.
    f.fake.setLocale(f.sheetId, "en_GB");
    expect(await sync(f, new Date(NOW.getTime() + 10 * 60_000))).toMatchObject({
      status: "synced",
    });
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N001"]);
    const { rows } = await su.query(
      "select last_error_code from roster_sources where firm_id = $1",
      [f.firmId],
    );
    expect(rows[0]).toEqual({ last_error_code: null });
    // One locale request per sync, the failed ones included (what the quota note counts).
    expect(f.fake.localeReads).toBe(3);
  });

  it("a sheet switched to another locale after syncing well stops being read; what's here stays", async () => {
    const f = await northline();
    expect(await sync(f)).toMatchObject({ status: "synced" });
    const shiftsNow = async () =>
      (
        await su.query(
          "select external_ref, starts_at, ends_at, status from shifts where firm_id = $1 order by external_ref",
          [f.firmId],
        )
      ).rows;
    const before = await shiftsNow();
    const readsBefore = f.fake.reads;
    f.fake.setLocale(f.sheetId, "en_US");
    // The office then edits a date, which the sync must not read.
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Date", "6/12/2030");
    expect(await sync(f, new Date(NOW.getTime() + 60_000))).toEqual({
      status: "failed",
      code: "sheet_locale_not_uk",
    });
    expect(f.fake.reads).toBe(readsBefore);
    expect(await shiftsNow()).toEqual(before);
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N001"]);
  });

  it("the locale request refused (the sheet no longer shared): the same failure as any read", async () => {
    const f = await northline();
    f.fake.failNextLocale = "sheet_not_shared";
    expect(await sync(f)).toEqual({ status: "failed", code: "sheet_not_shared" });
    expect(f.fake.reads).toBe(0);
    const [failed] = await eventsOf(f.firmId, "roster.sync_failed");
    expect(failed?.data).toEqual({ code: "sheet_not_shared" });
    const { rows } = await su.query(
      "select last_error_code, sync_started_at from roster_sources where firm_id = $1",
      [f.firmId],
    );
    expect(rows[0]).toEqual({ last_error_code: "sheet_not_shared", sync_started_at: null });
  });

  it("two syncs of one firm never overlap; a lease left by a crash expires", async () => {
    const f = await northline();
    await su.query("update roster_sources set sync_started_at = $2 where firm_id = $1", [
      f.firmId,
      NOW,
    ]);
    expect(await sync(f, new Date(NOW.getTime() + 60_000))).toEqual({ status: "busy" });
    expect(f.fake.reads).toBe(0);
    expect((await sync(f, new Date(NOW.getTime() + SYNC_LEASE_MS + 1000))).status).toBe("synced");
  });

  it("a firm with no enabled sheet has nothing to sync", async () => {
    const f = await northline();
    await su.query("update roster_sources set enabled = false where firm_id = $1", [f.firmId]);
    expect(await sync(f)).toEqual({ status: "no_source" });
    expect(f.fake.reads).toBe(0);
  });

  it("syncing one firm never touches another firm's rows, even with the same staff and shift ids", async () => {
    const a = await northline();
    const b = await northline();
    await sync(b);
    const before = await su.query("select count(*)::int as n from assignments where firm_id = $1", [
      b.firmId,
    ]);
    a.fake.setCell(a.sheetId, SHIFTS, 2, "Assigned", "N002, N003");
    await sync(a);
    const after = await su.query("select count(*)::int as n from assignments where firm_id = $1", [
      b.firmId,
    ]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(await holdersOf(b.firmId, "P1")).toEqual(["N001"]);
    expect(await holdersOf(a.firmId, "P1")).toEqual(["N002", "N003"]);
  });
});

// Found by the guardrails review: edits and bookings that must not be lost, history that must
// not be rewritten, and changes that must be logged.
describe("sheets.sync: the office and the portal at the same time", () => {
  it("an office edit made between our read and our write is not overwritten; the next sync merges it", async () => {
    const f = await sheetFirm([ADA, BEN, CAL].map(staffRow), [shiftRow({ ...P1, needed: "3" })]);
    await sync(f);
    await book(
      f.firmId,
      await idOf("shifts", f.firmId, "P1"),
      await idOf("workers", f.firmId, "N002"),
    );
    const readsBefore = f.fake.reads;
    f.fake.beforeRead = (n) => {
      if (n === readsBefore + 2) f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N001, N003");
    };
    expect(await sync(f)).toMatchObject({ writes: 0, skippedWrites: 1 });
    expect(f.fake.cell(f.sheetId, SHIFTS, 2, "Assigned")).toBe("N001, N003");
    f.fake.beforeRead = null;
    expect(await sync(f)).toMatchObject({ booked: 1, writes: 1 });
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N001", "N002", "N003"]);
    expect(f.fake.cell(f.sheetId, SHIFTS, 2, "Assigned")).toBe("N001, N002, N003");
  });

  it("after a failed write, a name the office adds back is booked again, not dropped", async () => {
    const f = await northline();
    await sync(f); // P1: N001
    const shiftId = await idOf("shifts", f.firmId, "P1");
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", ""); // office: N001 out
    await book(f.firmId, shiftId, await idOf("workers", f.firmId, "N002")); // portal: N002 in
    f.fake.failNextWrite = "sheets_unavailable";
    expect(await sync(f)).toEqual({ status: "failed", code: "sheets_unavailable" });
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N002"]);
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N001"); // office: N001 back
    expect(await sync(f)).toMatchObject({ status: "synced", booked: 1, writes: 1 });
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N001", "N002"]);
    expect(f.fake.cell(f.sheetId, SHIFTS, 2, "Assigned")).toBe("N001, N002");
  });

  it("a shift someone with no staff id booked here is reported, not silently frozen", async () => {
    const f = await northline();
    await sync(f);
    const local = await one(
      "insert into workers (firm_id, first_name, last_name, mobile_e164) values ($1, 'Local', 'Only', '+447700900399')",
      [f.firmId],
    );
    await book(f.firmId, await idOf("shifts", f.firmId, "P1"), local);
    const outcome = await sync(f);
    expect(outcome).toMatchObject({ status: "synced", writes: 0 });
    if (outcome.status !== "synced") return;
    expect(outcome.problems).toEqual([{ tab: "shifts", row: 2, problem: "holder_not_in_sheet" }]);
    const [clash] = await eventsOf(f.firmId, "roster.sheet_conflict");
    expect(clash?.data).toEqual({ source: "sheets", holderNotInSheet: true });
    const { rows } = await su.query(
      "select status from shifts where firm_id = $1 and external_ref = 'P1'",
      [f.firmId],
    );
    expect(rows[0]?.status).toBe("filled"); // the recompute still ran: 2 of 2 held
  });
});

describe("sheets.sync: history is never rewritten", () => {
  const PAST: ShiftCells = {
    ref: "OLD",
    date: "01/03/2026",
    start: "09:00",
    end: "17:00",
    role: "coss",
    assigned: "N001",
  };

  it("a first sync doesn't book names on shifts that have already started", async () => {
    const f = await sheetFirm([ADA].map(staffRow), [shiftRow(PAST)]);
    expect(await sync(f)).toMatchObject({ status: "synced", shifts: 1, booked: 0, writes: 0 });
    expect(await holdersOf(f.firmId, "OLD")).toEqual([]);
    const { rows } = await su.query("select synced_holders from shifts where firm_id = $1", [
      f.firmId,
    ]);
    expect(rows[0]?.synced_holders).toEqual(["N001"]);
  });

  it("removing a name from a started shift cancels nothing and logs no notice", async () => {
    const f = await northline();
    await sync(f); // P1 (Sat 22:00) booked for N001
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "");
    const afterStart = new Date("2026-11-07T23:00:00Z");
    expect(await sync(f, afterStart)).toMatchObject({ cancelled: 0, writes: 0 });
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N001"]);
    expect(await eventsOf(f.firmId, "shift.cancelled")).toEqual([]);
  });
});

describe("sheets.sync: every change is logged, and the sheet can't unblock or hijack a login", () => {
  it("new shifts, changed fields and status changes each get an event", async () => {
    const f = await northline();
    await sync(f);
    expect(await eventsOf(f.firmId, "shift.created")).toHaveLength(2);
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Needed", "3");
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Role", "COSS");
    await sync(f);
    const [changed] = await eventsOf(f.firmId, "shift.changed");
    expect(changed?.data).toEqual({ source: "sheets", fields: ["role", "headcount"] });
    f.fake.setCell(f.sheetId, SHIFTS, 3, "Status", "Cancelled"); // P2, nobody booked
    await sync(f);
    const [status] = await eventsOf(f.firmId, "shift.status_changed");
    expect(status?.data).toEqual({ source: "sheets", from: "open", to: "cancelled" });
  });

  it("a new mobile in the sheet is logged by field name and signs the worker out everywhere", async () => {
    const f = await northline();
    await sync(f);
    const ada = await idOf("workers", f.firmId, "N001");
    await su.query(
      `insert into sessions (firm_id, kind, worker_id, token_hash, expires_at, rotated_at)
       values ($1, 'worker', $2, $3, $4, now())`,
      // Live at the sync's own clock (NOW): an expired session is dead already, so not counted.
      [f.firmId, ada, randomBytes(32), new Date(NOW.getTime() + 86_400_000)],
    );
    f.fake.setCell(f.sheetId, "Staff", 2, "Mobile", "07700 900388");
    await sync(f);
    const [updated] = await eventsOf(f.firmId, "worker.updated");
    expect(updated).toEqual({
      data: { source: "sheets", fields: ["mobileE164"], sessionsRevoked: 1 },
      entity_id: ada,
    });
    expect(JSON.stringify(updated)).not.toContain("900388");
    const { rows } = await su.query(
      "select count(*)::int as live from sessions where worker_id = $1 and revoked_at is null",
      [ada],
    );
    expect(rows[0]?.live).toBe(0);
  });

  it("a worker blocked here stays blocked whatever the sheet says", async () => {
    const f = await northline();
    await sync(f);
    const ada = await idOf("workers", f.firmId, "N001");
    await su.query("update workers set status = 'blocked' where id = $1", [ada]);
    f.fake.setCell(f.sheetId, "Staff", 2, "First name", "Adaline");
    await sync(f);
    const { rows } = await su.query("select first_name, status from workers where id = $1", [ada]);
    expect(rows[0]).toEqual({ first_name: "Adaline", status: "blocked" });
    const [updated] = await eventsOf(f.firmId, "worker.updated");
    expect(updated?.data).toEqual({ source: "sheets", fields: ["firstName"] });
  });
});

describe("sheets.sync: leases and failures", () => {
  it("a sync whose lease was taken over mid-way leaves the new holder's lease alone", async () => {
    const f = await northline();
    const stolen = new Date(NOW.getTime() + 1000);
    const run: typeof withFirm = async (firmId, fn) => {
      const result = await withFirm(firmId, fn);
      // After the claim (the first transaction), another sync takes over the lease.
      await su.query(
        "update roster_sources set sync_started_at = $2 where firm_id = $1 and sync_started_at = $3",
        [f.firmId, stolen, NOW],
      );
      return result;
    };
    const outcome = await syncSheet({ run, firmId: f.firmId, client: f.fake, clock: at(NOW) });
    expect(outcome).toEqual({ status: "busy" });
    const { rows } = await su.query(
      "select sync_started_at, last_synced_at, last_error_code from roster_sources where firm_id = $1",
      [f.firmId],
    );
    expect(rows[0]).toEqual({
      sync_started_at: stolen,
      last_synced_at: null,
      last_error_code: null,
    });
    expect(await holdersOf(f.firmId, "P1")).toEqual([]); // the mirror didn't run
  });

  it("the same failure again logs no new event; a different one does", async () => {
    const f = await northline();
    f.fake.failNextRead = "sheet_not_shared";
    await sync(f);
    f.fake.failNextRead = "sheet_not_shared";
    await sync(f, new Date(NOW.getTime() + 5 * 60_000));
    expect(await eventsOf(f.firmId, "roster.sync_failed")).toHaveLength(1);
    f.fake.failNextRead = "sheet_not_found";
    await sync(f, new Date(NOW.getTime() + 10 * 60_000));
    expect((await eventsOf(f.firmId, "roster.sync_failed")).map((e) => e.data)).toEqual([
      { code: "sheet_not_shared" },
      { code: "sheet_not_found" },
    ]);
    const { rows } = await su.query(
      "select last_attempted_at from roster_sources where firm_id = $1",
      [f.firmId],
    );
    expect(rows[0]?.last_attempted_at).toEqual(new Date(NOW.getTime() + 10 * 60_000));
  });
});

describe("sheets.sync: the rules decide who the sheet can book", () => {
  it("a name that fails a credential check isn't booked; the refusal is logged with the reasons", async () => {
    const f = await sheetFirm(
      [ADA, BEN, CAL].map(staffRow),
      [{ ...P1, assigned: "" }, P2].map(shiftRow),
    );
    await sync(f);
    // Track work now needs a PTS card; only Ben has one.
    await su.query(
      "update credential_rules set required_types = '{PTS}' where firm_id = $1 and role = 'track_operative'",
      [f.firmId],
    );
    const ada = await idOf("workers", f.firmId, "N001");
    const ben = await idOf("workers", f.firmId, "N002");
    await su.query(
      "insert into credentials (firm_id, worker_id, type, expires_on) values ($1, $2, 'PTS', '2028-01-01')",
      [f.firmId, ben],
    );
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N001, N002");
    expect(await sync(f)).toMatchObject({ booked: 1, notBooked: 1, writes: 0 });
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N002"]);
    const shiftId = await idOf("shifts", f.firmId, "P1");
    expect(await eventsOf(f.firmId, "roster.sheet_booking_refused")).toEqual([
      {
        entity_id: shiftId,
        data: { source: "sheets", workerId: ada, codes: ["credential_missing"] },
      },
    ]);
    // The office's name isn't erased from its own sheet (audit L12): the cell is as it typed it,
    // so nothing needs writing.
    expect(f.fake.cell(f.sheetId, SHIFTS, 2, "Assigned")).toBe("N001, N002");
    expect(await eventsOf(f.firmId, "shift.assigned")).toHaveLength(1);
    // The next sync tries Ada again (still refused) and says nothing new; once she has a PTS card,
    // the one after books her.
    expect(await sync(f, new Date(NOW.getTime() + 60_000))).toMatchObject({
      booked: 0,
      notBooked: 1,
    });
    expect(await eventsOf(f.firmId, "roster.sheet_booking_refused")).toHaveLength(1);
    await su.query(
      "insert into credentials (firm_id, worker_id, type, expires_on) values ($1, $2, 'PTS', '2028-01-01')",
      [f.firmId, ada],
    );
    expect(await sync(f, new Date(NOW.getTime() + 120_000))).toMatchObject({ booked: 1 });
    expect((await holdersOf(f.firmId, "P1")).sort()).toEqual(["N001", "N002"]);
  });

  it("the office's own rota may override rest and weekly hours, and the log says so", async () => {
    // Ada on Saturday night (22:00-06:00) and again Sunday 10:00: four hours' rest.
    const SUNDAY: ShiftCells = {
      ref: "P3",
      date: "08/11/2026",
      start: "10:00",
      end: "18:00",
      role: "Track Operative",
      assigned: "N001",
    };
    const f = await sheetFirm([ADA, BEN, CAL].map(staffRow), [P1, SUNDAY].map(shiftRow));
    expect(await sync(f)).toMatchObject({ booked: 2, notBooked: 0 });
    const sunday = await idOf("shifts", f.firmId, "P3");
    const { rows } = await su.query<{ data: Record<string, unknown> }>(
      `select e.data from events e join assignments a on a.id = e.entity_id
        where e.firm_id = $1 and e.action = 'shift.assigned' and a.shift_id = $2`,
      [f.firmId, sunday],
    );
    expect(rows.map((r) => r.data)).toEqual([
      {
        source: "sheets",
        by: "firm",
        shiftId: sunday,
        workerId: await idOf("workers", f.firmId, "N001"),
        slot: 1,
        noticeHours: 49, // Sunday 10:00 GMT is 49 hours after NOW (Friday 09:00)
        reason: "Put on the rota sheet by the office",
        overridden: ["rest"],
      },
    ]);
  });

  it("a double booking in the sheet is never overridden: the second shift isn't booked", async () => {
    const CLASH: ShiftCells = {
      ref: "P4",
      date: "07/11/2026",
      start: "23:00",
      end: "05:00",
      role: "Track Operative",
      assigned: "N001",
    };
    const f = await sheetFirm([ADA, BEN, CAL].map(staffRow), [P1, CLASH].map(shiftRow));
    expect(await sync(f)).toMatchObject({ booked: 1, notBooked: 1 });
    const [refused] = await eventsOf(f.firmId, "roster.sheet_booking_refused");
    expect(refused?.data).toMatchObject({ codes: ["overlap"] });
  });
});

describe("sheets.sync: failures in the booking step", () => {
  it("a firm with broken rules settings books no sheet names, but the rest of the sync goes through", async () => {
    const f = await sheetFirm([ADA, BEN, CAL].map(staffRow), [P1, P2].map(shiftRow));
    await sync(f);
    await su.query("update firms set settings = $1 where id = $2", [
      JSON.stringify({ weekly_hours_cap: "lots" }),
      f.firmId,
    ]);
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N002"); // Ada off, Ben on
    const later = new Date(NOW.getTime() + HOUR);
    expect(await sync(f, later)).toMatchObject({
      status: "synced",
      booked: 0,
      cancelled: 1,
      notBooked: 1,
    });
    expect(await holdersOf(f.firmId, "P1")).toEqual([]);
    const [refused] = await eventsOf(f.firmId, "roster.sheet_booking_refused");
    expect(refused?.data).toMatchObject({ codes: ["settings_invalid"] });
  });

  it("a deadlock in the sync's database step runs it again on the same read of the sheet", async () => {
    const f = await northline();
    // Calls: 1 claims the lease, 2 is the database step (aborted once here), then the retry, then
    // the final step.
    let calls = 0;
    const flaky: WithFirm = (firmId, fn) => {
      calls += 1;
      if (calls === 2) {
        return Promise.reject(Object.assign(new Error("deadlock detected"), { code: "40P01" }));
      }
      return withFirm(firmId, fn);
    };
    const outcome = await syncSheet({
      run: flaky,
      firmId: f.firmId,
      client: f.fake,
      clock: at(NOW),
    });
    expect(outcome).toMatchObject({ status: "synced", booked: 1 });
    expect(calls).toBe(4);
    expect(f.fake.reads).toBe(1);
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N001"]);
    expect(await eventsOf(f.firmId, "roster.sync_failed")).toEqual([]);
  });
});

describe("offers on a sheet shift (src/lib/offers/close.ts)", () => {
  it("a name the sheet adds takes their offer; the sheet filling the shift closes the rest, once", async () => {
    const f = await sheetFirm([ADA, BEN, CAL].map(staffRow), [shiftRow({ ...P1, assigned: "" })]);
    expect(await sync(f)).toMatchObject({ status: "synced" });
    const shiftId = await idOf("shifts", f.firmId, "P1");
    const [ada, ben, cal] = (await Promise.all(
      ["N001", "N002", "N003"].map((ref) => idOf("workers", f.firmId, ref)),
    )) as [string, string, string];
    // An urgent wave offered it to all three.
    for (const w of [ada, ben, cal]) {
      await su.query(
        `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
         values ($1, $2, $3, 1, 'whatsapp', $4)`,
        [f.firmId, shiftId, w, NOW],
      );
    }
    const responses = async () =>
      Object.fromEntries(
        (
          await su.query<{ worker_id: string; response: string | null }>(
            "select worker_id::text, response from offers where shift_id = $1",
            [shiftId],
          )
        ).rows.map((r) => [r.worker_id, r.response]),
      );

    // The office writes Ada's name in: 1 of 2 places, her offer taken, the others still waiting.
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N001");
    expect(await sync(f)).toMatchObject({ status: "synced" });
    expect(await responses()).toEqual({ [ada]: "accepted", [ben]: null, [cal]: null });
    expect(await eventsOf(f.firmId, "offer.closed")).toEqual([]);

    // Then Ben's: full. Ben's taken, Cal's filled by someone else.
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N001, N002");
    expect(await sync(f)).toMatchObject({ status: "synced" });
    expect(await responses()).toEqual({
      [ada]: "accepted",
      [ben]: "accepted",
      [cal]: "filled_elsewhere",
    });
    expect((await eventsOf(f.firmId, "offer.closed")).map((e) => e.data)).toEqual([
      { reason: "filled", accepted: 0, filledElsewhere: 1 },
    ]);
    // Another sync with nothing changed closes nothing more.
    expect(await sync(f)).toMatchObject({ status: "synced" });
    expect(await eventsOf(f.firmId, "offer.closed")).toHaveLength(1);
  });
});

describe("sheets.sync: a booked or started shift follows the office editor's rules (audit M1, M2)", () => {
  const shiftRow2 = async (f: SheetFirm) => {
    const { rows } = await su.query<{
      role: string;
      starts_at: Date;
      ends_at: Date;
      site_id: string | null;
      status: string;
    }>("select role, starts_at, ends_at, site_id, status from shifts where id = $1", [
      await idOf("shifts", f.firmId, "P1"),
    ]);
    return rows[0];
  };

  it("a role Ada can't do isn't made: our copy keeps its role, the office is told once", async () => {
    const f = await northline();
    await sync(f); // Ada booked on P1 (Track Operative)
    const ada = await idOf("workers", f.firmId, "N001");
    const shiftId = await idOf("shifts", f.firmId, "P1");
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Role", "Steward");
    const outcome = await sync(f);
    expect(outcome).toMatchObject({ status: "synced" });
    expect(outcome.status === "synced" && outcome.problems).toContainEqual({
      tab: "shifts",
      row: 2,
      problem: "change_refused",
    });
    expect((await shiftRow2(f))?.role).toBe("track_operative");
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N001"]);
    expect(await eventsOf(f.firmId, "roster.sheet_change_refused")).toEqual([
      {
        entity_id: shiftId,
        data: {
          source: "sheets",
          fields: ["role"],
          wanted: { role: "steward" },
          reason: "rules",
          workers: [{ workerId: ada, codes: ["wrong_role"] }],
        },
      },
    ]);
    // The next sync sees the same sheet: still not made, nothing new logged, and the shift's row
    // isn't rewritten (what Today shows is unchanged).
    const version = async () =>
      (await su.query<{ v: string }>("select xmin::text as v from shifts where id = $1", [shiftId]))
        .rows[0]?.v;
    const before = await version();
    await sync(f, new Date(NOW.getTime() + 60_000));
    expect(await eventsOf(f.firmId, "roster.sheet_change_refused")).toHaveLength(1);
    expect(await version()).toBe(before);
    // Ada's own log (and her data download) includes it: she's named in it.
    const hers = await withFirm(f.firmId, (tx) =>
      tx.execute<{ action: string }>(
        sql`select e.action from events e where ${eventsAboutWorker(ada)} order by e.id`,
      ),
    );
    expect(hers.rows.map((r) => r.action)).toContain("roster.sheet_change_refused");
    // A role she can do (COSS) is made.
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Role", "COSS");
    await sync(f, new Date(NOW.getTime() + 120_000));
    expect((await shiftRow2(f))?.role).toBe("coss");
  });

  it("Today shows what the sheet asks for that wasn't done, until it's true again", async () => {
    const f = await northline();
    await sync(f);
    await su.query(
      "update credential_rules set required_types = '{PTS}' where firm_id = $1 and role = 'track_operative'",
      [f.firmId],
    );
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Role", "Steward"); // Ada isn't a steward
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N001, N002"); // Ben has no PTS card
    await sync(f);
    const today = () => withFirm(f.firmId, async (tx) => (await loadToday(tx, NOW)).fromSheet);
    expect(await today()).toEqual([
      expect.objectContaining({
        change: {
          fields: ["role"],
          reason: "rules",
          people: [{ name: "Ada Example", codes: ["wrong_role"] }],
        },
        names: [{ name: "Ben Example", codes: ["credential_missing"], dropped: false }],
      }),
    ]);
    // The office puts the role back and takes Ben out: nothing left to show.
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Role", "Track Operative");
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N001");
    await sync(f, new Date(NOW.getTime() + 60_000));
    expect(await today()).toEqual([]);
  });

  it("new times past a licence's expiry aren't made; times within it are, logged per worker", async () => {
    const f = await northline();
    await sync(f);
    const ada = await idOf("workers", f.firmId, "N001");
    // Track work now needs a PTS card; Ada's runs to Sunday 8 November (Saturday night is fine).
    await su.query(
      "update credential_rules set required_types = '{PTS}' where firm_id = $1 and role = 'track_operative'",
      [f.firmId],
    );
    await su.query(
      "insert into credentials (firm_id, worker_id, type, expires_on) values ($1, $2, 'PTS', '2026-11-08')",
      [f.firmId, ada],
    );
    // Sunday night instead: it runs into Monday 9th, past her card.
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Date", "08/11/2026");
    await sync(f);
    expect((await shiftRow2(f))?.starts_at).toEqual(new Date("2026-11-07T22:00:00Z"));
    expect(await eventsOf(f.firmId, "shift.moved")).toEqual([]);
    expect((await eventsOf(f.firmId, "roster.sheet_change_refused"))[0]?.data).toMatchObject({
      fields: ["startsAt", "endsAt"],
      reason: "rules",
      workers: [{ workerId: ada, codes: ["credential_expired"] }],
    });
    // Back to Saturday, an hour earlier: made, and logged for Ada with its notice.
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Date", "07/11/2026");
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Start", "21:00");
    await sync(f, new Date(NOW.getTime() + 60_000));
    expect((await shiftRow2(f))?.starts_at).toEqual(new Date("2026-11-07T21:00:00Z"));
    expect((await eventsOf(f.firmId, "shift.moved")).map((e) => e.data.workerId)).toEqual([ada]);
  });

  it("a site change on a booked shift is logged per worker, with the old and new site and notice", async () => {
    const f = await northline();
    await sync(f);
    const before = (await shiftRow2(f))?.site_id;
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Site", "Other Yard");
    await sync(f);
    const after = (await shiftRow2(f))?.site_id;
    expect(after).not.toBe(before);
    const [moved] = await eventsOf(f.firmId, "shift.moved");
    expect(moved?.data).toMatchObject({
      by: "firm",
      reason: SITE_CHANGED_ON_SHEET,
      oldSiteId: before,
      newSiteId: after,
      noticeHours: 37,
      rulesOk: true,
    });
  });

  it("a started shift is never re-timed or cancelled by a sync; the office is told", async () => {
    const f = await northline();
    await sync(f); // Ada booked on P1, Saturday 22:00
    const started = new Date("2026-11-07T23:00:00Z");
    f.fake.setCell(f.sheetId, SHIFTS, 2, "End", "02:00"); // sending them home early, in the sheet
    const outcome = await sync(f, started);
    expect(outcome.status === "synced" && outcome.problems).toContainEqual({
      tab: "shifts",
      row: 2,
      problem: "started_change",
    });
    expect((await shiftRow2(f))?.ends_at).toEqual(new Date("2026-11-08T06:00:00Z"));
    expect(await eventsOf(f.firmId, "shift.curtailed")).toEqual([]);
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Status", "Cancelled");
    await sync(f, new Date(started.getTime() + 60_000));
    expect((await shiftRow2(f))?.status).not.toBe("cancelled");
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N001"]);
    expect(
      (await eventsOf(f.firmId, "roster.sheet_change_refused")).map((e) => [
        e.data.fields,
        e.data.reason,
      ]),
    ).toEqual([
      [["endsAt"], "started"],
      // The next sync: the finish still refused, and now the status too (one entry each time what
      // the office is told changes).
      [["endsAt", "status"], "started"],
    ]);
  });

  it("a booked shift moved into the past in the sheet isn't moved (it would have started)", async () => {
    const f = await northline();
    await sync(f);
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Date", "05/11/2026"); // last Thursday
    await sync(f);
    expect((await shiftRow2(f))?.starts_at).toEqual(new Date("2026-11-07T22:00:00Z"));
    expect((await eventsOf(f.firmId, "roster.sheet_change_refused"))[0]?.data).toMatchObject({
      reason: "in_past",
    });
  });

  it("a refused name doesn't use up a place: the next name in the sheet gets it", async () => {
    const DEE: StaffCells = {
      ref: "N004",
      first: "Dee",
      last: "Example",
      mobile: "07700 900304",
      roles: "track_operative",
    };
    const f = await sheetFirm(
      [ADA, BEN, CAL, DEE].map(staffRow),
      [{ ...P1, needed: "3" }, P2].map(shiftRow),
    );
    await sync(f); // P1 needs 3: Ada booked
    const shiftId = await idOf("shifts", f.firmId, "P1");
    await book(f.firmId, shiftId, await idOf("workers", f.firmId, "N002")); // Ben, in the portal
    await su.query(
      "update credential_rules set required_types = '{PTS}' where firm_id = $1 and role = 'track_operative'",
      [f.firmId],
    );
    const cal = await idOf("workers", f.firmId, "N003");
    await su.query(
      "insert into credentials (firm_id, worker_id, type, expires_on) values ($1, $2, 'PTS', '2028-01-01')",
      [f.firmId, cal],
    );
    // One place left. Dee (no PTS card) is first in the cell, then Cal.
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N001, N004, N003");
    expect(await sync(f)).toMatchObject({ booked: 1, notBooked: 1 });
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N001", "N002", "N003"]);
    // Full now: the cell names the three booked (Dee is on Today and in the log).
    expect(f.fake.cell(f.sheetId, SHIFTS, 2, "Assigned")).toBe("N001, N002, N003");
    const today = () => withFirm(f.firmId, async (tx) => (await loadToday(tx, NOW)).fromSheet);
    expect((await today())[0]?.names).toEqual([
      { name: "Dee Example", codes: ["credential_missing"], dropped: true },
    ]);
    // Still there after the next sync (she's no longer in the sheet, and still not booked).
    await sync(f, new Date(NOW.getTime() + 60_000));
    expect((await today())[0]?.names).toEqual([
      { name: "Dee Example", codes: ["credential_missing"], dropped: true },
    ]);
  });

  it("a refused name stays in the sheet while there's room, and is tried again at each sync", async () => {
    const f = await northline();
    await sync(f); // P1 needs 2: Ada booked
    await su.query(
      "update credential_rules set required_types = '{PTS}' where firm_id = $1 and role = 'track_operative'",
      [f.firmId],
    );
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N001, N002"); // Ben: no PTS card
    expect(await sync(f)).toMatchObject({ booked: 0, notBooked: 1, writes: 0 });
    expect(f.fake.cell(f.sheetId, SHIFTS, 2, "Assigned")).toBe("N001, N002");
    await sync(f, new Date(NOW.getTime() + 60_000));
    expect(await eventsOf(f.firmId, "roster.sheet_booking_refused")).toHaveLength(1);
    expect(await eventsOf(f.firmId, "roster.sheet_conflict")).toHaveLength(1);
  });
});

describe("sheets.sync: one edit, several changes, in the right order", () => {
  const DEE: StaffCells = {
    ref: "N004",
    first: "Dee",
    last: "Example",
    mobile: "07700 900304",
    roles: "Steward",
  };
  const firmWithDee = () => sheetFirm([ADA, BEN, CAL, DEE].map(staffRow), [P1, P2].map(shiftRow));
  const p1 = async (f: SheetFirm) =>
    (
      await su.query<{ role: string; starts_at: Date; headcount: number; status: string }>(
        "select role, starts_at, headcount, status from shifts where id = $1",
        [await idOf("shifts", f.firmId, "P1")],
      )
    ).rows[0];

  it("broken rules settings: the rest of the sync still goes through; a booked shift's change waits", async () => {
    const f = await northline();
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N001, N002");
    await sync(f); // Ada and Ben booked
    await su.query(
      `update firms set settings = settings || '{"min_rest_hours": -5}' where id = $1`,
      [f.firmId],
    );
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N001"); // Ben off
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Start", "21:00");
    expect(await sync(f)).toMatchObject({ status: "synced", cancelled: 1 });
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N001"]);
    expect((await p1(f))?.starts_at).toEqual(new Date("2026-11-07T22:00:00Z"));
    expect((await eventsOf(f.firmId, "roster.sheet_change_refused"))[0]?.data).toMatchObject({
      reason: "settings",
    });
  });

  it("a person swapped out in the same edit as a new role doesn't block it", async () => {
    const f = await firmWithDee();
    await sync(f); // Ada (no steward role) booked
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Role", "Steward");
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N004"); // Ada out, Dee (a steward) in
    expect(await sync(f)).toMatchObject({ booked: 1, cancelled: 1 });
    expect((await p1(f))?.role).toBe("steward");
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N004"]);
    expect(await eventsOf(f.firmId, "roster.sheet_change_refused")).toEqual([]);
    expect(await eventsOf(f.firmId, "roster.sheet_booking_refused")).toEqual([]);
  });

  it("more places and a new name in one edit: the name is booked at once", async () => {
    const f = await northline();
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N001, N002");
    await sync(f); // P1 full (2 of 2)
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Needed", "3");
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Assigned", "N001, N002, N003");
    expect(await sync(f)).toMatchObject({ booked: 1, notBooked: 0 });
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N001", "N002", "N003"]);
    expect(await eventsOf(f.firmId, "roster.sheet_booking_refused")).toEqual([]);
  });

  it("cancelled and moved in one edit: notice from the start the worker knew", async () => {
    const f = await northline();
    await sync(f); // Ada on Saturday 22:00, 37 hours away
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Date", "14/11/2026");
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Status", "Cancelled");
    expect(await sync(f)).toMatchObject({ cancelled: 1 });
    const [cancelled] = await eventsOf(f.firmId, "shift.cancelled");
    expect(cancelled?.data).toMatchObject({ noticeHours: 37, reason: CANCELLED_ON_SHEET });
    expect(await eventsOf(f.firmId, "shift.moved")).toEqual([]);
  });

  it("a draft row's planned names are booked when it's published, not erased", async () => {
    const f = await northline();
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Status", "Draft");
    await sync(f); // P1 a draft: Ada planned, not booked
    expect(await holdersOf(f.firmId, "P1")).toEqual([]);
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Status", "");
    expect(await sync(f, new Date(NOW.getTime() + 60_000))).toMatchObject({ booked: 1 });
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N001"]);
    expect(f.fake.cell(f.sheetId, SHIFTS, 2, "Assigned")).toBe("N001");
  });

  it("a change the sheet's own overrides let through is recorded with the rules' answer", async () => {
    const f = await northline();
    await sync(f); // Ada, Saturday night
    const ada = await idOf("workers", f.firmId, "N001");
    await su.query(
      "insert into worker_unavailable_days (firm_id, worker_id, day) values ($1, $2, '2026-11-09')",
      [f.firmId, ada],
    );
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Date", "08/11/2026"); // Sunday night: into her day off
    await sync(f);
    expect((await p1(f))?.starts_at).toEqual(new Date("2026-11-08T22:00:00Z"));
    const [moved] = await eventsOf(f.firmId, "shift.moved");
    expect(moved?.data).toMatchObject({ workerId: ada, rulesOk: false, codes: ["unavailable"] });
  });

  it("a refused change still lets the rest of the row through (more places)", async () => {
    const f = await northline();
    await sync(f);
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Role", "Steward"); // Ada isn't one: refused
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Needed", "3");
    await sync(f);
    expect(await p1(f)).toMatchObject({ role: "track_operative", headcount: 3 });
  });
});

describe("sheets.sync: events and a session's own details (12B.1)", () => {
  const eventOf = async (firmId: string, ref: string) =>
    (
      await su.query<{ id: string; name: string; key: string | null; source: string }>(
        `select e.id::text as id, e.name, e.planner_ref as key, e.source
           from shifts s join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
          where s.firm_id = $1 and s.external_ref = $2`,
        [firmId, ref],
      )
    ).rows[0];
  const eventCount = async (firmId: string) =>
    (
      await su.query<{ n: number }>(
        "select count(*)::int as n from shift_events where firm_id = $1",
        [firmId],
      )
    ).rows[0]?.n;

  it("each new row joins its site and day's automatic event, shared by the rows on that site and day", async () => {
    const f = await northline();
    await sync(f);
    const p1 = await eventOf(f.firmId, "P1");
    expect(p1).toMatchObject({
      name: automaticEventName("Demo Junction", "2026-11-07"),
      key: expect.stringMatching(/^auto:[0-9a-f-]{36}:2026-11-07$/),
      source: "sheets",
    });
    expect(p1?.name).toBe("Demo Junction · Sat 7 Nov");
    // P2 has no site: the day alone.
    expect(await eventOf(f.firmId, "P2")).toMatchObject({
      name: automaticEventName(null, "2027-06-14"),
      key: "auto:none:2027-06-14",
    });
    // A row added later on P1's site and day joins P1's event; syncing again makes none.
    f.fake
      .tab(f.sheetId, SHIFTS)
      .push(shiftRow({ ...P1, ref: "P3", start: "08:00", end: "16:00", assigned: "" }));
    await sync(f, new Date(NOW.getTime() + 60_000));
    expect((await eventOf(f.firmId, "P3"))?.id).toBe(p1?.id);
    await sync(f, new Date(NOW.getTime() + 120_000));
    expect(await eventCount(f.firmId)).toBe(2);
  });

  it("never changes a switch, a session detail or the event, whatever changes on the sheet", async () => {
    const f = await northline();
    await sync(f);
    const before = await eventOf(f.firmId, "P2");
    const p2 = await idOf("shifts", f.firmId, "P2");
    const details = {
      pay_rate_pence: 1450,
      post: "Gate B",
      meeting_point: "Staff car park",
      uniform: "Hi-vis and boots",
      required_credentials: ["PTS"],
      showing_to_casuals: false,
    };
    await su.query(
      `update shifts set pay_rate_pence = $2, post = $3, meeting_point = $4, uniform = $5,
              required_credentials = $6, showing_to_casuals = $7 where id = $1`,
      [p2, ...Object.values(details)],
    );
    await su.query("update shift_events set showing_to_casuals = false where id = $1", [
      before?.id,
    ]);
    // Every rota field of the row changes: date, times, site, role, places, instructions.
    for (const [header, value] of [
      ["Date", "15/06/2027"],
      ["Start", "10:00"],
      ["End", "18:00"],
      ["Site", "Demo Depot"],
      ["Role", "track operative"],
      ["Needed", "3"],
      ["Instructions", "Bring a torch."],
    ] as const) {
      f.fake.setCell(f.sheetId, SHIFTS, 3, header, value);
    }
    await sync(f, new Date(NOW.getTime() + 60_000));
    const { rows } = await su.query(
      `select s.pay_rate_pence, s.post, s.meeting_point, s.uniform, s.required_credentials,
              s.showing_to_casuals, s.role, s.headcount, s.instructions,
              e.showing_to_casuals as event_showing, s.event_id::text as event_id
         from shifts s join shift_events e on e.id = s.event_id where s.id = $1`,
      [p2],
    );
    // The sync applied the rota changes (the control) ...
    expect(rows[0]).toMatchObject({
      role: "track_operative",
      headcount: 3,
      instructions: "Bring a torch.",
    });
    // ... and left ShiftDesk's own fields, both switches and the event as they were.
    expect(rows[0]).toMatchObject({ ...details, event_showing: false, event_id: before?.id });
  });
});

describe("sheets.sync: travel estimates (12G.2)", () => {
  const travelJobs = async (firmId: string) =>
    (
      await su.query<{ id: string; data: { shiftIds?: string[] } }>(
        `select id::text, data from pgboss.job
          where name = 'travel.estimates' and data ->> 'firmId' = $1 order by created_on, id`,
        [firmId],
      )
    ).rows;

  it("a new session gets its estimates without waiting for the nightly run", async () => {
    const f = await sheetFirm([ADA].map(staffRow), [P1].map(shiftRow));
    // The sheet's site was placed on Settings already.
    const point = fakePoint("ZZ1 1AA");
    await su.query(
      `insert into sites (firm_id, name, postcode, lat, lng)
       values ($1, 'Demo Junction', 'ZZ1 1AA', $2, $3)`,
      [f.firmId, point?.lat, point?.lng],
    );
    await sync(f);
    const shiftId = await idOf("shifts", f.firmId, "P1");
    const ada = await idOf("workers", f.firmId, "N001");
    const home = fakePoint("ZZ2 2BB");
    await su.query(
      `insert into worker_travel (firm_id, worker_id, start_postcode, lat, lng, modes,
                                  max_minutes, privacy_notice_version, updated_at)
       values ($1, $2, 'ZZ2 2BB', $3, $4, 'both', 45, 'travel-v1', now())`,
      [f.firmId, ada, home?.lat, home?.lng],
    );
    // The sync queued the travel job with the new session, in its own transaction.
    const jobs = await travelJobs(f.firmId);
    expect(jobs.map((j) => j.data.shiftIds)).toEqual([[shiftId]]);
    // The worker runs it: the session has both ways' estimates from Ada's postcode.
    const task = createTravelEstimatesTask(() => ({
      provider: fakeTravelProvider,
      clock: at(NOW),
    }));
    const [job] = jobs;
    expect((await runFirmTask(task, { id: job?.id ?? "", data: job?.data }, withFirm)).status).toBe(
      "completed",
    );
    const { rows } = await su.query<{ mode: string }>(
      "select mode from travel_estimates where firm_id = $1 order by mode",
      [f.firmId],
    );
    expect(rows.map((r) => r.mode)).toEqual(["car", "public_transport"]);

    // A sync that changes nothing queues nothing; a new time queues it again.
    await sync(f);
    expect(await travelJobs(f.firmId)).toHaveLength(1);
    f.fake.tab(f.sheetId, SHIFTS).splice(1, 1, shiftRow({ ...P1, start: "21:00" }));
    await sync(f);
    expect((await travelJobs(f.firmId)).map((j) => j.data.shiftIds)).toEqual([
      [shiftId],
      [shiftId],
    ]);
  });

  it("a draft or cancelled session needs none; back to open, it gets them", async () => {
    const f = await sheetFirm([ADA].map(staffRow), [{ ...P1, status: "Draft" }].map(shiftRow));
    await sync(f);
    const shiftId = await idOf("shifts", f.firmId, "P1");
    expect(await travelJobs(f.firmId)).toEqual([]);
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Status", "");
    await sync(f);
    expect((await travelJobs(f.firmId)).map((j) => j.data.shiftIds)).toEqual([[shiftId]]);
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Status", "Cancelled");
    await sync(f);
    expect(await travelJobs(f.firmId)).toHaveLength(1);
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Status", "");
    await sync(f);
    expect((await travelJobs(f.firmId)).map((j) => j.data.shiftIds)).toEqual([
      [shiftId],
      [shiftId],
    ]);
  });
});
