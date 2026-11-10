import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireWorker } from "@/lib/auth/current-worker";
import { appEnv, offlineCopyOn } from "@/lib/env";
import {
  countPills,
  qualificationRows,
  recordFigures,
  toDoCount,
  updateRows,
} from "@/lib/portal/home-board";
import { homeWeek } from "@/lib/portal/home-week";
import { myHome, urgentCount } from "@/lib/portal/my-home";
import { myOffers } from "@/lib/portal/my-offers";
import { myShifts } from "@/lib/portal/my-shifts";
import { openShiftsFor } from "@/lib/portal/open-shifts";
import { myPayDay } from "@/lib/portal/pay-day";
import { myReachPrompts } from "@/lib/portal/reach-me";
import { tabCounts } from "@/lib/portal/tab-counts";
import { parseHost } from "@/lib/tenancy/host";
import { localDateOf } from "@/lib/time/zoned";
import { tourLaterKey } from "@/lib/tour/later-key";
import { barPills } from "@/lib/portal/casual-bar";
import { cardTiles } from "@/lib/portal/home-board";
import { homeMap } from "@/lib/portal/home-map";
import { loadMapPlaces } from "@/lib/portal/home-map-places";
import { CountedTabBar } from "./casual-tab-bar";
import { CasualTour } from "./casual-tour";
import { CasualTop } from "./casual-top-bar";
import { HomeView } from "./home-view";
import { OfflineCopy } from "./offline-copy";
import { refreshSessionAction } from "./session-actions";
import { SessionKeeper } from "./session-keeper";
import { page } from "./ui/classes";
import type { StaffPhoto } from "@/lib/uploads/photo";

const NO_PHOTO: StaffPhoto = { status: "missing", current: null, waiting: null };

// The root URL serves two sites: the ShiftDesk home page on the base domain, and each firm's
// portal on <slug>.<base domain> or the firm's own domain, where a logged-in casual sees Home
// (docs/office-v2.md 4.2; docs/screens.md, `/`; 12H.1). Any host that isn't the base domain is a
// firm's page: requireWorker() finds the firm (a name that isn't a firm's, or a custom domain not
// verified, is the 404 page). Her bookings are on the Shifts tab (`/shifts`): the old address of
// the last 90 days, `/?view=past`, goes there. Kept for when there's no signal (public/sw.js). Phase
// 28.7: the tab bar's counts from tabCounts(), as on every casual page, and the two "can we reach
// you" rows (src/lib/portal/reach-me.ts), online only. Phase 28.15: her offers still open to her
// ("Offered to you", src/lib/portal/my-offers.ts), and the office's latest "Mark as sorted", so a
// need it has in hand leaves "Do this" as it does on Profile.
//
// Phase 30.1 (docs/screens.md "### 30.1"): Home is her dashboard, on page.staffWide. Its counts are
// the pages' own: Booked her upcoming bookings (as /shifts), Open to you the shifts she can take (as
// /shifts/open), Urgent the urgent ones (as /urgent: src/lib/portal/my-home.ts urgentCount), To do
// what "Do this" stands for, Messages the office's replies she hasn't read (the tab bar's). Her
// qualifications, record, latest updates and week come from Profile's, her shift record's and
// Booked's own loaders (myHome). Her own rows only, inside her firm.
export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const match = parseHost((await headers()).get("host"), appEnv().APP_BASE_DOMAIN);
  if (match && match.kind !== "apex") {
    if ((await searchParams).view === "past") redirect("/shifts?view=past");
    const { firm, worker, session, tourSeen } = await requireWorker();
    const now = new Date();
    const clock = { now: () => now };
    const [upcoming, open, counts, reach, offers] = await Promise.all([
      myShifts({ firm, clock }, worker.id, "upcoming"),
      openShiftsFor({ firm, clock }, worker.id),
      tabCounts({ firm, clock }, worker.id),
      myReachPrompts({ firm }, worker.id),
      myOffers({ firm, clock }, worker.id),
    ]);
    const [pay, home, urgent] = await Promise.all([
      myPayDay({ firm, clock }, worker.id),
      myHome({ firm, clock }, worker.id, upcoming),
      urgentCount({ firm, clock }, worker.id, open),
    ]);
    // What needs doing and the office's latest "Mark as sorted", from Profile's read (myHome):
    // myNeedsAndPhoto's and mySortedMark's, never read twice.
    const needs = {
      needs: home.profile?.needs ?? [],
      photo: home.profile?.photo ?? NO_PHOTO,
    };
    const sortedMark = home.profile?.sortedMark ?? null;
    const today = localDateOf(now, firm.timezone);
    const year = Number(today.slice(0, 4));
    const board = {
      pills: countPills({
        booked: upcoming.length,
        open: open.shifts.length,
        urgent,
        todo: toDoCount({ needs: needs.needs, photo: needs.photo, year, sortedMark, reach }),
        messages: counts.replies,
      }),
      quals: qualificationRows({
        qualifications: home.profile?.qualifications ?? [],
        others: home.profile?.others ?? [],
        photo: needs.photo,
        rightToWork: home.profile?.rightToWork ?? {
          checked: false,
          checkedOn: null,
          expired: false,
        },
        today,
      }),
      weeks: homeWeek(now, firm.timezone, home.week, open.shifts),
      updates: updateRows(home.updates, now, firm.timezone),
      record: recordFigures(
        home.profile?.reliability ?? {
          kind: "new",
          counted: 0,
          counts: { worked: 0, noShows: 0, lateCancels: 0 },
        },
        home.strikes,
      ),
    };
    // Phase 32 (32.2): the street map's pins, from her next shift and the very list "Open to you"
    // counts (`open`, the rules' own), each venue's point read inside her firm.
    const places = await loadMapPlaces({ firm }, upcoming[0] ?? null, open.shifts);
    const map = homeMap({
      next: upcoming[0] ?? null,
      nextPlace: places.nextPlace,
      open: open.shifts,
      places: places.places,
      now,
      timeZone: firm.timezone,
      // One urgent count on Home: the pill's, the card's and the map's Urgent tab.
      urgent,
    });
    return (
      <>
        <CasualTop firm={firm} worker={worker} counts={counts} pills={barPills(board.pills)} />
        <main className={page.staffWide}>
          <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
          <OfflineCopy enabled={offlineCopyOn(appEnv())} renderedAt={now.getTime()} />
          <HomeView
            firstName={worker.firstName}
            lastName={worker.lastName}
            firmName={firm.name}
            timeZone={firm.timezone}
            now={now}
            next={upcoming[0] ?? null}
            needs={needs.needs}
            photo={needs.photo}
            open={open}
            pay={pay}
            reach={reach}
            offers={offers}
            sortedMark={sortedMark}
            board={board}
            map={map}
            tiles={appEnv().MAP_TILES_URL ?? null}
            bookedCount={upcoming.length}
            cardTiles={cardTiles(board.quals, open.shifts.length, urgent)}
          />
          <CountedTabBar current="home" counts={counts} />
          {/* Phase 33.3: her first-login tour, by itself until she's finished or skipped it
              (never in the copy kept for no signal: src/app/casual-tour.tsx). */}
          <CasualTour
            firmName={firm.name}
            seen={tourSeen}
            laterKey={tourLaterKey(session.id)}
            autoOpen
          />
        </main>
      </>
    );
  }
  return (
    <main className={page.staff}>
      <h1 className="text-3xl font-bold">ShiftDesk</h1>
      <p className="mt-2">Staff portal coming soon.</p>
    </main>
  );
}
