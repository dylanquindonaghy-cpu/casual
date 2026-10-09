import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { authParts, type AuthContext } from "../auth/link-login";
import { currentOfficeUser } from "../auth/office-login";
import { canAccess } from "../auth/roles";
import { systemClock } from "../auth/clock";
import { CANCELLED_ASSIGNMENT_STATUSES, firms, sites } from "../db/schema";
import { withFirm, type FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { officeUserMay, type OfficeContext } from "./office-context";
import { strikesEmailOf, type StrikesEmail } from "./strikes-email";

// Settings (docs/office-v2.md 3.10; docs/screens.md `/office/settings`; 12B.7), admins only,
// checked here as well as on the page: the strikes team's email (src/lib/office/strikes-email.ts)
// and the sites, each with its postcode. A site's postcode can't change while it has live bookings
// on sessions still to come: it would move booked casuals' venue with no reason or notice (golden
// rule 12). A change is logged `site.changed` {siteId, fields: ["postcode"]}, never the postcode.

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));

export interface SettingsSite {
  siteId: string;
  name: string;
  postcode: string | null;
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
      .select({ siteId: sites.id, name: sites.name, postcode: sites.postcode })
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
const POSTCODE = /^([A-Z]{1,2}[0-9][A-Z0-9]?) ?([0-9][A-Z]{2})$/;
export const sitePostcodeSchema = z.strictObject({
  postcode: z
    .string()
    .max(12)
    .transform((v) => v.trim().toUpperCase().replace(/\s+/g, " "))
    .refine((v) => v === "" || POSTCODE.test(v)),
});

export type EditSitePostcodeResult =
  | { status: "saved" }
  | { status: "unchanged" }
  | { status: "in_use"; sessions: number } // live bookings on sessions still to come
  | { status: "invalid" }
  | { status: "not_found" }
  | { status: "not_allowed" };

export async function editSitePostcode(
  ctx: OfficeContext,
  siteId: string,
  raw: z.input<typeof sitePostcodeSchema>,
): Promise<EditSitePostcodeResult> {
  if (!z.uuid().safeParse(siteId).success) return { status: "not_found" };
  const parsed = sitePostcodeSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid" };
  const postcode = parsed.data.postcode.replace(POSTCODE, "$1 $2") || null;
  const now = (ctx.clock ?? systemClock).now();
  return (ctx.run ?? withFirm)(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "settings"))) return { status: "not_allowed" };
    // No booking may land between the count and the change. "for update" on the site holds back
    // a session added at it or moved to it (their foreign-key check needs the site's key share);
    // a booking takes its session's row first (src/lib/roster/native.ts lockShift), so locking
    // the site's sessions still to come makes bookings in flight finish first and later ones wait
    // for this change. The count then runs after both, so it sees every committed booking.
    const [site] = await tx
      .select({ postcode: sites.postcode })
      .from(sites)
      .where(eq(sites.id, siteId))
      .for("update");
    if (!site) return { status: "not_found" };
    if ((site.postcode ?? null) === postcode) return { status: "unchanged" };
    await tx.execute(sql`
      select s.id from shifts s
       where s.site_id = ${siteId} and s.starts_at > ${now}
       order by s.id
         for no key update
    `);
    const sessions = (await bookedSessionsAt(tx, siteId, now)).get(siteId) ?? 0;
    if (sessions > 0) return { status: "in_use", sessions };
    await tx.update(sites).set({ postcode }).where(eq(sites.id, siteId));
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action: "site.changed",
      entityType: "site",
      entityId: siteId,
      data: { siteId, fields: ["postcode"] },
    });
    return { status: "saved" };
  });
}
