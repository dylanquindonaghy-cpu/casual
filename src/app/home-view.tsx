import Link from "next/link";
import type { NeedsItem } from "@/lib/credentials/status";
import { timeOnDay } from "@/lib/portal/format";
import {
  applyTileText,
  needsRowText,
  offlineUrgentText,
  payDayTileText,
  urgentTileText,
  type TileText,
} from "@/lib/portal/home-copy";
import type { MyShift } from "@/lib/portal/my-shifts";
import type { OpenShiftsList } from "@/lib/portal/open-shifts";
import { AREA_PROMPT, AREA_PROMPT_LINK, TRAVEL_PATH } from "@/lib/portal/travel-copy";
import { wallTimeOf } from "@/lib/time/zoned";
import type { StaffPhoto } from "@/lib/uploads/photo";
import { HomeScreenHint } from "./home-screen-hint";
import { OfflineNotice } from "./my-shifts-view";
import { EmptyPass, NextPass } from "./next-pass";
import { h2 } from "./ui/classes";

// Home (docs/office-v2.md 4.2; docs/screens.md `/`; 12H.1; Phases 18 and 20), one question:
// "when and where is my next shift, and is there anything I should do?". In this order: "Hi {first
// name}" and when it was updated; the no-signal notice (shown only in the offline copy); her next
// shift as a pass with Directions, Details and "Can't make it?" under it (src/app/next-pass.tsx);
// with nothing booked, an empty pass and "Find a shift"; then "For you" as tiles, each in the
// colour of what it is: the urgent shifts she can take (or, offline, that they need signal), what
// needs doing on Profile, her home area to add (while she has none), the other shifts she can
// apply for, and pay day. Her other booked shifts are on the Shifts tab (`/shifts`).
// Server-rendered; only "Can't make it?" and the home screen hint are client components.

export interface HomeViewProps {
  firstName: string;
  firmName: string;
  timeZone: string;
  now: Date;
  next: MyShift | null; // her next booking (or the one on now)
  needs: NeedsItem[];
  photo: StaffPhoto;
  open: OpenShiftsList; // the shifts she can take, urgent first (src/lib/portal/open-shifts.ts)
  payDay: string; // yyyy-mm-dd: the Friday this week's shifts are paid (D8)
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
      <header className="flex items-end justify-between gap-3">
        <h1 className="font-greet text-4xl text-ink">Hi {firstName}</h1>
        <p className="pb-1 text-base text-ink-muted tabular-nums">Updated {updated}</p>
      </header>
      <OfflineNotice updated={savedAt} />
      {props.next ? (
        <NextPass shift={props.next} timeZone={timeZone} now={now} firmName={props.firmName} />
      ) : (
        <EmptyPass />
      )}
      <ForYou {...props} savedAt={savedAt} />
      <HomeScreenHint />
    </div>
  );
}

// --- For you -------------------------------------------------------------------------------

// Each tile's colours: what it is about.
type Tone = "urgent" | "todo" | "wait" | "done" | "quiet";
const TONE: Record<Tone, string> = {
  urgent: "bg-urgent-tile text-urgent-ink",
  todo: "bg-hivis text-on-hivis",
  wait: "bg-wait-tile text-wait-ink",
  done: "bg-done-tile text-done-ink",
  quiet: "bg-raised text-ink",
};

function Tile({
  kind,
  href,
  tone,
  text,
  extra,
}: {
  kind: string;
  href?: string;
  tone: Tone;
  text: TileText;
  extra?: Record<string, string>;
}) {
  const body = (
    <>
      <span className="text-sm font-semibold">{text.label}</span>
      <span className="mt-auto pt-3 text-2xl leading-tight font-medium tracking-tight">
        {text.value}
      </span>
      {text.caption && <span className="text-sm">{text.caption}</span>}
    </>
  );
  const box = `flex h-full min-h-33 flex-col gap-0.5 rounded-[20px] border border-current/15 px-4 pt-3.5 pb-4 shadow-lift ${TONE[tone]}`;
  return (
    <li {...extra} data-for-you={kind}>
      {href ? (
        <Link
          href={href}
          className={`${box} hover:brightness-[0.97] focus-visible:outline-offset-2`}
        >
          {body}
        </Link>
      ) : (
        <div className={box}>{body}</div>
      )}
    </li>
  );
}

function ForYou({
  timeZone,
  now,
  needs,
  photo,
  open,
  savedAt,
  payDay,
}: HomeViewProps & { savedAt: string }) {
  const urgent = open.shifts.filter((s) => s.isUrgent);
  const rest = open.shifts.filter((s) => !s.isUrgent);
  const need = needsRowText(needs, photo, wallTimeOf(now, timeZone).year);
  const areaPrompt = open.travelOn && !open.area;
  return (
    <section aria-labelledby="for-you-heading" className="flex animate-in flex-col gap-2.5">
      <h2 id="for-you-heading" className={`${h2} mt-2`}>
        For you
      </h2>
      <ul role="list" className="grid grid-cols-2 gap-2.5">
        {urgent.length > 0 && (
          <Tile
            kind="urgent"
            href="/urgent"
            tone="urgent"
            extra={{ "data-online-only": "" }}
            text={urgentTileText(urgent, open.travelOn && open.area !== null, timeZone)}
          />
        )}
        <Tile
          kind="offline"
          tone="quiet"
          extra={{ "data-offline-only": "" }}
          text={{
            label: "Open shifts",
            value: "Need signal",
            caption: offlineUrgentText(urgent.length, savedAt),
          }}
        />
        {need && (
          <Tile
            kind="needs"
            href={need.href}
            tone={need.urgent ? "urgent" : "todo"}
            text={{
              label: need.urgent ? "Needs doing now" : "Needs doing",
              value: need.title,
              caption: need.sub,
            }}
          />
        )}
        {areaPrompt && (
          <Tile
            kind="area"
            href={TRAVEL_PATH}
            tone="wait"
            extra={{ "data-online-only": "" }}
            text={{ label: "Your home area", value: AREA_PROMPT_LINK, caption: AREA_PROMPT }}
          />
        )}
        <Tile
          kind="apply"
          href="/shifts/open"
          tone="wait"
          extra={{ "data-online-only": "" }}
          text={applyTileText(rest, urgent.length > 0, open.offerAlerts, timeZone)}
        />
        <Tile kind="pay" href="/pay" tone="done" text={payDayTileText(payDay)} />
      </ul>
    </section>
  );
}
