import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { authParts, type AuthContext } from "../auth/link-login";
import { currentOfficeUser } from "../auth/office-login";
import { canAccess } from "../auth/roles";
import { systemClock } from "../auth/clock";
import { CANCELLED_ASSIGNMENT_STATUSES, firms, sites } from "../db/schema";
import { withFirm, type FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import type { Geocoder, Point } from "../travel/geocoder";
import { POSTCODE_INPUT_MAX, tidyPostcode } from "../travel/postcode";
import { serverGeocoder } from "../travel/server";
import { officeUserMay, type OfficeContext } from "./office-context";
import { strikesEmailOf, type StrikesEmail } from "./strikes-email";
import { siteMoved } from "../travel/estimate-queue";

// Settings (docs/office-v2.md 3.10; docs/screens.md `/office/settings`; 12B.7), admins only,
// checked here as well as on the page: the strikes team's email (src/lib/office/strikes-email.ts)
// and the sites, each with its postcode and whether its location is known. A site's postcode can't
// change while it has live bookings on sessions still to come: it would move booked casuals' venue
// with no reason or notice (golden rule 12). A change is logged `site.changed` {siteId, fields:
// ["postcode"]}, never the postcode or its point.
//
// The postcode is looked up first (12G.1; src/lib/travel/geocoder.ts), outside any transaction,
// and saved with its central point in one write: one it can't find, or a look-up that fails, saves
// nothing. Saving the same postcode again fills in a missing point (a site saved before look-ups,
// or added by a sheet, a file or the planner without one). The sheet sync and the file import add
// sites by name only, so those have no postcode until it's added here.

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));

export interface SettingsSite {
  siteId: string;
  name: string;
  postcode: string | null;
  located: boolean; // its central point is known (sites.lat, lng)
  bookedSessions: number; // sessions still to come with someone booked
}

export interface SettingsPage {
  strikesEmail: StrikesEmail & { linkSentAt: Date | null };
  sites: SettingsSite[];
}

// Sessions still to come at the site (not started) with at least one live booking.
async function bookedSessionsAt(tx: FirmTx, siteId: string | null, now: Date) {
  const { rows } = await tx.execute<{ site_id: string; n: number }>(sql`
    select s.site_id, count(distinct s.id)::int as n from shifts s
     where s.starts_at > ${now} and s.status <> 'cancelled'
       ${siteId ? sql`and s.site_id = ${siteId}` : sql`and s.site_id is not null`}
       and exists (select 1 from assignments a
                    where a.firm_id = s.firm_id and a.shift_id = s.id and a.worker_id is not null
                      and a.status not in (${CANCELLED}))
     group by s.site_id
  `);
  return new Map(rows.map((r) => [r.site_id, r.n]));
}

export async function officeSettingsPage(
  ctx: AuthContext,
  token: string,
): Promise<SettingsPage | null> {
  const me = await currentOfficeUser(ctx, token);
  if (!me || !canAccess(me.officeUser.role, "settings")) return null;
  const { run, now } = authParts(ctx);
  return run(ctx.firm.id, async (tx) => {
    const [firm] = await tx
      .select({ settings: firms.settings })
      .from(firms)
      .where(eq(firms.id, ctx.firm.id));
    const strikes = strikesEmailOf(firm?.settings ?? {});
    // The latest link sent (or being sent), after the address was last changed.
    const { rows: sent } = await tx.execute<{ at: string | Date }>(sql`
      select e.created_at as at from events e
       where e.entity_id = ${ctx.firm.id} and e.action = 'firm.strikes_email_link'
         and e.created_at > coalesce((select max(c.created_at) from events c
                                       where c.entity_id = ${ctx.firm.id}
                                         and c.action = 'firm.settings_changed'
                                         and c.data -> 'keys' ? 'strikes.email'), '-infinity')
       order by e.id desc limit 1
    `);
    const siteRows = await tx
      .select({
        siteId: sites.id,
        name: sites.name,
        postcode: sites.postcode,
        located: sql<boolean>`${sites.lat} is not null and ${sites.lng} is not null`,
      })
      .from(sites)
      .orderBy(asc(sites.name));
    const booked = await bookedSessionsAt(tx, null, now);
    return {
      strikesEmail: {
        ...strikes,
        linkSentAt: strikes.address && sent[0] ? new Date(sent[0].at) : null,
      },
      sites: siteRows.map((s) => ({ ...s, bookedSessions: booked.get(s.siteId) ?? 0 })),
    };
  });
}

// A UK postcode ("LS1 4AP", any case and spacing), kept as "LS1 4AP"; empty clears it.
export const sitePostcodeSchema = z.strictObject({
  postcode: z
    .string()
    .max(POSTCODE_INPUT_MAX)
    .refine((v) => v.trim() === "" || tidyPostcode(v) !== null),
});

export type EditSitePostcodeResult =
  | { status: "saved" }
  | { status: "saved_unlocated" } // saved; look-ups aren't switched on, so no location yet
  | { status: "located" } // the same postcode: its missing location found now
  | { status: "lookups_off" } // the same postcode, no location, and look-ups aren't on
  | { status: "unchanged" }
  | { status: "in_use"; sessions: number } // live bookings on sessions still to come
  | { status: "invalid" }
  | { status: "unknown_postcode" } // the look-up doesn't know it: nothing saved
  | { status: "lookup_failed" } // the look-up didn't answer: nothing saved
  | { status: "not_found" }
  | { status: "not_allowed" };

const pointColumns = (point: Point | null) => ({
  lat: point ? String(point.lat) : null,
  lng: point ? String(point.lng) : null,
});

export async function editSitePostcode(
  ctx: OfficeContext & { geocoder?: Geocoder },
  siteId: string,
  raw: z.input<typeof sitePostcodeSchema>,
): Promise<EditSitePostcodeResult> {
  if (!z.uuid().safeParse(siteId).success) return { status: "not_found" };
  const parsed = sitePostcodeSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid" };
  const postcode = tidyPostcode(parsed.data.postcode);
  const now = (ctx.clock ?? systemClock).now();
  // The look-up comes first, outside any transaction: a wait on the network never holds rows
  // locked. (The action lets only admins this far; the transaction checks again.)
  // With look-ups off (the fake geocoder and a real postcode), the postcode is still saved, without
  // a location, as before look-ups existed.
  let point: Point | null = null;
  let off = false;
  if (postcode) {
    const found = await (ctx.geocoder ?? serverGeocoder()).locate(postcode);
    if (found.status === "not_found") return { status: "unknown_postcode" };
    if (found.status === "unavailable") return { status: "lookup_failed" };
    if (found.status === "off") off = true;
    else point = found.point;
  }
  return (ctx.run ?? withFirm)(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "settings"))) return { status: "not_allowed" };
    // No booking may land between the count and the change. "for update" on the site holds back
    // a session added at it or moved to it (their foreign-key check needs the site's key share);
    // a booking takes its session's row first (src/lib/roster/native.ts lockShift), so locking
    // the site's sessions still to come makes bookings in flight finish first and later ones wait
    // for this change. The count then runs after both, so it sees every committed booking.
    const [site] = await tx
      .select({ postcode: sites.postcode, lat: sites.lat })
      .from(sites)
      .where(eq(sites.id, siteId))
      .for("update");
    if (!site) return { status: "not_found" };
    if ((site.postcode ?? null) === postcode) {
      if (postcode === null || site.lat !== null) return { status: "unchanged" };
      if (off) return { status: "lookups_off" };
      // The same postcode with no point yet: the venue doesn't move, so bookings don't matter.
      await tx.update(sites).set(pointColumns(point)).where(eq(sites.id, siteId));
      await siteMoved(tx, siteId, now); // its sessions' travel estimates (12G.2)
      await recordEvent(tx, {
        actorType: "office",
        actorId: ctx.officeUserId,
        action: "site.changed",
        entityType: "site",
        entityId: siteId,
        data: { siteId, fields: ["location"] },
      });
      return { status: "located" };
    }
    await tx.execute(sql`
      select s.id from shifts s
       where s.site_id = ${siteId} and s.starts_at > ${now}
       order by s.id
         for no key update
    `);
    const sessions = (await bookedSessionsAt(tx, siteId, now)).get(siteId) ?? 0;
    if (sessions > 0) return { status: "in_use", sessions };
    await tx
      .update(sites)
      .set({ postcode, ...pointColumns(point) })
      .where(eq(sites.id, siteId));
    // Its old travel estimates are wrong now; its sessions to come get new ones (12G.2).
    await siteMoved(tx, siteId, now);
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action: "site.changed",
      entityType: "site",
      entityId: siteId,
      data: { siteId, fields: ["postcode"] },
    });
    return { status: off ? "saved_unlocated" : "saved" };
  });
}
