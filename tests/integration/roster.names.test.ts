import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runImport } from "@/lib/imports/import";
import { summarise } from "@/lib/imports/messages";
import { readTable } from "@/lib/imports/table";
import { DEFAULT_SHEET_MAPPING } from "@/lib/roster/sheets/mapping";
import { syncSheet } from "@/lib/roster/sheets/sync";
import { loadSheetNames } from "@/lib/office/dashboard";
import { listNames, setName } from "../../scripts/firm-names-owner";
import { appRolePool, superuserPool, uniqueSlug, urls } from "../helpers/db";
import { FakeSheets, SHIFT_HEADER, shiftRow, STAFF_HEADER, staffRow } from "../helpers/fake-sheets";
import { NOW } from "../helpers/roster-contract";

// A firm's name map (P3.2; src/lib/roster/names.ts; scripts/firm-names-owner.ts): set by the owner
// and logged; read by the rota sheet's sync and the file import, so a mapped name comes in as its
// code, a skipped one doesn't come in at all, and one neither the map nor the usual spelling rule
// can read is a bad role, never brought in and never offered. Another firm's map is never used.
// On the real database: the owner's connection for the map, the app role for the rest.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
const ADMIN = urls.admin;

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
  const slug = uniqueSlug("nm");
  const firmId = await one("insert into firms (name, slug, sector) values ($1, $2, 'security')", [
    `Names Test ${slug}`,
    slug,
  ]);
  await su.query(
    `insert into credential_rules (firm_id, sector, role, required_types)
     select $1, 'security', r, '{}' from unnest(array['door_supervisor', 'traffic_marshal', 'steward']) r`,
    [firmId],
  );
  return { firmId, slug };
}

const map = (slug: string, kind: string, name: string, code?: string, rate?: string) =>
  setName(ADMIN, slug, { kind, name, code, rate });

describe("the owner's name map", () => {
  it("maps names, skips them, takes them off, each logged with what changed; the same again changes nothing", async () => {
    const f = await newFirm();
    expect(
      await map(f.slug, "role", "  Door Supervisor (NLW) ", "Door supervisor", "12.21"),
    ).toEqual({
      status: "saved",
      row: {
        kind: "role",
        name: "door supervisor (nlw)",
        code: "door_supervisor",
        payRatePence: 1221,
      },
    });
    expect(
      await map(f.slug, "role", "door supervisor  (nlw)", "door_supervisor", "£12.21"),
    ).toEqual({
      status: "unchanged",
    });
    expect(await map(f.slug, "role", "Holiday", "skip")).toMatchObject({ status: "saved" });
    expect(await map(f.slug, "staff_type", "Casual Worker", "casual")).toMatchObject({
      status: "saved",
    });
    expect(await map(f.slug, "cancellation_reason", "Cancelled by client", "client")).toMatchObject(
      { status: "saved" },
    );
    expect(await setName(ADMIN, f.slug, { kind: "role", name: "HOLIDAY", remove: true })).toEqual({
      status: "removed",
    });
    expect(await setName(ADMIN, f.slug, { kind: "role", name: "Holiday", remove: true })).toEqual({
      status: "not_there",
    });
    expect(await listNames(ADMIN, f.slug)).toEqual({
      status: "ok",
      rows: [
        {
          kind: "cancellation_reason",
          name: "cancelled by client",
          code: "client",
          payRatePence: null,
        },
        {
          kind: "role",
          name: "door supervisor (nlw)",
          code: "door_supervisor",
          payRatePence: 1221,
        },
        { kind: "staff_type", name: "casual worker", code: "casual", payRatePence: null },
      ],
    });
    const { rows } = await su.query(
      "select actor_type, entity_type, data from events where firm_id = $1 and action = 'firm.settings_changed' order by id",
      [f.firmId],
    );
    expect(rows).toEqual([
      {
        actor_type: "system",
        entity_type: "firm",
        data: {
          keys: ["name_map.role"],
          name: "door supervisor (nlw)",
          from: null,
          to: "door_supervisor",
          fromRatePence: null,
          toRatePence: 1221,
        },
      },
      {
        actor_type: "system",
        entity_type: "firm",
        data: { keys: ["name_map.role"], name: "holiday", from: null, to: "skip" },
      },
      {
        actor_type: "system",
        entity_type: "firm",
        data: { keys: ["name_map.staff_type"], name: "casual worker", from: null, to: "casual" },
      },
      {
        actor_type: "system",
        entity_type: "firm",
        data: {
          keys: ["name_map.cancellation_reason"],
          name: "cancelled by client",
          from: null,
          to: "client",
        },
      },
      {
        actor_type: "system",
        entity_type: "firm",
        data: { keys: ["name_map.role"], name: "holiday", from: "skip", to: null },
      },
    ]);
    expect(await listNames(ADMIN, "no-such-firm")).toEqual({ status: "no_firm" });
  });

  it("refuses what it can't use, and saves nothing", async () => {
    const f = await newFirm();
    await su.query(
      "insert into credential_types (firm_id, code, name, sector) values ($1, 'TM_12D', 'NHSS 12D', 'any')",
      [f.firmId],
    );
    const cases: [Parameters<typeof setName>[2], string][] = [
      [{ kind: "grade", name: "x", code: "steward" }, "kind"],
      [{ kind: "role", name: "   ", code: "steward" }, "name"],
      [{ kind: "role", name: "x".repeat(201), code: "steward" }, "name"],
      [{ kind: "role", name: "Steward" }, "code"],
      [{ kind: "role", name: "Steward", code: "12D" }, "code"],
      [{ kind: "role", name: "Steward", code: "skip", rate: "12.21" }, "rate"],
      [{ kind: "role", name: "Steward", code: "steward", rate: "12,21" }, "rate"],
      [{ kind: "role", name: "Steward", code: "steward", rate: "1000.01" }, "rate"],
      [{ kind: "qualification", name: "12D", code: "TM_12D", rate: "12" }, "rate"],
      // A qualification the firm doesn't have; a staff type that isn't casual; an unknown asker.
      [{ kind: "qualification", name: "Chapter 8", code: "CHAPTER_8" }, "code"],
      [{ kind: "staff_type", name: "Contracted", code: "employee" }, "code"],
      [{ kind: "cancellation_reason", name: "Sick", code: "illness" }, "code"],
      [{ kind: "role", name: "Holiday", remove: true, code: "skip" }, "code"],
    ];
    for (const [change, field] of cases) {
      expect(await setName(ADMIN, f.slug, change), JSON.stringify(change)).toEqual({
        status: "bad",
        field,
      });
    }
    expect(await listNames(ADMIN, f.slug)).toEqual({ status: "ok", rows: [] });
    // The firm's own qualification is allowed; so is skipping a staff type.
    expect(await map(f.slug, "qualification", "NHSS 12D", "TM_12D")).toMatchObject({
      status: "saved",
    });
    expect(await map(f.slug, "staff_type", "Contracted", "skip")).toMatchObject({
      status: "saved",
    });
  });

  it("the app can read its firm's map, never write it, and never see another firm's", async () => {
    const a = await newFirm();
    const b = await newFirm();
    await map(a.slug, "role", "Door Supervisor (NLW)", "door_supervisor");
    await map(b.slug, "role", "Gate Steward", "steward");
    const seen = await withFirm(
      a.firmId,
      async (tx) => (await tx.execute(sql`select outside_name from name_map`)).rows,
    );
    expect(seen).toEqual([{ outside_name: "door supervisor (nlw)" }]);
    for (const write of [
      "insert into name_map (firm_id, kind, outside_name, code) values (app_current_firm_id(), 'role', 'x', 'steward')",
      "update name_map set code = 'steward'",
      "delete from name_map",
    ]) {
      await expect(
        withFirm(a.firmId, (tx) => tx.execute(sql.raw(write))),
        write,
      ).rejects.toMatchObject({ cause: { code: "42501" } }); // permission denied
    }
  });
});

// A firm with a rota sheet, as in tests/integration/sheets.sync.test.ts.
async function sheetFirm(staff: string[][], shifts: string[][]) {
  const f = await newFirm();
  const sheetId = `test_${randomBytes(30).toString("base64url")}`.slice(0, 44);
  await su.query(
    "insert into roster_sources (firm_id, kind, spreadsheet_id, mapping) values ($1, 'sheets', $2, $3)",
    [f.firmId, sheetId, JSON.stringify(DEFAULT_SHEET_MAPPING)],
  );
  const fake = new FakeSheets();
  fake.create(sheetId, { Staff: [STAFF_HEADER, ...staff], Shifts: [SHIFT_HEADER, ...shifts] });
  const sync = () =>
    syncSheet({ run: withFirm, firmId: f.firmId, client: fake, clock: { now: () => NOW } });
  return { ...f, sync, fake, sheetId };
}

const rowsOf = async (firmId: string) => ({
  workers: (
    await su.query(
      "select external_ref, roles from workers where firm_id = $1 and external_ref is not null order by external_ref",
      [firmId],
    )
  ).rows,
  shifts: (
    await su.query(
      "select external_ref, role from shifts where firm_id = $1 and external_ref is not null order by external_ref",
      [firmId],
    )
  ).rows,
});

const day = "Sat 7 Nov 2026"; // after NOW (Mon 2 Nov 2026)
const SHEET = {
  staff: [
    staffRow({
      ref: "S1",
      first: "Ada",
      last: "Example",
      mobile: "07700 900401",
      roles: "Door Supervisor (NLW), Holiday",
    }),
    staffRow({
      ref: "S2",
      first: "Ben",
      last: "Example",
      mobile: "07700 900402",
      roles: "Event Manager (PAYE)",
    }),
  ],
  shifts: [
    shiftRow({ ref: "E1", date: day, start: "09:00", end: "17:00", role: "Door Supervisor (LLW)" }),
    shiftRow({ ref: "E2", date: day, start: "09:00", end: "17:00", role: "Holiday" }),
    shiftRow({ ref: "E3", date: day, start: "09:00", end: "17:00", role: "12D" }),
    shiftRow({ ref: "E4", date: day, start: "09:00", end: "17:00", role: "Event Manager (PAYE)" }),
  ],
};

describe("the rota sheet's sync through the map", () => {
  it("mapped names come in as codes, skipped ones not at all, unreadable ones as problems (never offered)", async () => {
    const f = await sheetFirm(SHEET.staff, SHEET.shifts);
    for (const [name, code] of [
      ["Door Supervisor (NLW)", "door_supervisor"],
      ["Door Supervisor (LLW)", "door_supervisor"],
      ["12D", "traffic_marshal"],
      ["Holiday", "skip"],
    ] as const) {
      await map(f.slug, "role", name, code);
    }
    expect(await f.sync()).toMatchObject({ status: "synced", staff: 1, shifts: 2 });
    expect(await rowsOf(f.firmId)).toEqual({
      workers: [{ external_ref: "S1", roles: ["door_supervisor"] }],
      shifts: [
        { external_ref: "E1", role: "door_supervisor" },
        { external_ref: "E3", role: "traffic_marshal" },
      ],
    });
    const { rows } = await su.query(
      "select data from events where firm_id = $1 and action = 'roster.synced'",
      [f.firmId],
    );
    // Ben's role and E4 can't be read: two problems, logged.
    expect(rows).toEqual([{ data: expect.objectContaining({ staff: 1, shifts: 2, problems: 2 }) }]);
  });

  it("another firm's map is never used: the same sheet there reads the names as before", async () => {
    const mapped = await sheetFirm(SHEET.staff, SHEET.shifts);
    await map(mapped.slug, "role", "Door Supervisor (LLW)", "door_supervisor");
    const plain = await sheetFirm(SHEET.staff, SHEET.shifts);
    expect(await plain.sync()).toMatchObject({ status: "synced", staff: 0, shifts: 1 });
    // Only "Holiday" reads as a role without a map (and no rule needs it, so nobody gets it).
    expect((await rowsOf(plain.firmId)).shifts).toEqual([{ external_ref: "E2", role: "holiday" }]);
  });
});

describe("a name skipped after its sessions came in", () => {
  it("the map never cancels or changes a session: it stays as it is, and the sync says so", async () => {
    const f = await sheetFirm(SHEET.staff.slice(0, 1), SHEET.shifts.slice(0, 1));
    await map(f.slug, "role", "Door Supervisor (NLW)", "door_supervisor");
    await map(f.slug, "role", "Door Supervisor (LLW)", "door_supervisor");
    expect(await f.sync()).toMatchObject({ status: "synced", shifts: 1, problems: [] });
    await map(f.slug, "role", "Door Supervisor (LLW)", "skip");
    expect(await f.sync()).toMatchObject({
      status: "synced",
      shifts: 0,
      problems: [{ tab: "shifts", row: 2, problem: "skipped_live" }],
    });
    const { rows: shifts } = await su.query(
      "select external_ref, role, status from shifts where firm_id = $1",
      [f.firmId],
    );
    expect(shifts).toEqual([{ external_ref: "E1", role: "door_supervisor", status: "open" }]);
    const { rows } = await su.query(
      "select data from events where firm_id = $1 and action = 'roster.synced' order by id",
      [f.firmId],
    );
    expect(rows.map((r) => [r.data.problems, r.data.skipped])).toEqual([
      [0, undefined],
      [1, 1],
    ]);
  });
});

// The names the last sync couldn't use (Phase 25.2), as the table holds them and as Needs attention
// reads them (inside the firm: RLS scopes both).
const problemsOf = async (firmId: string) =>
  (
    await su.query(
      `select kind, tab, row, outside_name, shift_id::text as shift_id from sheet_name_problems
        where firm_id = $1 order by kind desc, tab, row`,
      [firmId],
    )
  ).rows;
const needsOf = (firmId: string) => withFirm(firmId, (tx) => loadSheetNames(tx, NOW));

describe("the names a sync couldn't use, kept for Needs attention (Phase 25.2)", () => {
  it("a role it can't read: the cell's text, by tab and row; a skipped name with no session: nothing", async () => {
    const f = await sheetFirm(SHEET.staff, SHEET.shifts);
    for (const [name, code] of [
      ["Door Supervisor (NLW)", "door_supervisor"],
      ["Door Supervisor (LLW)", "door_supervisor"],
      ["12D", "traffic_marshal"],
      ["Holiday", "skip"],
    ] as const) {
      await map(f.slug, "role", name, code);
    }
    expect(await f.sync()).toMatchObject({ status: "synced" });
    // Ben's role (staff row 3) and E4's (shifts row 5); E2's "Holiday" made no session.
    expect(await problemsOf(f.firmId)).toEqual([
      {
        kind: "unreadable",
        tab: "shifts",
        row: 5,
        outside_name: "Event Manager (PAYE)",
        shift_id: null,
      },
      {
        kind: "unreadable",
        tab: "staff",
        row: 3,
        outside_name: "Event Manager (PAYE)",
        shift_id: null,
      },
    ]);
    expect(await needsOf(f.firmId)).toEqual({
      items: [
        { kind: "unreadable", name: "Event Manager (PAYE)", tab: "shifts", row: 5 },
        { kind: "unreadable", name: "Event Manager (PAYE)", tab: "staff", row: 3 },
      ],
      more: false,
    });
    // Mapped now: the next sync finds nothing, so the items go.
    await map(f.slug, "role", "Event Manager (PAYE)", "steward");
    expect(await f.sync()).toMatchObject({ status: "synced" });
    expect(await problemsOf(f.firmId)).toEqual([]);
    expect((await needsOf(f.firmId)).items).toEqual([]);
  });

  it("a skipped name on a session still to come: listed with the session, until it's dealt with", async () => {
    const f = await sheetFirm(SHEET.staff.slice(0, 1), SHEET.shifts.slice(0, 1));
    await map(f.slug, "role", "Door Supervisor (NLW)", "door_supervisor");
    await map(f.slug, "role", "Door Supervisor (LLW)", "door_supervisor");
    expect(await f.sync()).toMatchObject({ status: "synced", shifts: 1 });
    await map(f.slug, "role", "Door Supervisor (LLW)", "skip");
    expect(await f.sync()).toMatchObject({ status: "synced", shifts: 0 });
    const { rows } = await su.query<{ id: string; starts_at: Date; ends_at: Date }>(
      "select id::text as id, starts_at, ends_at from shifts where firm_id = $1",
      [f.firmId],
    );
    const session = rows[0]!;
    expect(await problemsOf(f.firmId)).toEqual([
      {
        kind: "skipped_live",
        tab: "shifts",
        row: 2,
        outside_name: "Door Supervisor (LLW)",
        shift_id: session.id,
      },
    ]);
    expect(await needsOf(f.firmId)).toEqual({
      items: [
        {
          kind: "skipped_live",
          name: "Door Supervisor (LLW)",
          row: 2,
          shiftId: session.id,
          role: "door_supervisor",
          site: null,
          startsAt: session.starts_at,
          endsAt: session.ends_at,
        },
      ],
      more: false,
    });
    // Never another firm's (RLS): a second firm with its own sheet sees none of these.
    const other = await sheetFirm([], []);
    expect(await other.sync()).toMatchObject({ status: "synced" });
    expect((await needsOf(other.firmId)).items).toEqual([]);
    // A failed sync leaves the last list as it was.
    f.fake.failNextRead = "sheet_not_shared";
    expect(await f.sync()).toMatchObject({ status: "failed" });
    expect(await problemsOf(f.firmId)).toHaveLength(1);
    // The office cancels the session: dealt with, so not listed (the next sync drops the row).
    await su.query("update shifts set status = 'cancelled' where id = $1", [session.id]);
    expect((await needsOf(f.firmId)).items).toEqual([]);
    await su.query("update shifts set status = 'open' where id = $1", [session.id]);
    expect((await needsOf(f.firmId)).items).toHaveLength(1);
    // Started: too late to change, so not listed either.
    await su.query("update shifts set starts_at = $2, ends_at = $3 where id = $1", [
      session.id,
      new Date(NOW.getTime() - 3_600_000),
      new Date(NOW.getTime() + 7 * 3_600_000),
    ]);
    expect((await needsOf(f.firmId)).items).toEqual([]);
    await su.query("update shifts set starts_at = $2, ends_at = $3 where id = $1", [
      session.id,
      session.starts_at,
      session.ends_at,
    ]);
    expect((await needsOf(f.firmId)).items).toHaveLength(1);
    // The sheet switched off: nothing from it is listed.
    await su.query("update roster_sources set enabled = false where firm_id = $1", [f.firmId]);
    expect((await needsOf(f.firmId)).items).toEqual([]);
  });

  it("both kinds at once: the names it can't read first, then the skipped ones, soonest first", async () => {
    const f = await sheetFirm(
      [],
      [
        shiftRow({
          ref: "E1",
          date: day,
          start: "09:00",
          end: "17:00",
          role: "Door Supervisor (LLW)",
        }),
        shiftRow({ ref: "E2", date: day, start: "09:00", end: "17:00", role: "Bad (role)" }),
      ],
    );
    await map(f.slug, "role", "Door Supervisor (LLW)", "door_supervisor");
    expect(await f.sync()).toMatchObject({ status: "synced", shifts: 1 });
    await map(f.slug, "role", "Door Supervisor (LLW)", "skip");
    expect(await f.sync()).toMatchObject({ status: "synced", shifts: 0 });
    expect((await needsOf(f.firmId)).items.map((i) => [i.kind, i.row])).toEqual([
      ["unreadable", 3],
      ["skipped_live", 2],
    ]);
  });

  it("past the caps, the skipped names on sessions still to come are kept, and listed last", async () => {
    const bad = Array.from({ length: 205 }, (_, i) =>
      shiftRow({ ref: `B${i + 1}`, date: day, start: "09:00", end: "17:00", role: `Role (${i})` }),
    );
    const f = await sheetFirm(
      [],
      [
        shiftRow({
          ref: "E1",
          date: day,
          start: "09:00",
          end: "17:00",
          role: "Door Supervisor (LLW)",
        }),
        ...bad,
      ],
    );
    await map(f.slug, "role", "Door Supervisor (LLW)", "door_supervisor");
    expect(await f.sync()).toMatchObject({ status: "synced", shifts: 1 });
    await map(f.slug, "role", "Door Supervisor (LLW)", "skip");
    expect(await f.sync()).toMatchObject({ status: "synced", shifts: 0 });
    const kept = await problemsOf(f.firmId);
    expect(kept).toHaveLength(200);
    expect(kept.filter((r) => r.kind === "skipped_live").map((r) => r.row)).toEqual([2]);
    const needs = await needsOf(f.firmId);
    expect([needs.items.length, needs.more]).toEqual([50, true]);
    expect(needs.items.at(-1)).toMatchObject({ kind: "skipped_live", row: 2 });
    expect(needs.items.slice(0, -1).every((i) => i.kind === "unreadable")).toBe(true);
  });

  it("at most 200 a sync; Needs attention shows the first 50 and says there are more", async () => {
    const rows = Array.from({ length: 205 }, (_, i) =>
      shiftRow({ ref: `E${i + 1}`, date: day, start: "09:00", end: "17:00", role: `Role (${i})` }),
    );
    const f = await sheetFirm([], rows);
    expect(await f.sync()).toMatchObject({ status: "synced", shifts: 0 });
    expect(await problemsOf(f.firmId)).toHaveLength(200);
    const needs = await needsOf(f.firmId);
    expect([needs.items.length, needs.more]).toEqual([50, true]);
    expect(needs.items[0]).toEqual({ kind: "unreadable", name: "Role (0)", tab: "shifts", row: 2 });
  });

  it("only the role cell's text, cleaned: no control characters, at most 200 characters", async () => {
    const long = `Steward ${"X".repeat(300)} (NLW)`;
    const f = await sheetFirm(
      [],
      [
        shiftRow({
          ref: "E1",
          date: day,
          start: "09:00",
          end: "17:00",
          role: "Door\u0007 \u00adSup (NLW)",
        }),
        shiftRow({ ref: "E2", date: day, start: "09:00", end: "17:00", role: long }),
        // An empty role cell is a bad role too, but has no name to list.
        shiftRow({ ref: "E3", date: day, start: "09:00", end: "17:00", role: "" }),
        // Nor does one with a phone number typed into it: a bad role, never kept.
        shiftRow({
          ref: "E4",
          date: day,
          start: "09:00",
          end: "17:00",
          role: "Priya (cover) 07700 900123",
        }),
      ],
    );
    expect(await f.sync()).toMatchObject({ status: "synced", shifts: 0 });
    const names = (await problemsOf(f.firmId)).map((r) => [r.row, r.outside_name]);
    expect(names).toEqual([
      [2, "Door Sup (NLW)"],
      [3, Array.from(long).slice(0, 200).join("")],
    ]);
  });
});

const csv = (text: string) => readTable(new TextEncoder().encode(text));

describe("the file import through the map", () => {
  it("workers' and shifts' roles: mapped, skipped (counted as ignored), unreadable (a bad role)", async () => {
    const f = await newFirm();
    await map(f.slug, "role", "Door Supervisor (NLW)", "door_supervisor");
    await map(f.slug, "role", "Holiday", "skip");
    const officeId = await one(
      "insert into office_users (firm_id, email, name, role) values ($1, $2, 'Importer', 'resourcer')",
      [f.firmId, `${f.slug}@example.com`],
    );
    const run = (kind: "workers" | "shifts", text: string) =>
      withFirm(f.firmId, (tx) =>
        runImport(tx, {
          kind,
          rows: csv(text),
          dryRun: false,
          actorId: officeId,
          timeZone: "Europe/London",
          now: NOW,
        }),
      );
    expect(
      await run(
        "workers",
        `Staff ID,First name,Last name,Mobile,Roles
S1,Ada,Example,07700 900501,"Door Supervisor (NLW), Holiday"
S2,Ben,Example,07700 900502,Event Manager (PAYE)`,
      ),
    ).toMatchObject({ created: 1, skipped: 1, problems: [{ row: 3, problem: "bad_role" }] });
    const shifts = await run(
      "shifts",
      `Shift ID,Date,Start,End,Role
E1,07/11/2026,09:00,17:00,door supervisor (nlw)
E2,07/11/2026,09:00,17:00,Holiday
E3,someday,09:00,17:00,HOLIDAY
E4,07/11/2026,09:00,17:00,Event Manager (PAYE)`,
    );
    expect(shifts).toEqual({
      kind: "shifts",
      dryRun: false,
      created: 1,
      updated: 0,
      unchanged: 0,
      skipped: 1,
      ignored: 2,
      problems: [{ row: 5, problem: "bad_role" }],
    });
    expect(await rowsOf(f.firmId)).toEqual({
      workers: [{ external_ref: "S1", roles: ["door_supervisor"] }],
      shifts: [{ external_ref: "E1", role: "door_supervisor" }],
    });
    const { rows } = await su.query(
      "select data from events where firm_id = $1 and action = 'import.completed' order by id",
      [f.firmId],
    );
    expect(rows.map((r) => r.data)).toEqual([
      { kind: "workers", created: 1, updated: 0, unchanged: 0, skipped: 1 },
      { kind: "shifts", created: 1, updated: 0, unchanged: 0, skipped: 1, ignored: 2 },
    ]);
  });

  it("a dry run counts the rows it would leave out, and says so; credentials' types go through it too", async () => {
    const f = await newFirm();
    await su.query(
      "insert into credential_types (firm_id, code, name, sector) values ($1, 'TM_12D', 'NHSS 12D', 'any')",
      [f.firmId],
    );
    await map(f.slug, "role", "Holiday", "skip");
    await map(f.slug, "qualification", "NHSS 12D", "tm_12d");
    await map(f.slug, "qualification", "Induction", "skip");
    const officeId = await one(
      "insert into office_users (firm_id, email, name, role) values ($1, $2, 'Importer', 'resourcer')",
      [f.firmId, `${f.slug}@example.com`],
    );
    const run = (kind: "shifts" | "workers" | "credentials", text: string, dryRun = false) =>
      withFirm(f.firmId, (tx) =>
        runImport(tx, {
          kind,
          rows: csv(text),
          dryRun,
          actorId: officeId,
          timeZone: "Europe/London",
          now: NOW,
        }),
      );
    const dry = await run(
      "shifts",
      `Shift ID,Date,Start,End,Role
E1,07/11/2026,09:00,17:00,steward
E2,07/11/2026,09:00,17:00,Holiday`,
      true,
    );
    expect(dry).toMatchObject({ dryRun: true, created: 1, skipped: 0, ignored: 1 });
    expect(summarise(dry)).toBe(
      "Dry run (nothing saved): would create 1, update 0, leave 0 unchanged, skip 0.\nLeft out 1 row the firm's name map skips (npm run firm:names).",
    );
    expect((await rowsOf(f.firmId)).shifts).toEqual([]);
    await run("workers", "Staff ID,First name,Last name,Mobile\nS1,Ada,Example,07700 900601");
    expect(
      await run(
        "credentials",
        `Staff ID,Type,Expires
S1,NHSS 12D,01/01/2029
S1,Induction,01/01/2029
S1,Chapter 8 (TM),01/01/2029`,
      ),
    ).toMatchObject({ created: 1, ignored: 1, problems: [{ row: 4, problem: "bad_type" }] });
    const { rows } = await su.query("select type from credentials where firm_id = $1", [f.firmId]);
    expect(rows).toEqual([{ type: "TM_12D" }]);
  });

  it("another firm's map is never used: the same file there reads the names as before", async () => {
    const mapped = await newFirm();
    await map(mapped.slug, "role", "Door Supervisor (NLW)", "door_supervisor");
    const plain = await newFirm();
    const officeId = await one(
      "insert into office_users (firm_id, email, name, role) values ($1, $2, 'Importer', 'resourcer')",
      [plain.firmId, `${plain.slug}@example.com`],
    );
    const result = await withFirm(plain.firmId, (tx) =>
      runImport(tx, {
        kind: "shifts",
        rows: csv("Shift ID,Date,Start,End,Role\nE1,07/11/2026,09:00,17:00,Door Supervisor (NLW)"),
        dryRun: false,
        actorId: officeId,
        timeZone: "Europe/London",
        now: NOW,
      }),
    );
    expect(result).toMatchObject({
      created: 0,
      skipped: 1,
      problems: [{ row: 2, problem: "bad_role" }],
    });
  });
});
