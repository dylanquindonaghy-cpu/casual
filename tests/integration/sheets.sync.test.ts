import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { sheetsRosterPlug } from "@/lib/roster/native";
import type { RosterPlug } from "@/lib/roster/plug";
import { DEFAULT_SHEET_MAPPING } from "@/lib/roster/sheets/mapping";
import {
  CANCELLED_ON_SHEET,
  CHANGED_ON_SHEET,
  REMOVED_ON_SHEET,
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
    const [event] = await eventsOf(f.firmId, "shift.cancelled");
    expect(event?.data).toEqual({
      source: "sheets",
      by: "firm",
      shiftId: await idOf("shifts", f.firmId, "P1"),
      workerId: await idOf("workers", f.firmId, "N001"),
      reason: REMOVED_ON_SHEET,
      noticeHours: 35,
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
      reason: CHANGED_ON_SHEET,
      oldStartsAt: "2026-11-07T22:00:00.000Z",
      oldEndsAt: "2026-11-08T06:00:00.000Z",
      newStartsAt: "2026-11-07T22:00:00.000Z",
      newEndsAt: "2026-11-08T04:00:00.000Z",
      noticeHours: 37,
    });
    f.fake.setCell(f.sheetId, SHIFTS, 2, "Start", "21:00"); // starts earlier: a move
    await sync(f);
    expect(await eventsOf(f.firmId, "shift.moved")).toHaveLength(1);
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
    await su.query(
      "insert into workers (firm_id, first_name, last_name, mobile_e164) values ($1, 'Ada', 'Imported', '+447700900301')",
      [f.firmId],
    );
    await sync(f);
    const { rows } = await su.query(
      "select external_ref, last_name from workers where firm_id = $1 and mobile_e164 = '+447700900301'",
      [f.firmId],
    );
    expect(rows).toEqual([{ external_ref: "N001", last_name: "Example" }]);
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
    expect(f.fake.cell(f.sheetId, SHIFTS, 2, "Assigned")).toBe("N001, N002");
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
      [f.firmId, ada, randomBytes(32), new Date(Date.now() + 86_400_000)],
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
    expect(await sync(f)).toMatchObject({ booked: 1, notBooked: 1, writes: 1 });
    expect(await holdersOf(f.firmId, "P1")).toEqual(["N002"]);
    const shiftId = await idOf("shifts", f.firmId, "P1");
    expect(await eventsOf(f.firmId, "roster.sheet_booking_refused")).toEqual([
      {
        entity_id: shiftId,
        data: { source: "sheets", workerId: ada, codes: ["credential_missing"] },
      },
    ]);
    // As with a name added to a full shift, the sheet is put back in step with the bookings.
    expect(f.fake.cell(f.sheetId, SHIFTS, 2, "Assigned")).toBe("N002");
    expect(await eventsOf(f.firmId, "shift.assigned")).toHaveLength(1);
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
