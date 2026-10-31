import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { qualificationsFor } from "@/lib/credentials/qualifications";
import { readRequirements } from "@/lib/credentials/requirements";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { loadExpiredOnBookings } from "@/lib/office/dashboard";
import { shiftFacts } from "@/lib/portal/shift-facts";
import { bookShift, previewBookings } from "@/lib/roster/book";
import { pairKey } from "@/lib/roster/eligibility-input";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// "Any of" licences (P3.3, Rules 3, Dylan 2026-10-29): a security officer's shift takes an SIA
// security guard or door supervisor licence, the security pack's default. On the real database as
// the app role: the pack's rule and the database's checks, booking through the rules engine one at
// a time and in a batch, what a session shows and what a casual may send, a casual's
// qualifications, and the office's check of bookings whose licence won't be in date.

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

const at = (d: Date) => ({ now: () => d });
const officer = { roles: ["security_officer"] };

async function officerFirm() {
  const f = await bookingFirm(su, withFirm);
  const book = (shiftId: string, workerId: string) =>
    bookShift(
      withFirm,
      f.firmId,
      { shiftId, workerId, by: { type: "worker", id: workerId } },
      { clock: at(NOW) },
    );
  return { ...f, book };
}

describe("the security pack's rule", () => {
  it("a security officer needs one of an SIA security guard or door supervisor licence", async () => {
    const f = await officerFirm();
    const { rows } = await su.query(
      "select required_types, any_of_types from credential_rules where firm_id = $1 and role = 'security_officer'",
      [f.firmId],
    );
    expect(rows).toEqual([{ required_types: [], any_of_types: ["SIA_SG", "SIA_DS"] }]);
    // Rules without a group are as they were.
    const { rows: ds } = await su.query(
      "select required_types, any_of_types from credential_rules where firm_id = $1 and role = 'door_supervisor'",
      [f.firmId],
    );
    expect(ds).toEqual([{ required_types: ["SIA_DS"], any_of_types: [] }]);
  });

  it("the database refuses a group of one, a type in both lists, or a code that isn't one", async () => {
    const f = await officerFirm();
    for (const [required, group] of [
      ["{}", "{SIA_SG}"],
      ["{SIA_DS}", "{SIA_SG,SIA_DS}"],
      ["{}", "{sia_sg,SIA_DS}"],
      ["{}", "{SIA_SG,''}"],
    ]) {
      await expect(
        su.query(
          `insert into credential_rules (firm_id, sector, role, required_types, any_of_types)
           values ($1, 'security', 'probe_role', $2, $3)`,
          [f.firmId, required, group],
        ),
        `${required} ${group}`,
      ).rejects.toMatchObject({ code: "23514" }); // check_violation
    }
  });
});

describe("booking through the rules", () => {
  it("a door supervisor licence lets a security officer take the shift; either will do; neither won't", async () => {
    const f = await officerFirm();
    const shift = () => f.shift({ role: "security_officer", startsAt: hoursFromNow(48) });
    const ds = await f.worker({
      ...officer,
      credentials: [{ type: "SIA_DS", expiresOn: "2029-01-01" }],
    });
    const sg = await f.worker({
      ...officer,
      credentials: [{ type: "SIA_SG", expiresOn: "2029-01-01" }],
    });
    const none = await f.worker({ ...officer, credentials: [] });
    const out = await f.worker({
      ...officer,
      credentials: [{ type: "SIA_DS", status: "expired", expiresOn: "2026-01-01" }],
    });
    expect(await f.book(await shift(), ds)).toMatchObject({ status: "booked" });
    expect(await f.book(await shift(), sg)).toMatchObject({ status: "booked" });
    // Holding neither, she's told either will do (Phase 25.2).
    expect(await f.book(await shift(), none)).toMatchObject({
      status: "not_eligible",
      codes: ["credential_missing"],
      reasons: [
        "This shift needs a valid SIA security guard licence or SIA door supervisor licence. Send one to the office to be checked.",
      ],
    });
    expect(await f.book(await shift(), out)).toMatchObject({
      status: "not_eligible",
      codes: ["credential_expired"],
    });
  });

  it("the batch the offer waves use reads the group the same way", async () => {
    const f = await officerFirm();
    const shiftId = await f.shift({ role: "security_officer", startsAt: hoursFromNow(48) });
    const ds = await f.worker({
      ...officer,
      credentials: [{ type: "SIA_DS", expiresOn: "2029-01-01" }],
    });
    const none = await f.worker({ ...officer, credentials: [] });
    const verdicts = await withFirm(f.firmId, (tx) =>
      previewBookings(tx, { shiftIds: [shiftId], workerIds: [ds, none], now: NOW }),
    );
    expect(verdicts.get(pairKey(shiftId, ds))).toMatchObject({ ok: true });
    expect(verdicts.get(pairKey(shiftId, none))).toMatchObject({
      ok: false,
      codes: ["credential_missing"],
    });
  });
});

describe("what a session shows, and what a casual may send", () => {
  it("the group shows as its first type until its words are approved; either type may be sent", async () => {
    const f = await officerFirm();
    const reader = await withFirm(f.firmId, (tx) =>
      readRequirements(tx, ["security_officer", "door_supervisor"]),
    );
    expect(reader.of("security_officer", []).map((r) => r.code)).toEqual(["SIA_SG"]);
    expect(reader.of("door_supervisor", []).map((r) => r.code)).toEqual(["SIA_DS"]);
    expect(reader.rolesNeed(["security_officer"], "SIA_DS")).toBe(true);
    expect(reader.rolesNeed(["security_officer"], "SIA_SG")).toBe(true);
    expect(reader.rolesNeed(["security_officer"], "SIA_CP")).toBe(false);
  });

  it("a casual's own shift page shows the licence of the group that stands best for her", async () => {
    const f = await officerFirm();
    const shiftId = await f.shift({ role: "security_officer", startsAt: hoursFromNow(48) });
    const session = {
      role: "security_officer",
      endsAt: hoursFromNow(56),
      requiredCredentials: [] as string[],
      eventName: null,
      payRatePence: null,
      post: null,
      meetingPoint: null,
      uniform: null,
      isUrgent: false,
      headcount: 1,
    };
    const shown = async (workerId: string, extras: string[] = []) =>
      (
        await withFirm(f.firmId, (tx) =>
          shiftFacts(tx, {
            shiftId,
            workerId,
            now: NOW,
            session: { ...session, requiredCredentials: extras },
          }),
        )
      ).requirements.map((r) => [r.code, r.status.status]);
    const ds = await f.worker({
      ...officer,
      credentials: [{ type: "SIA_DS", expiresOn: "2029-01-01" }],
    });
    const none = await f.worker({ ...officer, credentials: [] });
    // Never "SIA security guard licence: missing" for a door supervisor licence holder.
    expect(await shown(ds)).toEqual([["SIA_DS", "valid"]]);
    expect(await shown(none)).toEqual([["SIA_SG", "missing"]]);
    // A session that asks for the security guard licence itself: shown, as it must be held.
    expect(await shown(ds, ["SIA_SG"])).toEqual([["SIA_SG", "missing"]]);

    // Holding neither (Phase 25.2): the group says "A or B", and she may send either.
    const facts = (workerId: string, extras: string[] = []) =>
      withFirm(f.firmId, (tx) =>
        shiftFacts(tx, {
          shiftId,
          workerId,
          now: NOW,
          session: { ...session, requiredCredentials: extras },
        }),
      );
    const neither = (await facts(none)).requirements;
    expect(neither).toHaveLength(1);
    expect(neither[0]).toMatchObject({
      code: "SIA_SG",
      name: "SIA security guard licence or SIA door supervisor licence",
      chip: "SIA SG or SIA DS",
      uploadable: true,
      anyOf: [
        { code: "SIA_SG", name: "SIA security guard licence", chip: "SIA SG", uploadable: true },
        { code: "SIA_DS", name: "SIA door supervisor licence", chip: "SIA DS", uploadable: true },
      ],
    });
    // Holding one, just that one, as before; and a session asking for one outright isn't a choice.
    expect((await facts(ds)).requirements[0]?.anyOf).toBeUndefined();
    expect((await facts(none, ["SIA_SG"])).requirements.map((r) => r.anyOf)).toEqual([undefined]);
    // A session asking outright for the group's other type: that one must be held, so not "A or B".
    expect((await facts(none, ["SIA_DS"])).requirements.map((r) => [r.code, r.anyOf])).toEqual([
      ["SIA_SG", undefined],
      ["SIA_DS", undefined],
    ]);
    // One applied for, the other missing: she holds one, so it's that one's status, not "A or B".
    const applied = await f.worker({
      ...officer,
      credentials: [{ type: "SIA_DS", status: "applied", expiresOn: null }],
    });
    expect((await facts(applied)).requirements).toMatchObject([
      { code: "SIA_DS", status: { status: "applied" } },
    ]);
    expect((await facts(applied)).requirements[0]?.anyOf).toBeUndefined();
    // Holding the group's first type (the one shown in its place): that one, never "A or B".
    const sg = await f.worker({
      ...officer,
      credentials: [{ type: "SIA_SG", expiresOn: "2029-01-01" }],
    });
    expect((await facts(sg)).requirements).toMatchObject([
      { code: "SIA_SG", name: "SIA security guard licence", status: { status: "valid" } },
    ]);
    expect((await facts(sg)).requirements[0]?.anyOf).toBeUndefined();

    // The strike note follows the firm's strikes switch (P3.4; Phase 25.2).
    expect((await facts(ds)).strikesOn).toBe(true);
    await su.query(
      `update firms set settings = jsonb_set(settings, '{strikes}',
         coalesce(settings->'strikes', '{}'::jsonb) || '{"enabled": false}'::jsonb) where id = $1`,
      [f.firmId],
    );
    expect((await facts(ds)).strikesOn).toBe(false);
  });

  it("a casual's qualifications list the licence of the group that stands best for her", async () => {
    const f = await officerFirm();
    const ds = await f.worker({
      ...officer,
      credentials: [{ type: "SIA_DS", expiresOn: "2029-01-01" }],
    });
    const none = await f.worker({ ...officer, credentials: [] });
    const both = await f.worker({
      ...officer,
      credentials: [
        { type: "SIA_SG", status: "expired", expiresOn: "2026-01-01" },
        { type: "SIA_DS", expiresOn: "2029-01-01" },
      ],
    });
    const q = await withFirm(f.firmId, (tx) =>
      qualificationsFor(tx, [ds, none, both], { now: NOW, timeZone: "Europe/London" }),
    );
    const listed = (id: string) => (q.get(id)?.qualifications ?? []).map((x) => [x.type, x.status]);
    expect(listed(ds)).toEqual([["SIA_DS", "valid"]]);
    expect(listed(none)).toEqual([["SIA_SG", "missing"]]);
    // Not told to renew the security guard licence she doesn't need.
    expect(listed(both)).toEqual([["SIA_DS", "valid"]]);
    expect(q.get(both)?.needs).toEqual([]);
  });
});

describe("the office's check of bookings whose licence won't be in date", () => {
  it("flags a booked security officer only when no licence of the group will be in date", async () => {
    const f = await officerFirm();
    const start = hoursFromNow(72); // Thu 5 Nov 2026
    const covered = await f.worker({
      ...officer,
      first: "Covered",
      credentials: [
        { type: "SIA_DS", expiresOn: "2026-11-03" },
        { type: "SIA_SG", expiresOn: "2029-01-01" },
      ],
    });
    const lapsing = await f.worker({
      ...officer,
      first: "Lapsing",
      credentials: [{ type: "SIA_DS", expiresOn: "2026-11-03" }],
    });
    for (const w of [covered, lapsing]) {
      await f.booking(w, await f.shift({ role: "security_officer", startsAt: start }));
    }
    const { items } = await withFirm(f.firmId, (tx) =>
      loadExpiredOnBookings(tx, NOW, "Europe/London"),
    );
    expect(items.map((i) => [i.workerId, i.type])).toEqual([[lapsing, "SIA_DS"]]);
  });
});
