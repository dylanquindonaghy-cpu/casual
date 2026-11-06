import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { needsRowText } from "@/lib/portal/home-copy";
import { myNeedsAndPhoto } from "@/lib/portal/my-shifts";
import { myProfile, mySortedMark } from "@/lib/portal/profile";
import { tabCounts } from "@/lib/portal/tab-counts";
import { bookingFirm, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The tab bar's Profile count leaves out a need the office has in hand (Phase 28.15, 28.11's
// hand-off; docs/screens.md "### 28.11" and "### 28.15"), as Profile ("The office has this in
// hand.") and Home's "Do this" row do, so the three never disagree. Read as the app role, inside
// her firm only: a mark made in another firm never counts. NOW is Monday 2 November 2026, 09:00
// London.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(2);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const clock = { now: () => NOW };
// The tab bar's callers pass the firm's id only (PortalContext): the count reads the firm's
// calendar itself.
const tabCtx = (f: BookingFirm) => ({ firm: { id: f.firmId }, run: withFirm, clock });
const markSorted = (firmId: string, workerId: string, type: string, status: string) =>
  su.query(
    `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
     values ($1, 'office', 'casual.needs_sorted', 'worker', $2, $3)`,
    [firmId, workerId, JSON.stringify({ workerId, type, status })],
  );

describe("The tab bar's Profile count and the office's 'in hand' (28.15, from 28.11)", () => {
  it("a need the office has in hand isn't counted, and Home's 'Do this' and Profile agree", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker({
      roles: ["door_supervisor", "steward"],
      credentials: [{ type: "SIA_DS", status: "expired", expiresOn: "2026-10-01" }],
    });
    const before = (await tabCounts(tabCtx(f), sam)).needs;

    // The office marks her missing steward qualification sorted.
    await markSorted(f.firmId, sam, "STEWARD_L2", "missing");
    const after = (await tabCounts(tabCtx(f), sam)).needs;
    expect(before - after).toBe(1);
    expect(after).toBeGreaterThanOrEqual(1); // the expired licence is still hers to sort

    // Profile reads the same mark: the steward need is in hand, the licence isn't.
    const profile = await myProfile(
      { firm: { id: f.firmId, timezone: "Europe/London" }, run: withFirm, clock },
      sam,
    );
    expect(profile?.qualifications.find((q) => q.type === "STEWARD_L2")?.inHand).toBe(true);
    expect(profile?.qualifications.find((q) => q.type === "SIA_DS")?.inHand).toBe(false);

    // Home's "Do this" row, from the same mark, names only the licence.
    const held = await myNeedsAndPhoto(tabCtx(f), sam);
    const mark = await mySortedMark(tabCtx(f), sam);
    expect(mark).toMatchObject({ type: "STEWARD_L2", status: "missing", changedAfter: false });
    const row = needsRowText(held.needs, held.photo, 2026, mark);
    expect(row?.href).toBe("/profile/upload/SIA_DS");
  });

  it("a mark made in another firm never takes a need off her count", async () => {
    const a = await bookingFirm(su, withFirm);
    const b = await bookingFirm(su, withFirm);
    const kit = await a.worker({
      roles: ["door_supervisor", "steward"],
      credentials: [{ type: "SIA_DS", status: "expired", expiresOn: "2026-10-01" }],
    });
    const before = (await tabCounts(tabCtx(a), kit)).needs;
    await markSorted(b.firmId, kit, "STEWARD_L2", "missing");
    expect((await tabCounts(tabCtx(a), kit)).needs).toBe(before);
    expect(await mySortedMark(tabCtx(a), kit)).toBeNull();
  });
});
