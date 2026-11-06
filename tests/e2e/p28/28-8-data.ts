import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { seedId } from "../../../src/lib/db/admin/seed-data";
import { databaseName, isLocalHost, withDatabase } from "../../../src/lib/db/admin/urls";
import {
  assignments,
  firms,
  shifts,
  sites,
  workers,
  workerTravel,
} from "../../../src/lib/db/schema";
import { createWithFirm, type FirmTx } from "../../../src/lib/db/scoped";
import { automaticEventId } from "../../../src/lib/roster/shift-events";
import { localDateOf } from "../../../src/lib/time/zoned";
import { fakePoint } from "../../../src/lib/travel/geocoder";

// Task 28.8's rows (Phase 28; tests/e2e/casual.p28-open.spec.ts): Open shifts and the urgent board
// grouped as the office's event card. Two casuals of this spec's own, each in a role nobody else
// has (no qualification needed), so no other spec's lists change and theirs don't change:
//
// - Ola, with a travel area (car, 45 minutes) and, in her role: an urgent shift tomorrow with no
//   pay rate at a site the travel job hasn't worked out yet ("About … miles away. Travel time isn't
//   worked out yet."), two open shifts the day after (one with a pay rate and 3 places, one with
//   none), another four days ahead, and a booking of hers three days ahead. So the strip has an
//   urgent, an open and a booked tile and four days with nothing (no tile), both lists show, and
//   choosing tomorrow leaves only the urgent shift (the other list's empty state).
// - Noor, in a role with no shifts at all: Open shifts' and the urgent board's empty states.
//
// A rerun cancels the last run's sessions first, so it starts the same way (bookings are never
// deleted; one on a cancelled session counts for nothing). Made-up people and postcodes only:
// drama-range numbers no other spec uses.

export const P28_8_ROLE = "p28_open_check";
export const P28_8_EMPTY_ROLE = "p28_open_none";
export const P28_8_CASUAL = { firstName: "Ola", lastName: "Penrose", mobileE164: "+447700900288" };
export const P28_8_TYPED = "07700 900288";
export const P28_8_EMPTY_CASUAL = {
  firstName: "Noor",
  lastName: "Faraday",
  mobileE164: "+447700900828",
};
export const P28_8_EMPTY_TYPED = "07700 900828";

// The e2e database (never the dev one), as the app role, as tests/e2e/db.ts writes its rows.
function e2eAppUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  if (!isLocalHost(url)) throw new Error("e2e rows go to a local database only");
  return withDatabase(url, `${databaseName(url)}_e2e`);
}

async function eventFor(tx: FirmTx, siteId: string, startsAt: Date, timeZone: string) {
  return automaticEventId(tx, { siteId, startsAt, source: "native", timeZone });
}

export interface OpenScene {
  urgentDay: string; // yyyy-mm-dd, London time: the day with only the urgent shift
  urgentSite: string;
  paidSite: string;
  unpaidSite: string;
}

export async function openScene(slug = "acme"): Promise<OpenScene> {
  const pool = new Pool({ connectionString: e2eAppUrl(), max: 1 });
  try {
    const { rows } = await pool.query<{ db: string }>("select current_database() as db");
    if (!rows[0]?.db.endsWith("_e2e")) throw new Error(`refusing database ${rows[0]?.db ?? "?"}`);
    const firmId = seedId(`firm/${slug}`);
    return await createWithFirm(pool)(firmId, async (tx) => {
      const [firm] = await tx
        .select({ timezone: firms.timezone })
        .from(firms)
        .where(eq(firms.id, sql`app_current_firm_id()`));
      const timeZone = firm?.timezone ?? "Europe/London";
      for (const role of [P28_8_ROLE, P28_8_EMPTY_ROLE])
        await tx.execute(sql`
          insert into credential_rules (firm_id, sector, role, required_types)
          values (${firmId}, 'security', ${role}, '{}')
          on conflict (firm_id, role) do nothing`);
      const casual = async (
        who: { firstName: string; lastName: string; mobileE164: string },
        role: string,
      ) => {
        await tx
          .insert(workers)
          .values({ firmId, ...who, roles: [role] })
          .onConflictDoNothing();
        const [row] = await tx
          .select({ id: workers.id })
          .from(workers)
          .where(eq(workers.mobileE164, who.mobileE164));
        if (!row) throw new Error(`${who.firstName} neither added nor found`);
        return row.id;
      };
      const ola = await casual(P28_8_CASUAL, P28_8_ROLE);
      await casual(P28_8_EMPTY_CASUAL, P28_8_EMPTY_ROLE);
      await tx.update(shifts).set({ status: "cancelled" }).where(eq(shifts.role, P28_8_ROLE));

      const point = (postcode: string) => {
        const p = fakePoint(postcode);
        if (!p) throw new Error(`no fake point for ${postcode}`);
        return { lat: String(p.lat), lng: String(p.lng) };
      };
      const home = point("ZZ2 2BB");
      await tx
        .insert(workerTravel)
        .values({
          firmId,
          workerId: ola,
          startPostcode: "ZZ2 2BB",
          ...home,
          modes: "car",
          maxMinutes: 45,
          privacyNoticeVersion: "travel-v1",
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [workerTravel.firmId, workerTravel.workerId],
          set: { startPostcode: "ZZ2 2BB", ...home, modes: "car", maxMinutes: 45 },
        });

      const stamp = Date.now().toString(36);
      const dayAt = (days: number) => {
        const at = new Date(Date.now() + days * 86_400_000);
        at.setUTCHours(10, 0, 0, 0);
        return at;
      };
      // A session at a site of its own, located (so a straight line is known), and, when `car`
      // is given, the travel job's estimates by car and by public transport.
      const session = async (
        o: { site: string; at: Date; car?: { minutes: number; metres: number } },
        facts: Partial<typeof shifts.$inferInsert>,
      ) => {
        const [site] = await tx
          .insert(sites)
          .values({ firmId, name: o.site, postcode: "ZZ1 1AA", ...point("ZZ1 1AA") })
          .returning({ id: sites.id });
        if (!site) throw new Error("site insert returned nothing");
        const [row] = await tx
          .insert(shifts)
          .values({
            firmId,
            siteId: site.id,
            shiftEventId: await eventFor(tx, site.id, o.at, timeZone),
            role: P28_8_ROLE,
            startsAt: o.at,
            endsAt: new Date(o.at.getTime() + 8 * 3_600_000),
            headcount: 1,
            status: "open",
            source: "native",
            ...facts,
          })
          .returning({ id: shifts.id });
        if (!row) throw new Error("shift insert returned nothing");
        if (o.car) {
          const arriveBy = new Date(o.at.getTime() - 30 * 60_000);
          const expiresAt = new Date(o.at.getTime() + 8 * 86_400_000);
          await tx.execute(sql`
            insert into travel_estimates (firm_id, origin_postcode, site_id, mode, arrive_by,
                                          minutes, metres, provider, computed_at, expires_at)
            values (${firmId}, 'ZZ2 2BB', ${site.id}, 'car', ${arriveBy}, ${o.car.minutes},
                    ${o.car.metres}, 'fake', now(), ${expiresAt}),
                   (${firmId}, 'ZZ2 2BB', ${site.id}, 'public_transport', ${arriveBy},
                    ${o.car.minutes * 2}, null, 'fake', now(), ${expiresAt})`);
        }
        return row.id;
      };

      const urgentAt = dayAt(1);
      const urgentSite = `Open Urgent Hall ${stamp}`;
      await session({ site: urgentSite, at: urgentAt }, { isUrgent: true });
      const paidSite = `Open Paid Hall ${stamp}`;
      await session(
        { site: paidSite, at: dayAt(2), car: { minutes: 15, metres: 8047 } },
        { payRatePence: 1300, headcount: 3 },
      );
      const unpaidSite = `Open Unpaid Hall ${stamp}`;
      await session(
        {
          site: unpaidSite,
          at: new Date(dayAt(2).getTime() + 4 * 3_600_000),
          car: { minutes: 20, metres: 9656 },
        },
        {},
      );
      await session(
        { site: `Open Later Hall ${stamp}`, at: dayAt(4), car: { minutes: 25, metres: 12070 } },
        { payRatePence: 1250 },
      );
      const bookedId = await session(
        { site: `Open Booked Hall ${stamp}`, at: dayAt(3), car: { minutes: 15, metres: 8047 } },
        { status: "filled", payRatePence: 1260 },
      );
      await tx.insert(assignments).values({
        firmId,
        shiftId: bookedId,
        slot: 1,
        workerId: ola,
        status: "confirmed",
        confirmedAt: new Date(),
      });
      return {
        urgentDay: localDateOf(urgentAt, timeZone),
        urgentSite,
        paidSite,
        unpaidSite,
      };
    });
  } finally {
    await pool.end();
  }
}
