import ExcelJS from "exceljs";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { resolveColumns } from "@/lib/imports/columns";
import { ImportFileError } from "@/lib/imports/errors";
import { runImport, type ImportResult } from "@/lib/imports/import";
import { closeShift } from "@/lib/roster/close";
import { readTable } from "@/lib/imports/table";
import type { ImportKind } from "@/lib/imports/columns";
import { appRolePool, superuserPool, uniqueSlug } from "../helpers/db";

// CSV and Excel imports of workers, credentials and shifts, on the real database as the app role,
// each inside the firm's own withFirm transaction.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
const NOW = new Date("2026-11-06T09:00:00Z");

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

async function one(text: string, values: unknown[]): Promise<string> {
  const { rows } = await su.query<{ id: string }>(`${text} returning id::text as id`, values);
  const id = rows[0]?.id;
  if (!id) throw new Error(`insert returned no id: ${text}`);
  return id;
}

async function newFirm() {
  const slug = uniqueSlug("i");
  const firmId = await one("insert into firms (name, slug, sector) values ($1, $2, 'security')", [
    `Import Test ${slug}`,
    slug,
  ]);
  const officeId = await one(
    "insert into office_users (firm_id, email, name, role) values ($1, $2, 'Importer', 'resourcer')",
    [firmId, `${slug}@example.com`],
  );
  const run = (
    kind: ImportKind,
    rows: string[][],
    dryRun = false,
    now = NOW,
  ): Promise<ImportResult> =>
    withFirm(firmId, (tx) =>
      runImport(tx, { kind, rows, dryRun, actorId: officeId, timeZone: "Europe/London", now }),
    );
  return { firmId, officeId, run };
}

const csv = (text: string) => readTable(new TextEncoder().encode(text));

const workerByMobile = async (firmId: string, mobile: string) => {
  const { rows } = await su.query<{ id: string }>(
    "select id::text as id from workers where firm_id = $1 and mobile_e164 = $2",
    [firmId, mobile],
  );
  if (!rows[0]) throw new Error(`no worker with ${mobile}`);
  return rows[0].id;
};

const eventsOf = async (firmId: string, action: string) =>
  (
    await su.query<{ data: Record<string, unknown>; actor_type: string; actor_id: string }>(
      "select data, actor_type, actor_id::text from events where firm_id = $1 and action = $2 order by id",
      [firmId, action],
    )
  ).rows;

const WORKERS = `Staff ID,Forename,Surname,Phone number,Job roles,Email
S1,Ada,Example,07700 900301,"Door Supervisor, steward",ada@example.com
S2,Ben,Example,+44 7700 900302,steward,
,Cal,Example,7700900303,,`;

describe("importing workers", () => {
  it("creates workers, with column aliases, UK number formats and roles in snake_case, and logs each", async () => {
    const f = await newFirm();
    expect(await f.run("workers", csv(WORKERS))).toEqual({
      kind: "workers",
      dryRun: false,
      created: 3,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      problems: [],
    });
    const { rows } = await su.query(
      "select external_ref, first_name, mobile_e164, roles, status, email from workers where firm_id = $1 order by first_name",
      [f.firmId],
    );
    expect(rows).toEqual([
      {
        external_ref: "S1",
        first_name: "Ada",
        mobile_e164: "+447700900301",
        roles: ["door_supervisor", "steward"],
        status: "active",
        email: "ada@example.com",
      },
      {
        external_ref: "S2",
        first_name: "Ben",
        mobile_e164: "+447700900302",
        roles: ["steward"],
        status: "active",
        email: null,
      },
      // Excel dropped the leading 0 of 07700 900303: it's put back.
      {
        external_ref: null,
        first_name: "Cal",
        mobile_e164: "+447700900303",
        roles: [],
        status: "active",
        email: null,
      },
    ]);
    const added = await eventsOf(f.firmId, "worker.added");
    expect(added).toHaveLength(3);
    expect(added[0]).toMatchObject({
      data: { source: "csv" },
      actor_type: "office",
      actor_id: f.officeId,
    });
    const [done] = await eventsOf(f.firmId, "import.completed");
    expect(done?.data).toEqual({
      kind: "workers",
      created: 3,
      updated: 0,
      unchanged: 0,
      skipped: 0,
    });
  });

  it("importing the same file again changes nothing; a changed row updates by Staff ID, or by mobile without one", async () => {
    const f = await newFirm();
    await f.run("workers", csv(WORKERS));
    expect(await f.run("workers", csv(WORKERS))).toMatchObject({
      created: 0,
      updated: 0,
      unchanged: 3,
    });
    // By Staff ID, the name can change. By mobile alone, the rest can (a name change by mobile
    // alone is refused: see the next test).
    const changed = WORKERS.replace("S1,Ada,Example", "S1,Ada,Lovelace").replace(
      ",Cal,Example,7700900303,,",
      ",Cal,Example,7700900303,,cal@example.com",
    );
    expect(await f.run("workers", csv(changed))).toMatchObject({ updated: 2, unchanged: 1 });
    const updated = await eventsOf(f.firmId, "worker.updated");
    expect(updated.map((e) => e.data)).toEqual([
      { source: "csv", fields: ["lastName"] },
      { source: "csv", fields: ["email"] },
    ]);
  });

  // Audit L71: a mistyped mobile, with no Staff ID, used to rename whoever has it.
  it("without a Staff ID, a row whose mobile is another worker's (another name) is refused, not renamed", async () => {
    const f = await newFirm();
    await f.run("workers", csv(WORKERS));
    const cal = await workerByMobile(f.firmId, "+447700900303");
    await su.query(
      "insert into credentials (firm_id, worker_id, type, status) values ($1, $2, 'SIA_DS', 'valid')",
      [f.firmId, cal],
    );
    const typo = "First name,Last name,Mobile\nDan,Other,07700 900303";
    expect(await f.run("workers", csv(typo))).toMatchObject({
      created: 0,
      updated: 0,
      skipped: 1,
      problems: [{ row: 2, problem: "name_mismatch" }],
    });
    // Cal's own row still matches (the name, whatever its spacing).
    expect(
      await f.run("workers", csv("First name,Last name,Mobile\nCal,  Example,07700 900303")),
    ).toMatchObject({ unchanged: 1, skipped: 0 });
    const { rows } = await su.query(
      `select w.first_name, w.last_name, count(c.id)::int as credentials
         from workers w left join credentials c on c.worker_id = w.id
        where w.id = $1 group by w.id`,
      [cal],
    );
    expect(rows).toEqual([{ first_name: "Cal", last_name: "Example", credentials: 1 }]);
    expect(await eventsOf(f.firmId, "worker.updated")).toEqual([]);
  });

  // Audit L78: a file with no Staff IDs where a number moved from one worker to another.
  it("without Staff IDs, a number that moved between workers never hands one's record to the other", async () => {
    const f = await newFirm();
    await f.run("workers", csv("First name,Last name,Mobile\nAnn,Booker,07700 900311"));
    const ann = await workerByMobile(f.firmId, "+447700900311");
    // Ben now has Ann's old number, listed before Ann's row with her new one.
    const moved = "First name,Last name,Mobile\nBen,Carter,07700 900311\nAnn,Booker,07700 900312";
    const result = await f.run("workers", csv(moved));
    expect(result).toMatchObject({ skipped: 1, problems: [{ row: 2, problem: "name_mismatch" }] });
    const { rows } = await su.query(
      "select first_name, last_name, mobile_e164 from workers where id = $1",
      [ann],
    );
    // Ann's record is still Ann's: not renamed Ben. (Her new number arrives as a new worker: with
    // no Staff ID the import can't know it's her; the office merges or uses Staff IDs.)
    expect(rows).toEqual([
      { first_name: "Ann", last_name: "Booker", mobile_e164: "+447700900311" },
    ]);
  });

  // A Staff ID reused for a new starter: their name and mobile both differ from the leaver's.
  it("a Staff ID whose name and mobile both change is refused (a new person, not the old record)", async () => {
    const f = await newFirm();
    await f.run("workers", csv(WORKERS));
    const reused = "Staff ID,First name,Last name,Mobile\nS1,Zed,Newstarter,07700 900399";
    expect(await f.run("workers", csv(reused))).toMatchObject({
      updated: 0,
      skipped: 1,
      problems: [{ row: 2, problem: "identity_change" }],
    });
    // One at a time is fine: a new mobile, then (separately) a new name.
    const newMobile = "Staff ID,First name,Last name,Mobile\nS1,Ada,Example,07700 900398";
    expect(await f.run("workers", csv(newMobile))).toMatchObject({ updated: 1 });
    const { rows } = await su.query(
      "select first_name, mobile_e164 from workers where firm_id = $1 and external_ref = 'S1'",
      [f.firmId],
    );
    expect(rows).toEqual([{ first_name: "Ada", mobile_e164: "+447700900398" }]);
  });

  it("a column the file doesn't have, or a blank email or status, leaves that field alone", async () => {
    const f = await newFirm();
    await f.run("workers", csv(WORKERS));
    await su.query(
      "update workers set status = 'inactive' where firm_id = $1 and external_ref = 'S1'",
      [f.firmId],
    );
    const noStatus = "Staff ID,First name,Last name,Mobile\nS1,Ada,Example,07700 900301";
    expect(await f.run("workers", csv(noStatus))).toMatchObject({ unchanged: 1 });
    const { rows } = await su.query(
      "select status, email, roles from workers where firm_id = $1 and external_ref = 'S1'",
      [f.firmId],
    );
    expect(rows[0]).toEqual({
      status: "inactive",
      email: "ada@example.com",
      roles: ["door_supervisor", "steward"],
    });
  });

  it("skips bad rows, reported by spreadsheet row number and a code only; the good rows still import", async () => {
    const f = await newFirm();
    await f.run("workers", csv("Staff ID,First name,Last name,Mobile\nX9,Xena,Taken,07700 900309"));
    const file = `Staff ID,First name,Last name,Mobile,Email,Roles,Status
S1,Ada,Example,07700 900301,,,
S2,Ben,Example,call me 07700 900399,,,
S3,Cal,Example,07700 900303,not-an-email,,
S4,Dee,Example,07700 900304,,C.O.S.S.,
S5,Eve,Example,07700 900305,,,on leave
S6,,Example,07700 900306,,,
S7,Fay,Example,07700 900301,,,
S8,Gus,Example,07700 900309,,,
S1,Ada,Again,07700 900311,,,`;
    const result = await f.run("workers", csv(file));
    expect(result).toMatchObject({ created: 1, skipped: 8 });
    expect(result.problems).toEqual([
      { row: 3, problem: "bad_mobile" },
      { row: 4, problem: "bad_email" },
      { row: 5, problem: "bad_role" },
      { row: 6, problem: "bad_status" },
      { row: 7, problem: "missing_value" },
      { row: 8, problem: "duplicate_row" }, // same mobile as row 2
      { row: 9, problem: "duplicate_mobile" }, // Xena's number
      { row: 10, problem: "duplicate_row" }, // S1 again
    ]);
    const { rows } = await su.query("select data::text from events where firm_id = $1", [f.firmId]);
    expect(rows.map((r) => r.data).join(" ")).not.toContain("900399");
  });

  it("a dry run reports exactly what would happen and writes nothing, not even events", async () => {
    const f = await newFirm();
    const preview = await f.run("workers", csv(WORKERS), true);
    expect(preview).toMatchObject({ dryRun: true, created: 3, skipped: 0 });
    const counts = await su.query(
      "select (select count(*)::int from workers where firm_id = $1) as workers, (select count(*)::int from events where firm_id = $1) as events",
      [f.firmId],
    );
    expect(counts.rows[0]).toEqual({ workers: 0, events: 0 });
    expect(await f.run("workers", csv(WORKERS))).toMatchObject({ ...preview, dryRun: false });
  });

  it("an import into one firm never touches another firm's worker with the same mobile", async () => {
    const a = await newFirm();
    const b = await newFirm();
    await b.run("workers", csv("First name,Last name,Mobile\nBea,Other,07700 900301"));
    await a.run("workers", csv(WORKERS));
    const { rows } = await su.query(
      "select first_name, last_name from workers where firm_id = $1",
      [b.firmId],
    );
    expect(rows).toEqual([{ first_name: "Bea", last_name: "Other" }]);
  });
});

describe("importing credentials", () => {
  // The row found by mobile names the worker too (a mobile alone could be someone else's).
  const CREDS = `Staff ID,Mobile,Name,Licence type,Licence number,Expiry date,Status
S1,,,SIA DS,TEST-1012,07/11/2027,
,07700 900302,Ben Example,sia-sg,TEST-2020,2028-03-01,applied
S2,,,first aid,,,`;

  it("finds the worker by Staff ID or mobile and adds each credential, type codes in capitals", async () => {
    const f = await newFirm();
    await f.run("workers", csv(WORKERS));
    expect(await f.run("credentials", csv(CREDS))).toMatchObject({ created: 3, skipped: 0 });
    const { rows } = await su.query(
      `select w.external_ref, c.type, c.number, c.expires_on::text, c.status from credentials c
         join workers w on w.id = c.worker_id where c.firm_id = $1 order by c.type`,
      [f.firmId],
    );
    expect(rows).toEqual([
      { external_ref: "S2", type: "FIRST_AID", number: null, expires_on: null, status: "valid" },
      {
        external_ref: "S1",
        type: "SIA_DS",
        number: "TEST-1012",
        expires_on: "2027-11-07",
        status: "valid",
      },
      {
        external_ref: "S2",
        type: "SIA_SG",
        number: "TEST-2020",
        expires_on: "2028-03-01",
        status: "applied",
      },
    ]);
    const added = await eventsOf(f.firmId, "credential.added");
    expect(added.map((e) => e.data)).toEqual([
      { source: "csv", type: "SIA_DS" },
      { source: "csv", type: "SIA_SG" },
      { source: "csv", type: "FIRST_AID" },
    ]);
    expect(JSON.stringify(added)).not.toContain("TEST-");
  });

  it("a new expiry updates the worker's credential of that type and clears its verification", async () => {
    const f = await newFirm();
    await f.run("workers", csv(WORKERS));
    await f.run("credentials", csv(CREDS));
    await su.query(
      "update credentials set verified_at = now(), verified_by = $2 where firm_id = $1",
      [f.firmId, f.officeId],
    );
    const renewed = CREDS.replace("07/11/2027", "07/11/2030");
    expect(await f.run("credentials", csv(renewed))).toMatchObject({ updated: 1, unchanged: 2 });
    const { rows } = await su.query(
      "select type, expires_on::text, verified_at is null as unverified from credentials where firm_id = $1 order by type",
      [f.firmId],
    );
    expect(rows).toEqual([
      { type: "FIRST_AID", expires_on: null, unverified: false },
      { type: "SIA_DS", expires_on: "2030-11-07", unverified: true },
      { type: "SIA_SG", expires_on: "2028-03-01", unverified: false },
    ]);
    const [updated] = await eventsOf(f.firmId, "credential.updated");
    expect(updated?.data).toEqual({
      source: "csv",
      type: "SIA_DS",
      fields: ["expiresOn"],
      verificationCleared: true,
    });
  });

  // Audit L71, L78: a licence found by mobile alone went to whoever held the number.
  it("a row found by mobile alone must name the worker, and the name must be theirs", async () => {
    const f = await newFirm();
    await f.run("workers", csv(WORKERS));
    const file = `Mobile,First name,Last name,Type,Expires
07700 900302,Ann,Other,SIA_DS,07/11/2027
07700 900302,,,SIA_DS,07/11/2027
07700 900302,ben,example,SIA_DS,07/11/2027`;
    const result = await f.run("credentials", csv(file));
    expect(result.problems).toEqual([
      { row: 2, problem: "name_mismatch" },
      { row: 3, problem: "name_needed" },
    ]);
    expect(result.created).toBe(1);
    // A "Name" column works too, and a Staff ID needs no name.
    const byName =
      "Mobile,Name,Type\n07700 900302,Cal Example,FIRST_AID\n07700 900303,Cal  Example,FIRST_AID";
    expect((await f.run("credentials", csv(byName))).problems).toEqual([
      { row: 2, problem: "name_mismatch" },
    ]);
    const { rows } = await su.query(
      `select w.first_name, c.type from credentials c join workers w on w.id = c.worker_id
        where c.firm_id = $1 order by c.type`,
      [f.firmId],
    );
    expect(rows).toEqual([
      { first_name: "Cal", type: "FIRST_AID" },
      { first_name: "Ben", type: "SIA_DS" },
    ]);
  });

  it("skips rows it can't place or read", async () => {
    const f = await newFirm();
    await f.run("workers", csv(WORKERS));
    const file = `Staff ID,Mobile,Type,Expires
S404,,SIA_DS,
,07700 900399,SIA_DS,
S1,,SIA/DS,
S1,,SIA_DS,31/02/2027
,,SIA_DS,
S1,,SIA_DS,
S1,,SIA_DS,01/01/2028`;
    const result = await f.run("credentials", csv(file));
    expect(result.problems).toEqual([
      { row: 2, problem: "unknown_worker" },
      { row: 3, problem: "unknown_worker" },
      { row: 4, problem: "bad_type" },
      { row: 5, problem: "bad_date" },
      { row: 6, problem: "missing_value" },
      { row: 8, problem: "duplicate_row" },
    ]);
    expect(result.created).toBe(1);
  });

  it("a file with neither a Staff ID nor a mobile column is refused", () => {
    expect(() => resolveColumns("credentials", ["Type", "Expires"])).toThrow(ImportFileError);
  });
});

describe("importing shifts", () => {
  async function shiftsWorkbook() {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Rota");
    sheet.addRow(["Date", "Start", "Finish", "Venue", "Position", "Qty", "Notes"]);
    const night = sheet.addRow([
      new Date(Date.UTC(2026, 10, 7)),
      22 / 24,
      6 / 24,
      "Acme Demo Arena",
      "Steward",
      2,
      "Gate C",
    ]);
    const summer = sheet.addRow([
      new Date(Date.UTC(2027, 5, 14)),
      9.5 / 24,
      17.5 / 24,
      "",
      "door supervisor",
      "",
      "",
    ]);
    for (const row of [night, summer]) {
      row.getCell(1).numFmt = "dd/mm/yyyy";
      row.getCell(2).numFmt = "hh:mm";
      row.getCell(3).numFmt = "hh:mm";
    }
    return readTable(new Uint8Array(await wb.xlsx.writeBuffer()));
  }

  it("creates shifts from an Excel file with date and time cells, in London time; importing it again changes nothing", async () => {
    const f = await newFirm();
    const rows = await shiftsWorkbook();
    expect(await f.run("shifts", rows)).toMatchObject({ created: 2, skipped: 0 });
    const { rows: shifts } = await su.query(
      `select s.role, s.starts_at, s.ends_at, s.headcount, s.status, s.source, si.name as site, s.instructions,
              s.external_ref like 'auto-%' as derived_key
         from shifts s left join sites si on si.id = s.site_id where s.firm_id = $1 order by s.starts_at`,
      [f.firmId],
    );
    expect(shifts).toEqual([
      {
        role: "steward",
        starts_at: new Date("2026-11-07T22:00:00Z"),
        ends_at: new Date("2026-11-08T06:00:00Z"),
        headcount: 2,
        status: "open",
        source: "csv",
        site: "Acme Demo Arena",
        instructions: "Gate C",
        derived_key: true,
      },
      {
        role: "door_supervisor",
        starts_at: new Date("2027-06-14T08:30:00Z"),
        ends_at: new Date("2027-06-14T16:30:00Z"),
        headcount: 1,
        status: "open",
        source: "csv",
        site: null,
        instructions: null,
        derived_key: true,
      },
    ]);
    expect(await f.run("shifts", rows)).toMatchObject({ created: 0, unchanged: 2 });
    expect(await eventsOf(f.firmId, "shift.created")).toHaveLength(2);
  });

  it("a shift with bookings keeps its times, role and headcount; other changes still apply", async () => {
    const f = await newFirm();
    const file = (start: string, needed: string, notes: string) =>
      csv(
        `Shift ID,Date,Start,End,Role,Needed,Instructions\nE1,07/11/2026,${start},17:00,steward,${needed},${notes}`,
      );
    await f.run("shifts", file("09:00", "1", "Gate A"));
    await f.run("workers", csv(WORKERS));
    const { rows } = await su.query(
      `select s.id::text as shift, w.id::text as worker from shifts s, workers w
        where s.firm_id = $1 and w.firm_id = $1 and w.external_ref = 'S1'`,
      [f.firmId],
    );
    await su.query(
      `insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at)
       values ($1, $2, 1, $3, 'confirmed', now())`,
      [f.firmId, rows[0]?.shift, rows[0]?.worker],
    );
    await su.query("update shifts set status = 'filled' where id = $1", [rows[0]?.shift]);

    expect(await f.run("shifts", file("08:00", "1", "Gate A"))).toMatchObject({
      skipped: 1,
      problems: [{ row: 2, problem: "shift_has_bookings" }],
    });
    // More places and new instructions are fine, and the shift is open again.
    expect(await f.run("shifts", file("09:00", "2", "Gate B"))).toMatchObject({ updated: 1 });
    const after = await su.query(
      "select headcount, instructions, status from shifts where id = $1",
      [rows[0]?.shift],
    );
    expect(after.rows[0]).toEqual({ headcount: 2, instructions: "Gate B", status: "open" });
    const [changed] = await eventsOf(f.firmId, "shift.changed");
    expect(changed?.data).toEqual({ source: "csv", fields: ["headcount", "instructions"] });
    // Opened again by the import: logged, as the office's own "Open it again" is.
    const reopened = await eventsOf(f.firmId, "shift.reopened");
    expect(reopened.map((e) => [e.data, e.actor_type, e.actor_id])).toEqual([
      [{ source: "csv" }, "office", f.officeId],
    ]);
  });

  // Audit M11: the office marked it filled with a place still free (it filled it another way).
  it("a re-import never reopens a shift the office marked as filled", async () => {
    const f = await newFirm();
    const file = (needed: string, notes: string) =>
      csv(
        `Shift ID,Date,Start,End,Role,Needed,Instructions\nE2,07/11/2026,09:00,17:00,steward,${needed},${notes}`,
      );
    await f.run("shifts", file("2", "Gate A"));
    await f.run("workers", csv(WORKERS));
    const { rows: ids } = await su.query(
      `select s.id::text as shift, w.id::text as worker from shifts s, workers w
        where s.firm_id = $1 and w.firm_id = $1 and w.external_ref = 'S1'`,
      [f.firmId],
    );
    const shiftId = ids[0]?.shift ?? "";
    await su.query(
      `insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at)
       values ($1, $2, 1, $3, 'confirmed', now())`,
      [f.firmId, shiftId, ids[0]?.worker],
    );
    // One of two places booked; the office fills the other another way and marks it filled.
    await su.query("update office_users set role = 'admin' where id = $1", [f.officeId]);
    expect(
      await closeShift(
        withFirm,
        f.firmId,
        {
          shiftId,
          by: { type: "office", id: f.officeId },
        },
        { clock: { now: () => NOW } },
      ),
    ).toMatchObject({ status: "closed" });
    expect(await f.run("shifts", file("3", "Gate C"))).toMatchObject({ updated: 1 });
    const { rows } = await su.query(
      "select headcount, instructions, status from shifts where id = $1",
      [shiftId],
    );
    expect(rows).toEqual([{ headcount: 3, instructions: "Gate C", status: "filled" }]);
    expect(await eventsOf(f.firmId, "shift.reopened")).toEqual([]);
  });

  // Audit L67, L70: the same date and time rules as the Sheets sync and the office's editor.
  it("dates and times are read as the sheet and the office's editor read them", async () => {
    const f = await newFirm();
    const result = await f.run(
      "shifts",
      csv(`Shift ID,Date,Start,End,Role
D1,Sat 7 Nov 2026,09:00,17:00,steward
D2,7 November 2026 00:00,10:00,18:00,steward
D3,Fri 7 Nov 2026,09:00,17:00,steward
D4,07/11/2026,09:00,09:00,steward
D5,28/03/2027,01:30,06:00,steward
D6,7 Novx 2026,09:00,17:00,steward`),
    );
    expect(result).toMatchObject({ created: 2 });
    expect(result.problems).toEqual([
      { row: 4, problem: "bad_date" },
      { row: 5, problem: "bad_time" },
      { row: 6, problem: "bad_time" },
      { row: 7, problem: "bad_date" },
    ]);
  });

  it("skips shift rows it can't read", async () => {
    const f = await newFirm();
    const result = await f.run(
      "shifts",
      csv(`Date,Start,End,Role,Needed
someday,09:00,17:00,steward,
07/11/2026,9am,17:00,steward,
07/11/2026,09:00,17:00,,
07/11/2026,09:00,17:00,Door/Sup,
07/11/2026,09:00,17:00,steward,0
07/11/2026,09:00,17:00,steward,1
07/11/2026,09:00,17:00,steward,1`),
    );
    expect(result.problems).toEqual([
      { row: 2, problem: "bad_date" },
      { row: 3, problem: "bad_time" },
      { row: 4, problem: "missing_value" },
      { row: 5, problem: "bad_role" },
      { row: 6, problem: "bad_headcount" },
      { row: 8, problem: "duplicate_row" },
    ]);
    expect(result.created).toBe(1);
  });
});

describe("columns", () => {
  it("are found by any accepted name, in any case or spacing; a missing or doubled column refuses the file", () => {
    expect(resolveColumns("workers", ["MOBILE NUMBER", "Surname", " first-name "])).toEqual({
      ref: undefined,
      firstName: 2,
      lastName: 1,
      mobile: 0,
      email: undefined,
      roles: undefined,
      status: undefined,
    });
    const refusal = (header: string[]) => {
      try {
        resolveColumns("workers", header);
      } catch (err) {
        return err instanceof ImportFileError ? err.code : "other";
      }
      return "accepted";
    };
    expect(refusal(["First name", "Last name"])).toBe("missing_column");
    expect(refusal(["First name", "Last name", "Mobile", "Phone"])).toBe("duplicate_column");
  });
});

describe("importFromFile (npm run import)", () => {
  it("imports a file for a firm as one of its office users: a dry run first, then --apply", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { importFromFile, ImportSetupError } = await import("@/lib/imports/from-file");
    const { createDirectory } = await import("@/lib/db/directory");
    const { summarise } = await import("@/lib/imports/messages");

    const f = await newFirm();
    const { rows } = await su.query("select slug from firms where id = $1", [f.firmId]);
    const slug = String(rows[0]?.slug);
    const email = `${slug}@example.com`;
    const path = join(mkdtempSync(join(tmpdir(), "shiftdesk-import-")), "workers.csv");
    writeFileSync(path, `${WORKERS}\nS9,Nia,Example,not a number,,`);
    const deps = { run: withFirm, resolveFirm: createDirectory(app), clock: { now: () => NOW } };

    const preview = await importFromFile(
      { firmSlug: slug, kind: "workers", officeEmail: email, path, apply: false },
      deps,
    );
    expect(summarise(preview)).toBe(
      "Dry run (nothing saved): would create 3, update 0, leave 0 unchanged, skip 1.\n" +
        "Row 5: the mobile number isn't a mobile we can text.",
    );
    const saved = await importFromFile(
      { firmSlug: slug, kind: "workers", officeEmail: email.toUpperCase(), path, apply: true },
      deps,
    );
    expect(saved).toMatchObject({ dryRun: false, created: 3, skipped: 1 });
    const [done] = await eventsOf(f.firmId, "import.completed");
    expect(done?.actor_id).toBe(f.officeId);

    await expect(
      // A kind the importer doesn't have ("pay" became a real one in Phase 3).
      importFromFile(
        { firmSlug: slug, kind: "invoices", officeEmail: email, path, apply: false },
        deps,
      ),
    ).rejects.toBeInstanceOf(ImportSetupError);
    await expect(
      importFromFile(
        { firmSlug: "no-such-firm", kind: "workers", officeEmail: email, path, apply: false },
        deps,
      ),
    ).rejects.toBeInstanceOf(ImportSetupError);
    await expect(
      importFromFile(
        { firmSlug: slug, kind: "workers", officeEmail: "someone@example.com", path, apply: false },
        deps,
      ),
    ).rejects.toThrow(/active admin or resourcer/);
  });
});

// Found by the guardrails review.
describe("imports: rows that must not be lost, reset or rewritten", () => {
  it("a workers file with no Staff ID column imports every row (matched by mobile)", async () => {
    const f = await newFirm();
    const file = `First name,Last name,Mobile
Ada,Example,07700 900301
Ben,Example,07700 900302
Cal,Example,07700 900303`;
    expect(await f.run("workers", csv(file))).toMatchObject({ created: 3, skipped: 0 });
    expect(await f.run("workers", csv(file))).toMatchObject({ unchanged: 3, skipped: 0 });
  });

  it("re-importing credentials never resets a suspended one or wipes a number or expiry", async () => {
    const f = await newFirm();
    await f.run("workers", csv(WORKERS));
    await f.run("credentials", csv("Staff ID,Type,Number,Expires\nS1,SIA_DS,TEST-1012,07/11/2027"));
    await su.query("update credentials set status = 'suspended' where firm_id = $1", [f.firmId]);
    expect(await f.run("credentials", csv("Staff ID,Type\nS1,SIA_DS"))).toMatchObject({
      unchanged: 1,
    });
    expect(
      await f.run("credentials", csv("Staff ID,Type,Number,Expires,Status\nS1,SIA_DS,,,")),
    ).toMatchObject({
      unchanged: 1,
    });
    const { rows } = await su.query(
      "select status, number, expires_on::text from credentials where firm_id = $1",
      [f.firmId],
    );
    expect(rows).toEqual([{ status: "suspended", number: "TEST-1012", expires_on: "2027-11-07" }]);
    // An explicit status in the file is the office's decision, and applies.
    expect(await f.run("credentials", csv("Staff ID,Type,Status\nS1,SIA_DS,valid"))).toMatchObject({
      updated: 1,
    });
  });

  it("an expired credential given a new future expiry (and no status) is a renewal: valid again", async () => {
    const f = await newFirm();
    await f.run("workers", csv(WORKERS));
    await f.run("credentials", csv("Staff ID,Type,Expires,Status\nS1,SIA_DS,01/10/2026,expired"));
    expect(
      await f.run("credentials", csv("Staff ID,Type,Expires\nS1,SIA_DS,01/10/2029")),
    ).toMatchObject({ updated: 1 });
    const { rows } = await su.query(
      "select status, expires_on::text from credentials where firm_id = $1",
      [f.firmId],
    );
    expect(rows).toEqual([{ status: "valid", expires_on: "2029-10-01" }]);
    // A past date isn't a renewal.
    await su.query("update credentials set status = 'expired' where firm_id = $1", [f.firmId]);
    await f.run("credentials", csv("Staff ID,Type,Expires\nS1,SIA_DS,01/01/2026"));
    const again = await su.query("select status from credentials where firm_id = $1", [f.firmId]);
    expect(again.rows[0]?.status).toBe("expired");
  });

  it("a booked shift's headcount can't go down, even when the booking sits in a higher slot", async () => {
    const f = await newFirm();
    const file = (needed: string) =>
      csv(`Shift ID,Date,Start,End,Role,Needed\nE2,07/11/2026,09:00,17:00,steward,${needed}`);
    await f.run("shifts", file("2"));
    await f.run("workers", csv(WORKERS));
    const { rows } = await su.query(
      `select s.id::text as shift, w.id::text as worker from shifts s, workers w
        where s.firm_id = $1 and w.firm_id = $1 and w.external_ref = 'S2'`,
      [f.firmId],
    );
    // Slot 1 was cancelled and reopened; S2 still holds slot 2.
    await su.query(
      `insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at)
       values ($1, $2, 2, $3, 'confirmed', now()), ($1, $2, 1, null, 'open', null)`,
      [f.firmId, rows[0]?.shift, rows[0]?.worker],
    );
    expect(await f.run("shifts", file("1"))).toMatchObject({
      skipped: 1,
      problems: [{ row: 2, problem: "shift_has_bookings" }],
    });
    const after = await su.query("select headcount from shifts where id = $1", [rows[0]?.shift]);
    expect(after.rows[0]?.headcount).toBe(2);
  });

  it("shifts that have already started are never created or changed by an import", async () => {
    const f = await newFirm();
    const row = (start: string, notes: string) =>
      csv(
        `Shift ID,Date,Start,End,Role,Instructions\nP1,06/11/2026,${start},17:00,steward,${notes}`,
      );
    // NOW is 06/11/2026 09:00 (GMT): an 08:00 start has started.
    expect(await f.run("shifts", row("08:00", "a"))).toMatchObject({
      problems: [{ row: 2, problem: "shift_started" }],
    });
    expect(await f.run("shifts", row("10:00", "a"))).toMatchObject({ created: 1 });
    const later = new Date(NOW.getTime() + 2 * 3_600_000);
    expect(await f.run("shifts", row("10:00", "b"), false, later)).toMatchObject({
      problems: [{ row: 2, problem: "shift_started" }],
    });
  });

  it("sites created by an import are logged, and an import run from the terminal says so", async () => {
    const f = await newFirm();
    await f.run(
      "shifts",
      csv("Date,Start,End,Site,Role\n07/11/2026,09:00,17:00,Acme Demo Arena,steward"),
    );
    const [site] = await eventsOf(f.firmId, "site.created");
    expect(site?.data).toEqual({ source: "csv" });
    const viaCli = await withFirm(f.firmId, (tx) =>
      runImport(tx, {
        kind: "workers",
        rows: csv(WORKERS),
        dryRun: false,
        actorId: f.officeId,
        timeZone: "Europe/London",
        now: NOW,
        via: "cli",
      }),
    );
    expect(viaCli.created).toBe(3);
    expect((await eventsOf(f.firmId, "worker.added"))[0]?.data).toEqual({
      source: "csv",
      via: "cli",
    });
    expect((await eventsOf(f.firmId, "import.completed")).at(-1)?.data).toMatchObject({
      via: "cli",
    });
  });

  it("another firm's staff IDs, shift IDs and site names are separate", async () => {
    const a = await newFirm();
    const b = await newFirm();
    await b.run("workers", csv("Staff ID,First name,Last name,Mobile\nZ1,Zed,Other,07700 900311"));
    expect(await a.run("credentials", csv("Staff ID,Type\nZ1,SIA_DS"))).toMatchObject({
      problems: [{ row: 2, problem: "unknown_worker" }],
    });
    const shift = csv(
      "Shift ID,Date,Start,End,Site,Role\nX1,07/11/2026,09:00,17:00,Acme Demo Arena,steward",
    );
    expect(await a.run("shifts", shift)).toMatchObject({ created: 1 });
    expect(await b.run("shifts", shift)).toMatchObject({ created: 1 });
    const { rows } = await su.query(
      `select s.firm_id::text, si.firm_id::text as site_firm from shifts s join sites si on si.id = s.site_id
        where s.external_ref = 'X1' and s.firm_id = any($1::uuid[]) order by 1`,
      [[a.firmId, b.firmId]],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.firm_id === r.site_firm)).toBe(true);
  });
});

describe("imports: events and a session's own details (12B.1)", () => {
  const FILE = `Shift ID,Date,Start,End,Site,Role,Notes
E1,Sat 7 Nov 2026,09:00,17:00,Acme Demo Arena,steward,
E2,Sat 7 Nov 2026,18:00,02:00,Acme Demo Arena,steward,
E3,Sun 8 Nov 2026,09:00,17:00,Acme Demo Arena,steward,
E4,Sat 7 Nov 2026,09:00,17:00,,steward,`;
  const eventsByRef = async (firmId: string) =>
    Object.fromEntries(
      (
        await su.query<{ ref: string; id: string; name: string; key: string; source: string }>(
          `select s.external_ref as ref, e.id::text as id, e.name, e.planner_ref as key, e.source
             from shifts s join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
            where s.firm_id = $1`,
          [firmId],
        )
      ).rows.map((r) => [r.ref, r]),
    );
  const eventCount = async (firmId: string) =>
    (
      await su.query<{ n: number }>(
        "select count(*)::int as n from shift_events where firm_id = $1",
        [firmId],
      )
    ).rows[0]?.n;

  it("each new row joins its site and day's automatic event; a check makes none; again makes none", async () => {
    const f = await newFirm();
    expect(await f.run("shifts", csv(FILE), true)).toMatchObject({ dryRun: true, created: 4 });
    expect(await eventCount(f.firmId)).toBe(0);
    expect(await f.run("shifts", csv(FILE))).toMatchObject({ created: 4 });
    const e = await eventsByRef(f.firmId);
    expect(e.E1).toMatchObject({ name: "Acme Demo Arena · Sat 7 Nov", source: "csv" });
    expect(e.E1?.key).toMatch(/^auto:[0-9a-f-]{36}:2026-11-07$/);
    expect(e.E2?.id).toBe(e.E1?.id); // 18:00 to 02:00: the day it starts
    expect(e.E3).toMatchObject({ name: "Acme Demo Arena · Sun 8 Nov" });
    expect(e.E4).toMatchObject({ name: "Sat 7 Nov", key: "auto:none:2026-11-07" });
    expect(await eventCount(f.firmId)).toBe(3);
    expect(await f.run("shifts", csv(FILE))).toMatchObject({ created: 0, unchanged: 4 });
    expect(await eventCount(f.firmId)).toBe(3);
  });

  it("a re-import never changes a switch, a session detail or the event, whatever changed in the file", async () => {
    const f = await newFirm();
    await f.run("shifts", csv(FILE));
    const before = (await eventsByRef(f.firmId)).E1;
    const details = {
      pay_rate_pence: 1325,
      post: "Gate A",
      meeting_point: "North entrance",
      uniform: "Black trousers",
      required_credentials: ["FIRST_AID"],
      showing_to_casuals: false,
    };
    await su.query(
      `update shifts set pay_rate_pence = $3, post = $4, meeting_point = $5, uniform = $6,
              required_credentials = $7, showing_to_casuals = $8
        where firm_id = $1 and external_ref = $2`,
      [f.firmId, "E1", ...Object.values(details)],
    );
    await su.query("update shift_events set showing_to_casuals = false where id = $1", [
      before?.id,
    ]);
    // Every field of E1 changes: date, times, site, role and notes.
    const changed = FILE.replace(
      "E1,Sat 7 Nov 2026,09:00,17:00,Acme Demo Arena,steward,",
      "E1,Mon 9 Nov 2026,10:00,18:00,Acme Demo Racecourse,door supervisor,Bring ID",
    );
    expect(await f.run("shifts", csv(changed))).toMatchObject({ updated: 1 });
    const { rows } = await su.query(
      `select s.pay_rate_pence, s.post, s.meeting_point, s.uniform, s.required_credentials,
              s.showing_to_casuals, s.role, s.instructions, s.event_id::text as event_id,
              e.showing_to_casuals as event_showing
         from shifts s join shift_events e on e.id = s.event_id
        where s.firm_id = $1 and s.external_ref = 'E1'`,
      [f.firmId],
    );
    expect(rows[0]).toMatchObject({ role: "door_supervisor", instructions: "Bring ID" }); // control
    expect(rows[0]).toMatchObject({ ...details, event_showing: false, event_id: before?.id });
  });
});
