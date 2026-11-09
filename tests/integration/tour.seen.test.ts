import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { eraseWorker } from "@/lib/gdpr/worker-erase";
import { markCasualTourSeen, markOfficeTourSeen, TOUR_ACTIONS } from "@/lib/tour/seen";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The first-login tours' "seen" (Phase 33.1) on the real database, as the app role: each person's
// own row only, set the first time and logged with ids only, never again (idempotent); another
// firm's person can't be reached; a casual's is cleared when she's erased.

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

const seenAt = async (table: "office_users" | "workers", id: string) =>
  (
    await su.query<{ at: Date | null }>(`select tour_seen_at as at from ${table} where id = $1`, [
      id,
    ])
  ).rows[0]?.at ?? null;

const tourEvents = async (firmId: string) =>
  (
    await su.query<{
      action: string;
      actor_type: string;
      actor_id: string;
      entity_type: string;
      entity_id: string;
      data: Record<string, unknown>;
    }>(
      `select action, actor_type, actor_id::text, entity_type, entity_id::text, data
         from events where firm_id = $1 and action like 'tour.%' order by id`,
      [firmId],
    )
  ).rows;

describe("an office user's tour", () => {
  it("marks their own row, logs it with ids only, and only the first time", async () => {
    const f = await bookingFirm(su, withFirm);
    const me = await f.office("admin");
    const colleague = await f.office("resourcer");
    expect(await seenAt("office_users", me)).toBeNull();

    expect(await markOfficeTourSeen({ firm: { id: f.firmId }, run: withFirm }, me, "skipped")).toBe(
      "marked",
    );
    const first = await seenAt("office_users", me);
    expect(first).not.toBeNull();
    // Nobody else's row.
    expect(await seenAt("office_users", colleague)).toBeNull();
    expect(await tourEvents(f.firmId)).toEqual([
      {
        action: TOUR_ACTIONS.skipped,
        actor_type: "office",
        actor_id: me,
        entity_type: "office_user",
        entity_id: me,
        data: { kind: "office" },
      },
    ]);

    // Again (taking it again and finishing it): nothing changes, nothing more is logged.
    expect(
      await markOfficeTourSeen({ firm: { id: f.firmId }, run: withFirm }, me, "finished"),
    ).toBe("already");
    expect(await seenAt("office_users", me)).toEqual(first);
    expect(await tourEvents(f.firmId)).toHaveLength(1);
  });

  it("can't reach another firm's office user (row security), and logs nothing either side", async () => {
    const a = await bookingFirm(su, withFirm);
    const b = await bookingFirm(su, withFirm);
    const theirs = await b.office("admin");
    expect(
      await markOfficeTourSeen({ firm: { id: a.firmId }, run: withFirm }, theirs, "finished"),
    ).toBe("not_found");
    expect(await seenAt("office_users", theirs)).toBeNull();
    expect(await tourEvents(a.firmId)).toEqual([]);
    expect(await tourEvents(b.firmId)).toEqual([]);
  });
});

describe("only for the roles the tour is offered to (a dashboard)", () => {
  it("payroll, and a switched-off account: refused, nothing written, nothing logged", async () => {
    const f = await bookingFirm(su, withFirm);
    const payroll = await f.office("payroll");
    const off = await f.office("resourcer", "disabled");
    for (const id of [payroll, off]) {
      expect(
        await markOfficeTourSeen({ firm: { id: f.firmId }, run: withFirm }, id, "finished"),
      ).toBe("not_allowed");
      expect(await seenAt("office_users", id)).toBeNull();
    }
    expect(await tourEvents(f.firmId)).toEqual([]);
  });
});

describe("a casual's tour", () => {
  it("marks her own row, logged with ids only, once; another firm can't reach her", async () => {
    const f = await bookingFirm(su, withFirm);
    const other = await bookingFirm(su, withFirm);
    const zoe = await f.worker();
    const ann = await f.worker();
    expect(
      await markCasualTourSeen({ firm: { id: other.firmId }, run: withFirm }, zoe, "finished"),
    ).toBe("not_found");
    expect(await seenAt("workers", zoe)).toBeNull();

    expect(
      await markCasualTourSeen({ firm: { id: f.firmId }, run: withFirm }, zoe, "finished"),
    ).toBe("marked");
    expect(
      await markCasualTourSeen({ firm: { id: f.firmId }, run: withFirm }, zoe, "skipped"),
    ).toBe("already");
    expect(await seenAt("workers", zoe)).not.toBeNull();
    expect(await seenAt("workers", ann)).toBeNull();
    expect(await tourEvents(f.firmId)).toEqual([
      {
        action: TOUR_ACTIONS.finished,
        actor_type: "worker",
        actor_id: zoe,
        entity_type: "worker",
        entity_id: zoe,
        data: { kind: "casual" },
      },
    ]);
    expect(await tourEvents(other.firmId)).toEqual([]);
  });

  it("is cleared when she's erased, and an erased casual can't be marked", async () => {
    const f = await bookingFirm(su, withFirm);
    const admin = await f.office("admin");
    const zoe = await f.worker();
    await markCasualTourSeen({ firm: { id: f.firmId }, run: withFirm }, zoe, "finished");
    expect(await seenAt("workers", zoe)).not.toBeNull();
    const erased = await eraseWorker(
      { firm: { id: f.firmId }, officeUserId: admin, run: withFirm },
      zoe,
    );
    expect(erased).toMatchObject({ status: "erased" });
    expect(await seenAt("workers", zoe)).toBeNull();
    expect(
      await markCasualTourSeen({ firm: { id: f.firmId }, run: withFirm }, zoe, "skipped"),
    ).toBe("not_found");
    expect(await seenAt("workers", zoe)).toBeNull();
  });
});
