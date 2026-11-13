import type { MyPayDay } from "@/lib/portal/pay-day";
import Link from "next/link";
import type { ReactNode } from "react";
import type { NeedsItem } from "@/lib/credentials/status";
import { timeOnDay } from "@/lib/portal/format";
import {
  type CountPill,
  type QualRow,
  type RecordFigure,
  type UpdateRow,
} from "@/lib/portal/home-board";
import type { WeekRow } from "@/lib/portal/home-week";
import { homeMap, nearestOpen, type HomeMap } from "@/lib/portal/home-map";
import { HOME_TITLE, payDayText, TITLE_LINKS } from "@/lib/portal/home-map-copy";
import {
  applyRowText,
  dateLineText,
  needsRowText,
  offerRowText,
  offlineUrgentText,
  payDayRowText,
  REACH_PATH,
  REACH_ROWS,
  updatedText,
  urgentRowText,
  type RowText,
} from "@/lib/portal/home-copy";
import type { SortedMark } from "@/lib/portal/in-hand";
import type { MyOffer } from "@/lib/portal/my-offers";
import type { MyShift } from "@/lib/portal/my-shifts";
import type { OpenShift, OpenShiftsList } from "@/lib/portal/open-shifts";
import type { ReachPrompt } from "@/lib/portal/reach-me";
import { dateParts, datePartsOfDay } from "@/lib/portal/sign-copy";
import { AREA_PROMPT, AREA_PROMPT_LINK, TRAVEL_PATH } from "@/lib/portal/travel-copy";
import { wallTimeOf } from "@/lib/time/zoned";
import type { StaffPhoto } from "@/lib/uploads/photo";
import { HomeCounts } from "./home/home-counts";
import { HomeQualifications } from "./home/home-qualifications";
import { HomeRecord } from "./home/home-record";
import { HomeUpdates } from "./home/home-updates";
import { HomeWeek } from "./home/home-week";
import { HomeScreenHint } from "./home-screen-hint";
import { OfflineNotice } from "./my-shifts-view";
import { OfferedToYou } from "./offered-to-you";
import { MapEmptyPass, MapPass, type CardTiles } from "./next-pass";
import { HomeMapView } from "./home/home-map";
import {
  countPill,
  disc,
  headingGap,
  rowLead,
  staffBtnInline,
  staffH2,
  tapRow,
} from "./ui/classes";
import { Icon, type IconName } from "./ui/icons";
import { PageHeader } from "./ui/page-header";
import { Plate } from "./ui/plate";
import { DateTile } from "./ui/sign";

// Home (docs/office-v2.md 4.2; docs/screens.md `/` and "The casual app, Phase 28", 28.7; 12H.1;
// Phases 18, 20, 24 and 28), one question: "when and where is my next shift, and is there anything
// I should do?". In this order: "Hi {first name}" as the page's headline, "Updated 21:34" beside it
// (online only: PageHeader); the no-signal notice (shown only in the offline copy); her next shift
// as a pass with Directions, Details and "Can't make it?" in it (src/app/next-pass.tsx); with
// nothing booked, an empty pass and "See open shifts". Then, 32px apart, the office's sections
// (Phase 28.7): one glass section each, its heading inside, then its rows 12px under it, each row a
// clear glass tile 8px from the next with its lead (a date tile, or the office's round tinted disc
// with an icon), two lines and a chevron: "Do this" (an amber leaf before its heading; what needs
// doing on Profile, then, online only, "We can't reach you about shifts" and "Open-shift alerts
// are off"), "Offered to you" (Phase 28.15, online only, while she has offers still open to her:
// src/app/offered-to-you.tsx), "Shifts you can take" (the urgent shifts she can take, or offline that they need
// signal; her travel area to add while she has none; the other shifts she can take) and "Pay" (pay
// day). Her other booked shifts are on the Shifts tab (`/shifts`). Server-rendered; only "Can't
// make it?", "Offered to you" and the home screen hint are client components.
//
// Phase 30.1 (docs/screens.md "### 30.1"): Home is her dashboard. Under "Hi Zoe" the date line
// ("Friday 6 November · Updated 15:38", online only: the kept copy's notice gives the day it was
// saved) and her counts in the office's chips
// (src/app/home/home-counts.tsx); the pass gets a line ("Starts in 3 days · 8 hours · about
// £108.00 before tax") and a bar filling over the last 7 days; then, in this order on a phone:
// "Do this", "Offered to you" (still above "Shifts you can take", as 28.15 has it), "Your
// qualifications", "Your week", "Shifts you can take" (its count beside its heading), "Updates",
// "Pay" and "Your record" (src/app/home/*). From 1024px a
// 12-column grid (page.staffWide): the pass 7 columns beside the qualifications' 5; the week,
// shifts you can take and updates 4 each; pay and the record 6 each; "Do this" and "Offered to you"
// the whole width. The grid packs densely, so a full-width section never leaves a hole beside the
// one before it. Every figure is worked out by code (src/lib/portal/home-board.ts, home-week.ts).

export interface HomeViewProps {
  firstName: string;
  lastName: string;
  firmName: string;
  timeZone: string;
  now: Date;
  next: MyShift | null; // her next booking (or the one on now)
  needs: NeedsItem[];
  photo: StaffPhoto;
  open: OpenShiftsList; // the shifts she can take, urgent first (src/lib/portal/open-shifts.ts)
  pay: MyPayDay; // the next pay day not yet past and the shifts it pays, as the office's (37.1)
  // Phase 28.7: nothing can reach her, or her open-shift alerts are off
  // (src/lib/portal/reach-me.ts). Online only.
  reach?: ReachPrompt[];
  // Phase 28.15: her offers still open to her (src/lib/portal/my-offers.ts). Online only.
  offers?: MyOffer[];
  // The office's latest "Mark as sorted" for her: a need it has in hand isn't in "Do this"
  // (src/lib/portal/in-hand.ts, as on Profile).
  sortedMark?: SortedMark | null;
  // Phase 30.1: the dashboard's parts, each worked out by the page from her own rows. Left out by
  // the older pages' own fixtures (only the sections they test are shown).
  board?: HomeBoard;
  // Phase 32 (32.2): the street map's pins and tab counts (src/lib/portal/home-map.ts), the firm's
  // street map file (none: the plain map), her upcoming bookings' count ("1 of 3") and the card's
  // two tiles. Without `map` (the older pages' own fixtures) the map has its counts and no pins.
  map?: HomeMap;
  tiles?: string | null;
  bookedCount?: number;
  cardTiles?: CardTiles | null;
}

export interface HomeBoard {
  pills: CountPill[];
  quals: QualRow[];
  weeks: WeekRow[];
  updates: UpdateRow[];
  record: RecordFigure[];
}

export function HomeView(props: HomeViewProps) {
  const { timeZone, now, board, next, map } = props;
  // The kept copy can be opened days later, so what it says about itself carries the day too.
  const savedAt = timeOnDay(now, timeZone);
  // Without the page's map (the older pages' own fixtures): the same tabs' counts, no pins.
  const shown =
    map ??
    homeMap({
      next,
      nextPlace: null,
      open: props.open.shifts,
      places: new Map(),
      now,
      timeZone,
    });
  return (
    <>
      {/* Phase 32 (32.2): the office's title row. "Home" with "Updated 12:29" on its baseline
          (PageHeader's, online only), the date and pay day under it (online only, all of it: the
          kept copy would call the day it was saved today; its notice gives that day), and from
          1024px the two ways on at its right, as the office's dashboard has its own. */}
      <PageHeader
        title={HOME_TITLE}
        updated={updatedText(now, timeZone)}
        beside
        actions={TITLE_LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={staffBtnInline}>
            <Icon name={l.icon} size={20} />
            {l.words}
          </Link>
        ))}
      >
        <p data-date-line="" data-online-only="" className="text-base text-ink-muted">
          {dateLineText(now, timeZone)}
          {" · "}
          {payDayText(props.pay.payDay)}
        </p>
      </PageHeader>
      {/* The counts in a block of their own (the page's width, never their own), 12px under the
          date line, so their row scrolls inside itself and never widens the page. From 1024px
          they're in the top bar (src/app/casual-top-bar.tsx), so not here. */}
      {board && (
        <div className="-mt-3 mb-6 lg:hidden">
          <HomeCounts pills={board.pills} />
        </div>
      )}
      <div className="flex flex-col gap-8">
        <OfflineNotice updated={savedAt} />
        <div className="flex flex-col gap-8 lg:grid lg:grid-flow-row-dense lg:grid-cols-12 lg:items-start lg:gap-6">
          <div className="lg:col-span-12">
            <HomeMapView
              pins={shown.pins}
              counts={shown.counts}
              tiles={props.tiles ?? null}
              card={
                next ? (
                  <MapPass
                    shift={next}
                    timeZone={timeZone}
                    now={now}
                    count={props.bookedCount ?? 1}
                    tiles={props.cardTiles ?? null}
                  />
                ) : (
                  <MapEmptyPass
                    nearest={nearestOpen(props.open.shifts, now)}
                    openCount={props.open.shifts.length}
                    timeZone={timeZone}
                  />
                )
              }
            />
          </div>
          <DoThis {...props} />
          {/* Her offers stay above "Shifts you can take" (28.15), on a phone and in the grid. */}
          {props.offers && props.offers.length > 0 && (
            <div className="lg:col-span-12">
              <OfferedToYou
                offers={props.offers.map((o) => ({
                  offerId: o.offerId,
                  shiftId: o.shiftId,
                  afterNo: o.afterNo,
                  day: dateParts(o.startsAt, timeZone),
                  text: offerRowText(o, now, timeZone), // with what she can do now (o.take)
                }))}
              />
            </div>
          )}
          {board && <HomeQualifications rows={board.quals} className="lg:col-span-4" />}
          {board && <HomeWeek weeks={board.weeks} className="lg:col-span-4" />}
          <ShiftsYouCanTake {...props} savedAt={savedAt} />
          {board && <HomeUpdates rows={board.updates} className="lg:col-span-4" />}
          <PaySection pay={props.pay} />
          {board && <HomeRecord figures={board.record} className="lg:col-span-6" />}
        </div>
      </div>
      <HomeScreenHint />
    </>
  );
}

// --- The sections and their rows ----------------------------------------------------------

// A section of Home, as the office's (its Needs attention and the dashboard's columns): one glass
// section 12px round, its heading inside (after a leaf in its status's colour, where it has one),
// then its rows 12px under it, 8px apart. `extra` carries data-online-only for a section whose
// every row needs signal.
function Section({
  id,
  title,
  leaf,
  extra,
  count,
  className = "",
  children,
}: {
  id: string;
  title: string;
  leaf?: string; // the leaf's colour class
  extra?: Record<string, string>;
  // Phase 30.1: the office's count pill beside the heading (outside the <h2>), online only.
  count?: number;
  className?: string; // its place in Home's grid from 1024px
  children: ReactNode;
}) {
  return (
    <section
      {...extra}
      aria-labelledby={`${id}-heading`}
      className={`glass animate-in rounded-inner p-4 ${className}`}
    >
      <div className="flex items-center gap-3 px-1">
        {leaf && <Icon name="leaf" size={18} className={leaf} />}
        <h2 id={`${id}-heading`} className={staffH2}>
          {title}
        </h2>
        {count !== undefined && (
          <span data-online-only="" className={countPill}>
            {count}
          </span>
        )}
      </div>
      <ul role="list" className={`${headingGap} flex flex-col gap-2`}>
        {children}
      </ul>
    </section>
  );
}

// The office's round tinted disc as a row's lead (its Updates' discs), with the row's icon: pale
// red for what stops her working, pale amber for something to do, clear glass with grey otherwise.
// It sits in the width of a date tile, so every row's words start at the same place.
type DiscTone = "urgent" | "attention" | "quiet";
function DiscLead({ name, tone }: { name: IconName; tone: DiscTone }) {
  return (
    <span aria-hidden="true" className={rowLead}>
      <span className={`${disc.base} ${disc[tone]}`}>
        <Icon name={name} size={18} />
      </span>
    </span>
  );
}

// A shift's day as the row's lead.
const DayTile = ({
  day,
  urgent = false,
}: {
  day: { dow: string; day: string };
  urgent?: boolean;
}) => <DateTile dow={day.dow} day={day.day} urgent={urgent} />;

// One row, a clear glass tile: its lead, the words (what it is, then a line), a chevron; the whole
// row is the link. `kind` marks it for the offline copy and the tests; `extra` carries
// data-online-only or data-offline-only.
const tile = `${tapRow} glass-tile rounded-row min-h-20`;
function Row({
  kind,
  href,
  lead,
  text,
  plate,
  extra,
}: {
  kind: string;
  href?: string;
  lead: ReactNode;
  text: RowText;
  plate?: ReactNode;
  extra?: Record<string, string>;
}) {
  const body = (
    <>
      {lead}
      <span className="min-w-0 flex-1">
        {plate}
        {plate && " "}
        <span className="block text-lg leading-snug font-medium text-ink">{text.title}</span>{" "}
        <span className="block text-base text-ink-muted">{text.sub}</span>
        {text.note && <span className="block text-base text-ink-muted">{text.note}</span>}
      </span>
      {href && <Icon name="chevron" size={22} className="text-ink-muted" />}
    </>
  );
  return (
    <li {...extra} data-for-you={kind}>
      {href ? (
        <Link href={href} className={`${tile} press`}>
          {body}
        </Link>
      ) : (
        <div className={`${tile} hover:bg-transparent`}>{body}</div>
      )}
    </li>
  );
}

// "Do this": what needs doing, worst first (Profile has them all): a qualification as its icon,
// her staff photo as a camera (never her initials), something that stops her working pale red with
// "Needs doing now" over it. Then, online only (Phase 28.7), "We can't reach you about shifts" and
// "Open-shift alerts are off", both to Profile's "How we reach you". Only when something needs
// doing; online only when only those two do.
function DoThis({ timeZone, now, needs, photo, reach = [], sortedMark = null }: HomeViewProps) {
  const need = needsRowText(needs, photo, wallTimeOf(now, timeZone).year, sortedMark);
  if (!need && reach.length === 0) return null;
  return (
    <Section
      id="do-this"
      title="Do this"
      leaf="text-attention-ink"
      className="lg:col-span-12"
      extra={need ? undefined : { "data-online-only": "" }}
    >
      {need && (
        <Row
          kind="needs"
          href={need.href}
          lead={
            <DiscLead
              name={need.photo ? "camera" : need.urgent ? "urgent" : "notice"}
              tone={need.urgent ? "urgent" : "attention"}
            />
          }
          text={{ title: need.title, sub: need.sub }}
          plate={
            need.urgent ? (
              <Plate tone="urgent" className="mb-1">
                Needs doing now
              </Plate>
            ) : undefined
          }
        />
      )}
      {reach.map((r) => (
        <Row
          key={r}
          kind={r === "unreachable" ? "reach" : "alerts"}
          href={REACH_PATH}
          extra={{ "data-online-only": "" }}
          lead={<DiscLead name={r === "unreachable" ? "messages" : "bell"} tone="attention" />}
          text={REACH_ROWS[r]}
        />
      ))}
    </Section>
  );
}

const soonest = (shifts: OpenShift[], timeZone: string) => {
  const first = shifts.reduce<OpenShift | null>(
    (a, s) => (a === null || s.startsAt.getTime() < a.startsAt.getTime() ? s : a),
    null,
  );
  return first ? dateParts(first.startsAt, timeZone) : null;
};

// "Shifts you can take": the urgent ones (to the urgent board), the other ones she can take (to
// Open shifts), her travel area to add while she has none; offline, that they need signal. With
// none, "We'll message you" only when we can: never beside "We can't reach you about shifts".
function ShiftsYouCanTake({
  timeZone,
  open,
  savedAt,
  reach = [],
  board,
}: HomeViewProps & { savedAt: string }) {
  const urgent = open.shifts.filter((s) => s.isUrgent);
  const rest = open.shifts.filter((s) => !s.isUrgent);
  const areaPrompt = open.travelOn && !open.area;
  const willMessage = open.offerAlerts && !reach.includes("unreachable");
  const urgentDay = soonest(urgent, timeZone);
  const restDay = soonest(rest, timeZone);
  return (
    <Section
      id="can-take"
      title="Shifts you can take"
      count={board ? open.shifts.length : undefined}
      className="lg:col-span-4"
    >
      {urgent.length > 0 && urgentDay && (
        <Row
          kind="urgent"
          href="/urgent"
          extra={{ "data-online-only": "" }}
          lead={<DayTile day={urgentDay} urgent />}
          text={urgentRowText(urgent, open.travelOn && open.area !== null, timeZone)}
        />
      )}
      <Row
        kind="offline"
        extra={{ "data-offline-only": "" }}
        lead={<DiscLead name="offline" tone="quiet" />}
        text={{ title: "Open shifts need signal", sub: offlineUrgentText(urgent.length, savedAt) }}
      />
      {areaPrompt && (
        <Row
          kind="area"
          href={TRAVEL_PATH}
          extra={{ "data-online-only": "" }}
          lead={<DiscLead name="pin" tone="quiet" />}
          text={{ title: AREA_PROMPT_LINK, sub: AREA_PROMPT }}
        />
      )}
      <Row
        kind="apply"
        href="/shifts/open"
        extra={{ "data-online-only": "" }}
        lead={restDay ? <DayTile day={restDay} /> : <DiscLead name="shifts" tone="quiet" />}
        text={applyRowText(rest, urgent.length > 0, willMessage, timeZone)}
      />
    </Section>
  );
}

// "Pay": the next pay day, the shifts it pays and, when this period is paid later, that day (37.1),
// to Pay.
function PaySection({ pay }: { pay: MyPayDay }) {
  return (
    <Section id="pay" title="Pay" className="lg:col-span-6">
      <Row
        kind="pay"
        href="/pay"
        lead={<DayTile day={datePartsOfDay(pay.payDay)} />}
        text={payDayRowText(pay.payDay, pay)}
      />
    </Section>
  );
}
