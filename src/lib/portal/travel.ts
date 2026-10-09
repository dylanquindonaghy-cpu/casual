import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import {
  firms,
  TRAVEL_MINUTES,
  TRAVEL_MODES,
  workers,
  workerTravel,
  type TravelMinutes,
  type TravelMode,
} from "../db/schema";
import { withFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import type { Geocoder, Point } from "../travel/geocoder";
import { POSTCODE_INPUT_MAX, tidyPostcode } from "../travel/postcode";
import { serverGeocoder } from "../travel/server";
import { travelSettings } from "../travel/settings";
import type { PortalContext } from "./my-shifts";
import { casualMoved } from "../travel/estimate-queue";

// The casual's travel area, "Where you work" (docs/office-v2.md 4.6, 5.4; S8; 12G.1), for the
// logged-in casual only, inside their firm. Server only; the words are in travel-copy.ts.
//
// - myTravel: their start postcode (theirs to see; the office sees the district only), how they
//   travel and their time limit; or, before they set one, the firm's default limit.
// - saveMyTravel: a new postcode is looked up first, outside any transaction (a wait on the network
//   never holds rows locked), and saved with its central point; one the look-up can't find, or a
//   look-up that fails, saves nothing. Changing only how they travel or the limit needs no look-up.
//   Logged `travel.profile_changed` {changed, maxMinutes}: which settings changed and the limit,
//   never the postcode or its point (the log is never purged: docs/office-v2.md 6.1).
// - removeMyTravel: deletes it (logged `travel.profile_removed`).
// The casual's row is locked first, as erasure and the office's status changes lock it, and only an
// active casual's area is saved: a save in flight can't bring back an area that erasure or "They've
// left" just deleted.

// The page's line about who sees what, as worded when they saved (worker_travel).
export const TRAVEL_NOTICE_VERSION = "travel-v1";

export interface MyTravel {
  set: boolean;
  postcode: string | null;
  modes: TravelMode;
  maxMinutes: TravelMinutes;
}

export type SaveTravelResult =
  | { status: "saved" }
  | { status: "unchanged" }
  | { status: "invalid" }
  | { status: "unknown_postcode" } // the look-up doesn't know it: nothing saved
  | { status: "lookup_failed" } // the look-up didn't answer: nothing saved
  | { status: "lookups_off" } // look-ups aren't switched on (the fake, a real postcode)
  | { status: "try_again" } // their postcode changed in another tab meanwhile: nothing saved
  | { status: "not_active" };

export type RemoveTravelResult =
  { status: "removed" } | { status: "not_set" } | { status: "not_active" };

type Ctx = PortalContext & { geocoder?: Geocoder };

export const travelInputSchema = z.strictObject({
  postcode: z.string().max(POSTCODE_INPUT_MAX),
  modes: z.enum(TRAVEL_MODES),
  maxMinutes: z.union(TRAVEL_MINUTES.map((m) => z.literal(m))),
});

export async function myTravel(ctx: PortalContext, workerId: string): Promise<MyTravel> {
  return (ctx.run ?? withFirm)(ctx.firm.id, async (tx) => {
    const [firm] = await tx
      .select({ settings: firms.settings })
      .from(firms)
      .where(eq(firms.id, sql`app_current_firm_id()`));
    const [row] = await tx
      .select({
        postcode: workerTravel.startPostcode,
        modes: workerTravel.modes,
        maxMinutes: workerTravel.maxMinutes,
      })
      .from(workerTravel)
      .where(eq(workerTravel.workerId, workerId));
    if (!row) {
      return {
        set: false,
        postcode: null,
        modes: "both",
        maxMinutes: travelSettings(firm?.settings ?? {}).defaultMaxMinutes,
      };
    }
    return {
      set: true,
      postcode: row.postcode,
      modes: row.modes,
      maxMinutes: row.maxMinutes as TravelMinutes,
    };
  });
}

export async function saveMyTravel(
  ctx: Ctx,
  workerId: string,
  raw: unknown,
): Promise<SaveTravelResult> {
  const input = travelInputSchema.safeParse(raw);
  if (!input.success) return { status: "invalid" };
  const postcode = tidyPostcode(input.data.postcode);
  if (!postcode) return { status: "invalid" };
  const { modes, maxMinutes } = input.data;
  const run = ctx.run ?? withFirm;
  const now = (ctx.clock ?? systemClock).now();
  // First, briefly: are they active (no look-up for anyone else), and what's saved now?
  const before = await run(ctx.firm.id, async (tx) => {
    const [worker] = await tx
      .select({ status: workers.status, erasedAt: workers.erasedAt })
      .from(workers)
      .where(eq(workers.id, workerId));
    if (!worker || worker.erasedAt !== null || worker.status !== "active") return null;
    const [row] = await tx
      .select({ postcode: workerTravel.startPostcode })
      .from(workerTravel)
      .where(eq(workerTravel.workerId, workerId));
    return { postcode: row?.postcode ?? null };
  });
  if (!before) return { status: "not_active" };
  // A new postcode is looked up; the same one keeps the point it was saved with.
  let point: Point | null = null;
  if (before.postcode !== postcode) {
    const found = await (ctx.geocoder ?? serverGeocoder()).locate(postcode);
    if (found.status === "not_found") return { status: "unknown_postcode" };
    if (found.status === "unavailable") return { status: "lookup_failed" };
    if (found.status === "off") return { status: "lookups_off" };
    point = found.point;
  }
  return run(ctx.firm.id, async (tx) => {
    const [worker] = await tx
      .select({ status: workers.status, erasedAt: workers.erasedAt })
      .from(workers)
      .where(eq(workers.id, workerId))
      .for("no key update");
    if (!worker || worker.erasedAt !== null || worker.status !== "active") {
      return { status: "not_active" };
    }
    const [row] = await tx
      .select({
        postcode: workerTravel.startPostcode,
        lat: workerTravel.lat,
        lng: workerTravel.lng,
        modes: workerTravel.modes,
        maxMinutes: workerTravel.maxMinutes,
      })
      .from(workerTravel)
      .where(eq(workerTravel.workerId, workerId));
    const samePostcode = row?.postcode === postcode;
    // Looked up as the same postcode, but another save changed it since: its point isn't known.
    if (!samePostcode && point === null) return { status: "try_again" };
    const changed = [
      ...(samePostcode ? [] : ["postcode"]),
      ...(row?.modes === modes ? [] : ["modes"]),
      ...(row?.maxMinutes === maxMinutes ? [] : ["maxMinutes"]),
    ];
    if (changed.length === 0) return { status: "unchanged" };
    const lat = point ? String(point.lat) : (row?.lat ?? "");
    const lng = point ? String(point.lng) : (row?.lng ?? "");
    const values = {
      startPostcode: postcode,
      lat,
      lng,
      modes,
      maxMinutes,
      privacyNoticeVersion: TRAVEL_NOTICE_VERSION,
      updatedAt: now,
    };
    await tx
      .insert(workerTravel)
      .values({ firmId: sql`app_current_firm_id()`, workerId, ...values })
      .onConflictDoUpdate({ target: [workerTravel.firmId, workerTravel.workerId], set: values });
    await recordEvent(tx, {
      actorType: "worker",
      actorId: workerId,
      action: "travel.profile_changed",
      entityType: "worker",
      entityId: workerId,
      data: { changed, maxMinutes },
    });
    // Estimates from their (new) postcode, in a shared run a few minutes later (12G.2). Both ways
    // are always worked out, so after a change of ways alone the run usually finds nothing missing
    // (a database read, no search).
    if (changed.includes("postcode") || changed.includes("modes")) await casualMoved(tx);
    return { status: "saved" };
  });
}

export async function removeMyTravel(
  ctx: PortalContext,
  workerId: string,
): Promise<RemoveTravelResult> {
  return (ctx.run ?? withFirm)(ctx.firm.id, async (tx) => {
    const [worker] = await tx
      .select({ erasedAt: workers.erasedAt })
      .from(workers)
      .where(eq(workers.id, workerId))
      .for("no key update");
    if (!worker || worker.erasedAt !== null) return { status: "not_active" };
    const gone = await tx
      .delete(workerTravel)
      .where(eq(workerTravel.workerId, workerId))
      .returning({ id: workerTravel.id });
    if (gone.length === 0) return { status: "not_set" };
    await recordEvent(tx, {
      actorType: "worker",
      actorId: workerId,
      action: "travel.profile_removed",
      entityType: "worker",
      entityId: workerId,
      data: {},
    });
    return { status: "removed" };
  });
}
