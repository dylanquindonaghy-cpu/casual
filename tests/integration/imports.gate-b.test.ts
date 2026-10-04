import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { AgreementNotRecorded } from "@/lib/imports/gate-b";
import { runImport } from "@/lib/imports/import";
import { readTable } from "@/lib/imports/table";
import { firmReadiness } from "@/lib/onboarding/readiness";
import { importShiftsFile } from "@/lib/office/shift-import";
import { firmAgreement, signingDay } from "../../scripts/firm-agreement-owner";
import { connectSheet } from "../../scripts/firm-sheet-owner";
import { appRolePool, superuserPool, uniqueSlug, urls } from "../helpers/db";

// Gate B, recorded (audit L39): on a live database (anything not on this machine), no real staff
// data goes in for a firm until its agreement and DPA are recorded as signed (`npm run
// firm:agreement`): the office's web imports, the terminal import (both through runImport) and
// the owner's `firm:sheet` all check it. The test database is local, so each test says "act as on
// a live one" (localDatabase: false), as the live server decides from its database address.

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

const NOW = new Date("2026-11-06T09:00:00Z");
const SHIFTS = "Shift ID,Date,Start,End,Role\nG1,07/11/2026,09:00,17:00,steward";
const bytes = (text: string) => new TextEncoder().encode(text);

async function newFirm() {
  const slug = uniqueSlug("gb");
  const { rows } = await su.query<{ id: string }>(
    "insert into firms (name, slug, sector) values ($1, $2, 'security') returning id::text as id",
    [`Gate B Test ${slug}`, slug],
  );
  const firmId = rows[0]?.id ?? "";
  const { rows: office } = await su.query<{ id: string }>(
    `insert into office_users (firm_id, email, name, role) values ($1, $2, 'Admin', 'admin')
     returning id::text as id`,
    [firmId, `${slug}@example.com`],
  );
  const officeId = office[0]?.id ?? "";
  const ctx = (localDatabase: boolean) => ({
    firm: { id: firmId },
    officeUserId: officeId,
    run: withFirm,
    clock: { now: () => NOW },
    localDatabase,
  });
  const shifts = async () =>
    (await su.query("select count(*)::int as n from shifts where firm_id = $1", [firmId])).rows[0]
      ?.n;
  return { slug, firmId, officeId, ctx, shifts };
}

describe("the office's web import on a live database", () => {
  it("saves nothing until the agreement is recorded; a check still works; then it imports", async () => {
    const f = await newFirm();
    expect(await importShiftsFile(f.ctx(false), bytes(SHIFTS), false)).toEqual({
      status: "agreement_needed",
    });
    expect(await f.shifts()).toBe(0);
    // A check (nothing saved) works as before.
    expect(await importShiftsFile(f.ctx(false), bytes(SHIFTS), true)).toMatchObject({
      status: "done",
      result: { dryRun: true, created: 1 },
    });
    expect(await f.shifts()).toBe(0);

    expect(await firmAgreement(urls.admin, f.slug, "2026-10-04")).toEqual({
      status: "recorded",
      signedOn: "2026-10-04",
      was: null,
    });
    expect(await importShiftsFile(f.ctx(false), bytes(SHIFTS), false)).toMatchObject({
      status: "done",
      result: { dryRun: false, created: 1 },
    });
    expect(await f.shifts()).toBe(1);
  });

  it("on this machine (development, tests) nothing is asked", async () => {
    const f = await newFirm();
    expect(await importShiftsFile(f.ctx(true), bytes(SHIFTS), false)).toMatchObject({
      status: "done",
      result: { created: 1 },
    });
  });
});

describe("the terminal import (npm run import, through runImport) on a live database", () => {
  it("refuses to save until the agreement is recorded", async () => {
    const f = await newFirm();
    const run = (dryRun: boolean) =>
      withFirm(f.firmId, (tx) =>
        runImport(tx, {
          kind: "shifts",
          rows: readTable(bytes(SHIFTS)),
          dryRun,
          actorId: f.officeId,
          timeZone: "Europe/London",
          now: NOW,
          via: "cli",
          localDatabase: false,
        }),
      );
    await expect(run(false)).rejects.toBeInstanceOf(AgreementNotRecorded);
    expect(await f.shifts()).toBe(0);
    expect(await run(true)).toMatchObject({ dryRun: true, created: 1 });
    await firmAgreement(urls.admin, f.slug, "2026-10-01");
    expect(await run(false)).toMatchObject({ dryRun: false, created: 1 });
  });
});

describe("npm run firm:sheet on a live database", () => {
  it("connects a firm's sheet only once its agreement is recorded", async () => {
    const f = await newFirm();
    const sheet = `test_${randomBytes(30).toString("base64url")}`.slice(0, 44);
    const connect = () =>
      connectSheet(urls.admin, f.slug, {
        spreadsheetId: sheet,
        replace: false,
        localDatabase: false,
      });
    expect(await connect()).toEqual({ status: "agreement_needed" });
    const { rows } = await su.query("select 1 from roster_sources where firm_id = $1", [f.firmId]);
    expect(rows).toEqual([]);
    await firmAgreement(urls.admin, f.slug, "2026-10-01");
    expect(await connect()).toEqual({ status: "connected", replaced: false });
  });
});

describe("npm run firm:agreement", () => {
  it("records the day, logged (a date only), shows it, and the onboarding checklist counts it done", async () => {
    const f = await newFirm();
    const item = async () =>
      (await withFirm(f.firmId, (tx) => firmReadiness(tx))).find(
        (i) => i.item === "Agreement + DPA signed",
      );
    expect(await item()).toMatchObject({ state: "todo" });
    expect(await firmAgreement(urls.admin, f.slug, null)).toEqual({
      status: "shown",
      signedOn: null,
    });
    expect(await firmAgreement(urls.admin, f.slug, "2026-10-01")).toEqual({
      status: "recorded",
      signedOn: "2026-10-01",
      was: null,
    });
    expect(await firmAgreement(urls.admin, f.slug, "2026-10-01")).toEqual({
      status: "unchanged",
      signedOn: "2026-10-01",
    });
    expect(await firmAgreement(urls.admin, f.slug, "2026-10-02")).toEqual({
      status: "recorded",
      signedOn: "2026-10-02",
      was: "2026-10-01",
    });
    expect(await item()).toEqual({
      item: "Agreement + DPA signed",
      state: "done",
      detail: "Recorded as signed on Fri 2 Oct 2026.",
    });
    const { rows } = await su.query(
      "select data, actor_type from events where firm_id = $1 and action = 'firm.agreement_recorded' order by id",
      [f.firmId],
    );
    expect(rows.slice(0, 2)).toEqual([
      { data: { signedOn: "2026-10-01" }, actor_type: "system" },
      { data: { signedOn: "2026-10-02", was: "2026-10-01" }, actor_type: "system" },
    ]);
    // Recorded on the wrong firm: removed, logged, and the firm is back to "not recorded".
    expect(await firmAgreement(urls.admin, f.slug, "clear")).toEqual({
      status: "cleared",
      was: "2026-10-02",
    });
    expect(await item()).toMatchObject({ state: "todo" });
    expect((await item())?.detail).toContain(`--firm ${f.slug} --signed`);
    expect(await firmAgreement(urls.admin, f.slug, "clear")).toEqual({
      status: "shown",
      signedOn: null,
    });
    expect(await firmAgreement(urls.admin, uniqueSlug("none"), "2026-10-01")).toEqual({
      status: "no_firm",
    });
  });

  it.each([
    ["04/10/2026", "2026-10-04"],
    ["4/10/2026", "2026-10-04"],
    ["2026-10-04", "2026-10-04"],
    ["05/10/2026", null], // in the future
    ["31/09/2026", null], // not a day
    ["10/04/2026 ", "2026-04-10"],
    ["2025-12-31", null], // before there were any firms
    ["yesterday", null],
  ])("the day %j is %j", (raw, expected) => {
    expect(signingDay(raw, "2026-10-04")).toBe(expected);
  });
});
