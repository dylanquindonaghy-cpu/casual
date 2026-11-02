import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Clock } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { saveContract, saveMyDashboard } from "@/lib/office/contracts";
import { saveTellMe } from "@/lib/office/tell-me";
import {
  loadUpdatesBell,
  markUpdatesSeen,
  officeUpdatesPage,
  type PageUpdate,
} from "@/lib/office/updates";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Updates (Phase 26.4; the spec page's upd-1 to upd-3 and sys-8's bell) on the real database, as
// the app role: the week's updates with what needs action first (a cancellation whose place is open
// again, a place still open near its start, an upload to check) and everything else after; narrowed
// to the person's contracts; the bell's count since they last opened Updates, marked as of when the
// page was drawn and only ever forward; the pop-up's recent cancellations; who may see it; and
// another firm's rows never shown or counted. NOW is Monday 2 November 2026, 09:00 London.

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

const clockAt = (d: Date): Clock => ({ now: () => d });
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

async function site(f: BookingFirm, name: string): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, $2) returning id::text as id",
    [f.firmId, name],
  );
  return rows[0]?.id ?? "";
}
const atSite = (shiftId: string, siteId: string) =>
  su.query("update shifts set site_id = $2 where id = $1", [shiftId, siteId]);

// A casual's cancellation `at`, with `notice` hours' notice.
async function cancelled(f: BookingFirm, workerId: string, shiftId: string, at: Date, notice = 9) {
  const id = await f.booking(workerId, shiftId, "cancelled_worker");
  await su.query("update assignments set cancelled_at = $2, notice_hours = $3 where id = $1", [
    id,
    at,
    notice,
  ]);
  return id;
}
// A place a casual took `at` (their offer accepted, and the booking).
async function took(f: BookingFirm, workerId: string, shiftId: string, at: Date) {
  await su.query(
    `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at, response, responded_at)
     values ($1, $2, $3, 1, 'whatsapp', $4, 'accepted', $5)`,
    [f.firmId, shiftId, workerId, new Date(at.getTime() - 600_000), at],
  );
  await f.booking(workerId, shiftId, "confirmed");
}
async function upload(f: BookingFirm, workerId: string, at: Date) {
  await su.query(
    `insert into uploads (firm_id, worker_id, kind, content_type, size, sha256, data, created_at)
     values ($1, $2, 'photo', 'image/jpeg', 3, encode(sha256('\\xffd8ff'::bytea), 'hex'),
             '\\xffd8ff'::bytea, $3)`,
    [f.firmId, workerId, at],
  );
}

const kinds = (items: PageUpdate[]) =>
  items.map((u) =>
    u.kind === "open-soon"
      ? `open-soon ${u.shiftId}`
      : u.kind === "cancelled"
        ? `cancelled ${u.ref}`
        : u.kind === "took"
          ? `took ${u.shiftId}`
          : u.kind,
  );

// One firm's week: an arena (on a contract later) and a depot. NOW is 09:00 on Monday 2 November.
async function week() {
  const f = await bookingFirm(su, withFirm);
  const admin = await f.office("admin");
  const resourcer = await f.office("resourcer");
  const payroll = await f.office("payroll");
  const arena = await site(f, "Arena");
  const depot = await site(f, "Depot");
  const [mo, ben, zoe, kim] = [
    await f.worker({ first: "Mo" }),
    await f.worker({ first: "Ben" }),
    await f.worker({ first: "Zoe" }),
    await f.worker({ first: "Kim" }),
  ];
  // Starting in 5 hours, 2 places, 1 booked: still open near its start.
  const soon = await f.shift({ startsAt: hoursFromNow(5), headcount: 2 });
  await atSite(soon, arena);
  await f.booking(kim, soon, "confirmed");
  // Starting in 3 days, a place open: not near its start (48 hours), so not on Updates.
  await atSite(await f.shift({ startsAt: hoursFromNow(72) }), arena);
  // At the depot on Wednesday night (60 hours away): Mo cancelled 20 minutes ago and the place is
  // open again.
  const tonight = await f.shift({ startsAt: hoursFromNow(60) });
  await atSite(tonight, depot);
  const reopened = await cancelled(f, mo, tonight, minutesAgo(20));
  // At the arena on Saturday: Zoe cancelled yesterday, and Ben has taken her place since (at 23:00,
  // overnight).
  const saturday = await f.shift({ startsAt: hoursFromNow(120) });
  await atSite(saturday, arena);
  const covered = await cancelled(f, zoe, saturday, hoursFromNow(-30), 150);
  await took(f, ben, saturday, hoursFromNow(-10));
  // A photo to check from 3 hours ago; one from 8 days ago is past the week.
  await upload(f, kim, hoursFromNow(-3));
  await upload(f, zoe, hoursFromNow(-8 * 24));
  const ctx = (officeUserId: string, at = NOW) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock: clockAt(at),
  });
  return {
    f,
    admin,
    resourcer,
    payroll,
    arena,
    depot,
    soon,
    tonight,
    saturday,
    reopened,
    covered,
    ctx,
  };
}

describe("the Updates page", () => {
  it("needs action first (open near its start, then newest), everything else newest first", async () => {
    const t = await week();
    const page = await officeUpdatesPage(t.ctx(t.resourcer));
    expect(page?.mine).toBe(false);
    expect(kinds(page?.needsAction ?? [])).toEqual([
      `open-soon ${t.soon}`,
      `cancelled ${t.reopened}`,
      "upload",
    ]);
    expect(kinds(page?.everything ?? [])).toEqual([
      `open-soon ${t.soon}`,
      `cancelled ${t.reopened}`,
      "upload",
      `took ${t.saturday}`,
      `cancelled ${t.covered}`,
    ]);
    const soon = page?.needsAction[0];
    expect(soon?.kind === "open-soon" && [soon.placesFree, soon.site, soon.offers]).toEqual([
      1,
      "Arena",
      0,
    ]);
    const reopened = page?.needsAction[1];
    expect(reopened?.kind === "cancelled" && reopened.reopened).toBe(true);
    const covered = page?.everything[4];
    expect(covered?.kind === "cancelled" && covered.reopened).toBe(false);
    expect(page?.more).toBe(false);
    // Never marked seen: everything's new as the bell counts it (the upload not: uploads are off by
    // default under "Tell me about"); today's are the cancellation at 08:40 and the upload at 06:00
    // (Ben's place at 23:00 was yesterday).
    expect([page?.seenAt, page?.newCount, page?.today]).toEqual([null, 3, 2]);
  });

  it("narrowed to the person's contracts: only their venues' sessions (uploads are a casual's, so all)", async () => {
    const t = await week();
    const added = await saveContract(t.ctx(t.admin), {
      clientId: null,
      name: "Arena Council",
      siteIds: [t.arena],
      before: [],
    });
    if (added.status !== "saved") throw new Error(added.status);
    const saved = await saveMyDashboard(t.ctx(t.resourcer), {
      clientIds: [added.clientId],
      cards: [],
    });
    expect(saved.status).toBe("saved");
    const page = await officeUpdatesPage(t.ctx(t.resourcer));
    expect(page?.mine).toBe(true);
    // The depot's cancellation is gone (and from the count); the arena's sessions and the upload stay.
    expect(kinds(page?.needsAction ?? [])).toEqual([`open-soon ${t.soon}`, "upload"]);
    expect(kinds(page?.everything ?? [])).toEqual([
      `open-soon ${t.soon}`,
      "upload",
      `took ${t.saturday}`,
      `cancelled ${t.covered}`,
    ]);
    expect(page?.newCount).toBe(2);
    // Someone else (no contracts) still sees every venue.
    expect(kinds((await officeUpdatesPage(t.ctx(t.admin)))?.needsAction ?? [])).toContain(
      `cancelled ${t.reopened}`,
    );
  });

  it("payroll has no Updates: no page, nothing marked", async () => {
    const t = await week();
    expect(await officeUpdatesPage(t.ctx(t.payroll))).toBeNull();
    expect(await markUpdatesSeen(t.ctx(t.payroll), NOW)).toBe(false);
  });
});

describe("the bell and the pop-up", () => {
  const bellOf = (t: Awaited<ReturnType<typeof week>>, who: string, at = NOW) =>
    withFirm(t.f.firmId, (tx) => loadUpdatesBell(tx, at, who));
  const seenAt = async (who: string) =>
    (
      await su.query<{ at: Date | null }>(
        "select updates_seen_at as at from office_users where id = $1",
        [who],
      )
    ).rows[0]?.at ?? null;

  it("counts places taken, cancellations and uploads since Updates was marked seen (never: the week)", async () => {
    const t = await week();
    // Never marked: the week's place taken and two cancellations.
    expect((await bellOf(t, t.resourcer)).newCount).toBe(3);
    // Uploads count only for someone who asked ("Tell me about": off by default).
    await saveTellMe(t.ctx(t.resourcer), { kind: "uploads", on: true });
    expect((await bellOf(t, t.resourcer)).newCount).toBe(4);
    // "Mark all as seen" on a page drawn 2 hours ago: the 20-minute-old cancellation is still new,
    // on the bell and on the page.
    expect(await markUpdatesSeen(t.ctx(t.resourcer), hoursFromNow(-2))).toBe(true);
    expect(await seenAt(t.resourcer)).toEqual(hoursFromNow(-2));
    expect((await bellOf(t, t.resourcer)).newCount).toBe(1);
    const page = await officeUpdatesPage(t.ctx(t.resourcer));
    expect([page?.seenAt, page?.newCount]).toEqual([hoursFromNow(-2), 1]);
    // An older page sending late never moves it back; a page "from the future" counts as now.
    await markUpdatesSeen(t.ctx(t.resourcer), hoursFromNow(-5));
    expect(await seenAt(t.resourcer)).toEqual(hoursFromNow(-2));
    await markUpdatesSeen(t.ctx(t.resourcer), hoursFromNow(3));
    expect(await seenAt(t.resourcer)).toEqual(NOW);
    expect((await bellOf(t, t.resourcer)).newCount).toBe(0);
    // Each person's own: the admin's is untouched.
    expect((await bellOf(t, t.admin)).newCount).toBe(3);
    // Marking isn't an action: nothing logged.
    const { rows } = await su.query(
      "select 1 from events where firm_id = $1 and action like 'office_user.updates%'",
      [t.f.firmId],
    );
    expect(rows).toEqual([]);
  });

  it("the pop-up: a casual's cancellation from the last 30 minutes and since Updates was marked seen", async () => {
    const t = await week();
    const bell = await bellOf(t, t.resourcer);
    expect(bell.today).toBe("2026-11-02");
    expect(bell.cancellations).toEqual([
      expect.objectContaining({
        ref: t.reopened,
        shiftId: t.tonight,
        site: "Depot",
        noticeHours: 9,
        reopened: true,
      }),
    ]);
    expect(bell.cancellations[0]?.worker).toBe("Mo Booker");
    // Up to 30 minutes after it, it pops up; from then on it's no longer new enough.
    const tenOn = new Date(NOW.getTime() + 10 * 60_000);
    expect(
      (await bellOf(t, t.resourcer, new Date(tenOn.getTime() - 1))).cancellations,
    ).toHaveLength(1);
    expect((await bellOf(t, t.resourcer, tenOn)).cancellations).toEqual([]);
    // Marked seen after it: not again.
    await markUpdatesSeen(t.ctx(t.resourcer), NOW);
    expect((await bellOf(t, t.resourcer)).cancellations).toEqual([]);
  });

  it("another firm's updates are never shown or counted", async () => {
    const a = await week();
    const b = await week();
    const page = await officeUpdatesPage(a.ctx(a.resourcer));
    const refs = (page?.everything ?? []).flatMap((u) =>
      u.kind === "cancelled"
        ? [u.ref]
        : u.kind === "open-soon" || u.kind === "took"
          ? [u.shiftId]
          : [],
    );
    for (const theirs of [b.reopened, b.covered, b.soon, b.saturday])
      expect(refs).not.toContain(theirs);
    expect((await bellOf(a, a.resourcer)).newCount).toBe(3);
    expect((await bellOf(a, a.resourcer)).cancellations.map((c) => c.ref)).toEqual([a.reopened]);
    // And marking one firm's person touches nobody in the other.
    await markUpdatesSeen(a.ctx(a.resourcer), NOW);
    expect((await bellOf(b, b.resourcer)).newCount).toBe(3);
  });
});
