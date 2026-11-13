import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { officeSessionTitle } from "@/lib/office/shift-pages";
import { sessionTabTitle } from "@/lib/office/tab-titles";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// A session's browser tab (Phase 37.6, w1-09): officeSessionTitle reads one row, as the office
// session page does (an office login with the "shifts" area, then RLS). Another firm's session, a
// made-up id, another firm's login and a role without the area all get null, and it writes
// nothing. On the real database, as the app role.

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

describe("officeSessionTitle", () => {
  it("names the firm's own session, and nothing else for anyone else", async () => {
    const f = await bookingFirm(su, withFirm);
    const other = await bookingFirm(su, withFirm);
    const token = async (firm: typeof f, role: "admin" | "resourcer" | "payroll") => {
      const id = await firm.office(role);
      return (
        await withFirm(firm.firmId, (tx) =>
          createSession(tx, { kind: "office", subjectId: id, now: NOW }),
        )
      ).token;
    };
    const ctx = { firm: { id: f.firmId }, run: withFirm, clock: { now: () => NOW } };
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });
    const theirs = await other.shift({ startsAt: hoursFromNow(30) });
    const { rows: named } = await su.query<{ name: string | null }>(
      `select e.name from shifts s left join shift_events e
         on e.firm_id = s.firm_id and e.id = s.event_id where s.id = $1`,
      [shiftId],
    );
    const events = async () =>
      Number((await su.query("select count(*) from events")).rows[0]?.count ?? 0);
    const resourcer = await token(f, "resourcer");
    const theirAdmin = await token(other, "admin");
    const payroll = await token(f, "payroll");
    const admin = await token(f, "admin");
    const before = await events();

    const found = await officeSessionTitle(ctx, resourcer, shiftId);
    expect(found).toMatchObject({
      role: "door_supervisor",
      startsAt: hoursFromNow(30),
      timeZone: "Europe/London",
      eventName: named[0]?.name ?? null,
    });
    expect(found?.eventName).toBeTruthy();
    expect(sessionTabTitle(found!)).toBe(
      `Door supervisor, ${sessionTabTitle({ ...found!, eventName: null }).split(", ")[1]} · ${found?.eventName}`,
    );
    // Another firm's session (RLS), a made-up id and a bad one.
    expect(await officeSessionTitle(ctx, resourcer, theirs)).toBeNull();
    expect(
      await officeSessionTitle(ctx, resourcer, "6f9619ff-8b86-4011-b42d-00c04fc964ff"),
    ).toBeNull();
    expect(await officeSessionTitle(ctx, resourcer, "not-a-uuid")).toBeNull();
    // Another firm's office login, and payroll (no "shifts" area).
    expect(await officeSessionTitle(ctx, theirAdmin, shiftId)).toBeNull();
    expect(await officeSessionTitle(ctx, payroll, shiftId)).toBeNull();
    // An admin may.
    expect(await officeSessionTitle(ctx, admin, shiftId)).not.toBeNull();
    // Reads only: no events row.
    expect(await events()).toBe(before);
  });
});
