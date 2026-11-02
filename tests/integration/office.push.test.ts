import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import {
  MAX_BROWSERS_PER_OFFICE_USER,
  removeOfficePushSubscription,
  renewOfficePushSubscription,
  saveOfficePushSubscription,
} from "@/lib/push/office-subscriptions";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// An office user's browsers with notifications on (Phase 26.4; Updates' "Tell me about") on the
// real database, as the app role: saved for an admin or resourcer only, one row per browser (a new
// login on a shared computer takes it over), at most MAX_BROWSERS_PER_OFFICE_USER each, a save that
// writes logged and counted against the person's limit (an unchanged one neither), removed (logged).

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

let n = 0;
const browser = () => {
  n += 1;
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/office-test-${n}-${Date.now()}`,
    keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` },
  };
};

async function firm() {
  const f = await bookingFirm(su, withFirm);
  const ctx = (officeUserId: string, minutes = 0) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock: { now: () => new Date(NOW.getTime() + minutes * 60_000) },
    secret: "test-secret-for-office-push-limits",
  });
  const rows = async () =>
    (
      await su.query<{ office_user_id: string; endpoint: string }>(
        "select office_user_id::text, endpoint from office_push_subscriptions where firm_id = $1 order by created_at, id",
        [f.firmId],
      )
    ).rows;
  const logged = async (action: string) =>
    (await su.query("select 1 from events where firm_id = $1 and action = $2", [f.firmId, action]))
      .rows.length;
  return { f, ctx, rows, logged };
}

describe("an office user's browser for notifications", () => {
  it("saved for an admin or resourcer (logged once), taken over by the next login, removed (logged)", async () => {
    const t = await firm();
    const anna = await t.f.office("resourcer");
    const ben = await t.f.office("admin");
    const pat = await t.f.office("payroll");
    const b = browser();
    expect(await saveOfficePushSubscription(t.ctx(pat), b, { limit: true })).toEqual({
      status: "not_allowed",
    });
    expect(await saveOfficePushSubscription(t.ctx(anna), b, { limit: true })).toEqual({
      status: "saved",
    });
    // The page saves it again on each visit: unchanged, nothing written or logged.
    await saveOfficePushSubscription(t.ctx(anna), b, { limit: true });
    expect(await t.logged("office_push.subscribed")).toBe(1);
    // Ben logs in on the same computer and turns them on: his now.
    await saveOfficePushSubscription(t.ctx(ben), b, { limit: true });
    expect((await t.rows()).map((r) => r.office_user_id)).toEqual([ben]);
    // Anna can't remove Ben's; Ben can.
    expect(await removeOfficePushSubscription(t.ctx(anna), b.endpoint)).toEqual({
      status: "not_found",
    });
    expect(await removeOfficePushSubscription(t.ctx(ben), b.endpoint)).toEqual({
      status: "removed",
    });
    expect(await t.rows()).toEqual([]);
    expect(await t.logged("office_push.unsubscribed")).toBe(1);
  });

  it(`at most ${MAX_BROWSERS_PER_OFFICE_USER} each (the oldest go); a save that writes counts against the limit`, async () => {
    const t = await firm();
    const anna = await t.f.office("resourcer");
    const saved = [];
    for (let i = 0; i < MAX_BROWSERS_PER_OFFICE_USER + 1; i++) {
      const b = browser();
      saved.push(b.endpoint);
      // A minute apart, so "oldest" is clear.
      expect((await saveOfficePushSubscription(t.ctx(anna, i), b, { limit: true })).status).toBe(
        "saved",
      );
    }
    expect((await t.rows()).map((r) => r.endpoint)).toEqual(saved.slice(1));
    // 10 saves that write every 15 minutes (6 so far): the 11th is refused, with how long to wait.
    for (let i = 0; i < 4; i++) {
      expect(
        (await saveOfficePushSubscription(t.ctx(anna, 7), browser(), { limit: true })).status,
      ).toBe("saved");
    }
    expect(
      await saveOfficePushSubscription(t.ctx(anna, 8), browser(), { limit: true }),
    ).toMatchObject({
      status: "rate_limited",
    });
    // Removing is never limited.
    expect(
      (await removeOfficePushSubscription(t.ctx(anna, 8), (await t.rows())[0]?.endpoint ?? ""))
        .status,
    ).toBe("removed");
  });

  it("a renewal (the service worker, or the page checking) changes only a browser already theirs", async () => {
    const t = await firm();
    const anna = await t.f.office("resourcer");
    const ben = await t.f.office("resourcer");
    const old = browser();
    // Not Anna's (nobody's yet: a casual's, say): left alone.
    expect(
      await renewOfficePushSubscription(t.ctx(anna), old.endpoint, old, { limit: true }),
    ).toEqual({ status: "not_found" });
    expect(await t.rows()).toEqual([]);
    await saveOfficePushSubscription(t.ctx(anna), old, { limit: true });
    // The page checking it, unchanged: nothing written or logged.
    expect(
      await renewOfficePushSubscription(t.ctx(anna), old.endpoint, old, { limit: true }),
    ).toEqual({ status: "saved" });
    expect(await t.logged("office_push.subscribed")).toBe(1);
    // Ben's session can't renew Anna's.
    const renewed = browser();
    expect(
      await renewOfficePushSubscription(t.ctx(ben), old.endpoint, renewed, { limit: true }),
    ).toEqual({ status: "not_found" });
    // The browser renewed it: Anna's row moves to the new address and keys (logged).
    expect(
      await renewOfficePushSubscription(t.ctx(anna), old.endpoint, renewed, { limit: true }),
    ).toEqual({ status: "saved" });
    expect((await t.rows()).map((r) => [r.office_user_id, r.endpoint])).toEqual([
      [anna, renewed.endpoint],
    ]);
    expect(await t.logged("office_push.subscribed")).toBe(2);
  });

  it("taking over the oldest of a full set makes it the newest; each one dropped is logged", async () => {
    const t = await firm();
    const anna = await t.f.office("resourcer");
    const ben = await t.f.office("resourcer");
    const shared = browser();
    await saveOfficePushSubscription(t.ctx(ben, 0), shared, { limit: true });
    for (let i = 1; i <= MAX_BROWSERS_PER_OFFICE_USER; i++) {
      await saveOfficePushSubscription(t.ctx(anna, i), browser(), { limit: true });
    }
    // Anna logs in on Ben's old computer: it's hers now, her newest, so her oldest goes (logged).
    await saveOfficePushSubscription(t.ctx(anna, 9), shared, { limit: true });
    const hers = (await t.rows()).filter((r) => r.office_user_id === anna).map((r) => r.endpoint);
    expect(hers).toHaveLength(MAX_BROWSERS_PER_OFFICE_USER);
    expect(hers).toContain(shared.endpoint);
    expect(await t.logged("office_push.forgotten")).toBe(1);
  });
});
