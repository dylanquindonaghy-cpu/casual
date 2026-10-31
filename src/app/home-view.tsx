import type { MyPayDay } from "@/lib/portal/pay-day";
import Link from "next/link";
import type { ReactNode } from "react";
import type { NeedsItem } from "@/lib/credentials/status";
import { initials } from "@/lib/office/board-copy";
import { timeOnDay } from "@/lib/portal/format";
import {
  applyRowText,
  needsRowText,
  offlineUrgentText,
  payDayRowText,
  urgentRowText,
  type RowText,
} from "@/lib/portal/home-copy";
import type { MyShift } from "@/lib/portal/my-shifts";
import type { OpenShift, OpenShiftsList } from "@/lib/portal/open-shifts";
import { dateParts, datePartsOfDay } from "@/lib/portal/sign-copy";
import { AREA_PROMPT, AREA_PROMPT_LINK, TRAVEL_PATH } from "@/lib/portal/travel-copy";
import { wallTimeOf } from "@/lib/time/zoned";
import type { StaffPhoto } from "@/lib/uploads/photo";
import { HomeScreenHint } from "./home-screen-hint";
import { OfflineNotice } from "./my-shifts-view";
import { EmptyPass, NextPass } from "./next-pass";
import { staffH2, staffRows, tapRow } from "./ui/classes";
import { Icon, type IconName } from "./ui/icons";
import { Plate } from "./ui/plate";
import { DateTile } from "./ui/sign";

// Home (docs/office-v2.md 4.2; docs/screens.md `/`; 12H.1; Phases 18, 20 and 24), one question:
// "when and where is my next shift, and is there anything I should do?". In this order: "Hi {first
// name}" (when it was updated sits at the end of the firm's bar); the no-signal notice (shown only
// in the offline copy); her next shift as a pass with Directions, Details and "Can't make it?" in
// it (src/app/next-pass.tsx); with nothing booked, an empty pass and "Find a shift". Then, as round
// 7 of the canvas has them (24.6), glass cards of rows, each a tile (a date, her initials or an
// icon), two lines and a chevron: "Do this" (what needs doing on Profile, only when something
// does), "Shifts you can take" (the urgent shifts she can take, or offline that they need signal;
// her home area to add while she has none; the other shifts she can apply for) and "Pay" (pay day).
// Her other booked shifts are on the Shifts tab (`/shifts`). Server-rendered; only "Can't make it?"
// and the home screen hint are client components.

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
  pay: MyPayDay; // the day this pay period's shifts are paid, on the firm's calendar (P3)
}

const time = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
};

export function HomeView(props: HomeViewProps) {
  const { firstName, timeZone, now } = props;
  const updated = time(now, timeZone);
  // The kept copy can be opened days later, so what it says about itself carries the day too.
  const savedAt = timeOnDay(now, timeZone);
  return (
    <div className="flex flex-col gap-5">
      {/* "Updated 11:20" sits at the end of the firm's bar above (its row's middle is 52px above
          this header: the bar's 56px row, then the page's 24px top), and scrolls with the page. */}
      <header className="relative">
        <h1 className="font-greet text-3xl text-ink">Hi {firstName}</h1>
        <p
          data-online-only=""
          className="absolute right-0 -top-13 -translate-y-1/2 text-base text-ink-muted tabular-nums"
        >
          Updated {updated}
        </p>
      </header>
      <OfflineNotice updated={savedAt} />
      {props.next ? <NextPass shift={props.next} timeZone={timeZone} now={now} /> : <EmptyPass />}
      <DoThis {...props} />
      <ShiftsYouCanTake {...props} savedAt={savedAt} />
      <PaySection pay={props.pay} />
      <HomeScreenHint />
    </div>
  );
}

// --- The rows ------------------------------------------------------------------------------

// A section of Home: its heading and one glass card of rows.
function Section({
  id,
  title,
  className = "",
  children,
}: {
  id: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex animate-in flex-col gap-3">
      <h2 id={`${id}-heading`} className={`${staffH2} mt-4`}>
        {title}
      </h2>
      <ul
        role="list"
        className={[staffRows, "overflow-hidden", className].filter(Boolean).join(" ")}
      >
        {children}
      </ul>
    </section>
  );
}

// The tile at a row's start: a little glass square with an icon (pale red when urgent).
function IconTile({ name, urgent = false }: { name: IconName; urgent?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-13 shrink-0 items-center justify-center rounded-[14px] ${
        urgent ? "bg-urgent-tile text-urgent-ink" : "glass-tile text-ink"
      }`}
    >
      <Icon name={name} size={24} />
    </span>
  );
}

// A shift's day as the row's tile.
const DayTile = ({
  day,
  urgent = false,
}: {
  day: { dow: string; day: string };
  urgent?: boolean;
}) => <DateTile dow={day.dow} day={day.day} urgent={urgent} />;

// One row: its tile, the words (what it is, then a line), a chevron; the whole row is the link.
// `kind` marks it for the offline copy and the tests; `extra` carries data-online-only or
// data-offline-only.
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
      </span>
      {href && <Icon name="chevron" size={22} className="text-ink-muted" />}
    </>
  );
  return (
    <li {...extra} data-for-you={kind}>
      {href ? (
        <Link href={href} className={`${tapRow} press min-h-20 px-4`}>
          {body}
        </Link>
      ) : (
        <div className={`${tapRow} min-h-20 px-4 hover:bg-transparent`}>{body}</div>
      )}
    </li>
  );
}

// "Do this": what needs doing, worst first (Profile has them all). Her staff photo shows as her
// initials; a qualification as its icon; something that stops her working is pale red with
// "Needs doing now" over it. Only when something needs doing.
function DoThis({ firstName, lastName, timeZone, now, needs, photo }: HomeViewProps) {
  const need = needsRowText(needs, photo, wallTimeOf(now, timeZone).year);
  if (!need) return null;
  const lead = need.photo ? (
    <span
      aria-hidden="true"
      className="glass-tile flex size-13 shrink-0 items-center justify-center rounded-full text-lg font-medium text-ink"
    >
      {initials(`${firstName} ${lastName}`)}
    </span>
  ) : (
    <IconTile name={need.urgent ? "urgent" : "notice"} urgent={need.urgent} />
  );
  return (
    <Section id="do-this" title="Do this" className={need.urgent ? "" : "glass-band"}>
      <Row
        kind="needs"
        href={need.href}
        lead={lead}
        text={{ title: need.title, sub: need.sub }}
        plate={
          need.urgent ? (
            <Plate tone="urgent" className="mb-1">
              Needs doing now
            </Plate>
          ) : undefined
        }
      />
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

// "Shifts you can take": the urgent ones (to the urgent board), the other ones she can apply for
// (to Open shifts), her home area to add while she has none; offline, that they need signal.
function ShiftsYouCanTake({ timeZone, open, savedAt }: HomeViewProps & { savedAt: string }) {
  const urgent = open.shifts.filter((s) => s.isUrgent);
  const rest = open.shifts.filter((s) => !s.isUrgent);
  const areaPrompt = open.travelOn && !open.area;
  const urgentDay = soonest(urgent, timeZone);
  const restDay = soonest(rest, timeZone);
  return (
    <Section id="can-take" title="Shifts you can take">
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
        lead={<IconTile name="offline" />}
        text={{ title: "Open shifts need signal", sub: offlineUrgentText(urgent.length, savedAt) }}
      />
      {areaPrompt && (
        <Row
          kind="area"
          href={TRAVEL_PATH}
          extra={{ "data-online-only": "" }}
          lead={<IconTile name="pin" />}
          text={{ title: AREA_PROMPT_LINK, sub: AREA_PROMPT }}
        />
      )}
      <Row
        kind="apply"
        href="/shifts/open"
        extra={{ "data-online-only": "" }}
        lead={restDay ? <DayTile day={restDay} /> : <IconTile name="shifts" />}
        text={applyRowText(rest, urgent.length > 0, open.offerAlerts, timeZone)}
      />
    </Section>
  );
}

// "Pay": the Friday this week's shifts are paid (D8), to Pay.
function PaySection({ pay }: { pay: MyPayDay }) {
  return (
    <Section id="pay" title="Pay">
      <Row
        kind="pay"
        href="/pay"
        lead={<DayTile day={datePartsOfDay(pay.payDay)} />}
        text={payDayRowText(pay.payDay, pay)}
      />
    </Section>
  );
}
