import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/lib/auth/sessions";
import { currentWorker } from "@/lib/auth/worker-login";
import { seed } from "@/lib/db/admin/seed";
import { withFirm } from "@/lib/db/scoped";
import { seedId } from "@/lib/demo/seed-id";
import { DEMO_CASUAL_ID, STAFF_DEMO_FIRM_ID } from "@/lib/demo/staff-login";
import { openCasualView } from "@/lib/demo/staff-session";
import { markCasualTourSeen } from "@/lib/tour/seen";
import { superuserPool, urls } from "../helpers/db";

// The demo's "Casual mobile view" (Phase 31.2) and the casuals' first-login tour (Phase 33.3), on
// the real database as the app role: the view is an office user's look at Zoe's app through a
// casual's session for her, so finishing or skipping the tour there leaves Zoe's tour_seen_at as it
// was and logs nothing as her. The same call from Zoe's own session (her login) marks it. The view's
// session is told apart by the auth.demo_casual_view entry openCasualView writes with it.

const ACME = STAFF_DEMO_FIRM_ID;
let su: Pool;

const zoeSeenAt = async () =>
  (
    await su.query<{ at: Date | null }>("select tour_seen_at as at from workers where id = $1", [
      DEMO_CASUAL_ID,
    ])
  ).rows[0]?.at ?? null;

const zoeTourEvents = async () =>
  (
    await su.query<{ action: string }>(
      `select action from events
        where firm_id = $1 and action like 'tour.%' and actor_type = 'worker' and actor_id = $2
        order by id`,
      [ACME, DEMO_CASUAL_ID],
    )
  ).rows;

const forgetZoesTour = async () => {
  await su.query("update workers set tour_seen_at = null where id = $1", [DEMO_CASUAL_ID]);
  await su.query(
    "delete from events where firm_id = $1 and action like 'tour.%' and actor_id = $2",
    [ACME, DEMO_CASUAL_ID],
  );
};

beforeAll(async () => {
  su = superuserPool();
  await seed({ adminUrl: urls.admin, appUrl: urls.app, nodeEnv: "test" });
  await forgetZoesTour();
});
afterAll(async () => {
  await forgetZoesTour();
  await su.end();
});

describe("the demo's Casual mobile view", () => {
  it("finishing or skipping the tour there marks nothing and logs nothing as Zoe", async () => {
    const resourcer = seedId("acme/office/resourcer");
    const office = await withFirm(ACME, (tx) =>
      createSession(tx, { kind: "office", subjectId: resourcer, now: new Date() }),
    );
    const view = await openCasualView(
      { firm: { id: ACME }, clientIp: "10.33.3.1", demoMode: "on" },
      office.token,
    );
    expect(view.status).toBe("ok");
    if (view.status !== "ok") return;
    // A casual's session for Zoe, as the iframe on /start/phone uses.
    const seenAs = await currentWorker({ firm: { id: ACME } }, view.token);
    expect(seenAs?.worker.id).toBe(DEMO_CASUAL_ID);
    expect(seenAs?.tourSeen).toBe(false);
    const viewSession = seenAs?.session.id ?? "";

    for (const outcome of ["finished", "skipped"] as const)
      expect(
        await markCasualTourSeen({ firm: { id: ACME } }, DEMO_CASUAL_ID, outcome, viewSession),
      ).toBe("demo_view");
    expect(await zoeSeenAt()).toBeNull();
    expect(await zoeTourEvents()).toEqual([]);
    // Still unseen as the view reads it: it opens for the next person who looks.
    expect((await currentWorker({ firm: { id: ACME } }, view.token))?.tourSeen).toBe(false);
  });

  it("Zoe's own session (her login) still marks it, once", async () => {
    const own = await withFirm(ACME, (tx) =>
      createSession(tx, { kind: "worker", subjectId: DEMO_CASUAL_ID, now: new Date() }),
    );
    expect(
      await markCasualTourSeen({ firm: { id: ACME } }, DEMO_CASUAL_ID, "skipped", own.id),
    ).toBe("marked");
    expect(await zoeSeenAt()).not.toBeNull();
    expect(await zoeTourEvents()).toEqual([{ action: "tour.skipped" }]);
  });
});
