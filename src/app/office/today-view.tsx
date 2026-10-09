import Link from "next/link";
import type { ReactNode } from "react";
import type { TodayEvidence, TodayShift, TodayView } from "@/lib/office/today";
import {
  placesText,
  requestsText,
  sheetChangeText,
  sheetNameText,
  stoppedText,
  toCheckText,
  toMarkText,
  waveText,
} from "@/lib/office/today-copy";
import { noticeText } from "@/lib/portal/cancel-reasons";
import { roleLabel, shiftWhen, timeOnDay } from "@/lib/portal/format";
import { dayLabel } from "@/lib/rules/reasons";
import { lineWords } from "@/lib/tenancy/shifts-line";
import {
  btn,
  card,
  count,
  h2,
  headingGap,
  meta,
  row,
  rows,
  sectionGap,
  textLink,
  textLinkInGroup,
} from "../ui/classes";
import { StatusChip } from "../ui/status-chip";
import { BookingToCheckActions } from "./keep-booking";
import { ShiftActions } from "./shift-actions";

// The office's Today view (docs/screens.md `/office/today`; layout: docs/ui-design.md "Today").
// Pure: the page loads the data. A summary of counts first (each a link to its section), then the
// sections in the order things need doing. Urgent shifts and bookings to check are action cards;
// the other lists are compact rows inside one card.

// A message from a number we don't know shows its first 300 characters (the rest is stored).
const UNKNOWN_TEXT_MAX = 300;

// Each section's heading: the same words label its summary tile. The keys are the headings' ids
// (the summary's links and each section's aria-labelledby).
const HEADINGS = {
  urgent: "Urgent shifts",
  "to-check": "Bookings to check",
  "from-sheet": "From your rota sheet",
  evidence: "Strike evidence",
  requests: "Requests",
  gaps: "Gaps in the next 7 days",
  "to-mark": "Who worked?",
  cancelled: "Cancelled in the last 24 hours",
  unknown: "Messages from numbers we don't know",
  expiring: "Credentials expiring this week",
} as const;
type SectionId = keyof typeof HEADINGS;

// A shift's title link ("Steward at Acme Demo Arena") and every other link in a line here: the
// shared inline link (grey underline, darker on hover), as on every office page.
const titleLink = textLink;
// A title link whose click area covers its whole block (`relative group`, with no other link or
// button in it), so the target is big while the words stay the link's name; hovering anywhere on
// the block darkens its underline.
const block = "group relative";
const stretched = `${textLinkInGroup} after:absolute after:inset-0`;

function ShiftTitle({
  shift,
  stretch = false,
}: {
  shift: Pick<TodayShift, "shiftId" | "role" | "site">;
  stretch?: boolean;
}) {
  return (
    <Link href={`/office/shifts/${shift.shiftId}`} className={stretch ? stretched : titleLink}>
      {roleLabel(shift.role)}
      {shift.site ? ` at ${shift.site}` : ""}
    </Link>
  );
}

// "50" / "50+" (the list stops at 50).
const shown = (n: number, more: boolean) => (more ? `${n}+` : String(n));

// --- Summary ---------------------------------------------------------------------------------

// How a tile looks: red when urgent things are waiting, amber when someone needs to act, plain
// for information, and calm with a check at 0. The number and the words always say it too.
type TileTone = "urgent" | "attention" | "quiet" | "calm";

const TILE =
  "flex h-full flex-col justify-between gap-2 rounded-xl border-2 p-3 shadow-sm hover:border-ink sm:min-h-24 sm:gap-3 sm:p-4";
const TILE_TONE: Record<TileTone, { tile: string; number: string; icon: string }> = {
  urgent: { tile: "border-urgent bg-urgent-soft", number: "text-urgent", icon: "text-urgent" },
  attention: {
    tile: "border-attention bg-attention-soft",
    number: "text-attention-ink",
    icon: "text-attention",
  },
  quiet: { tile: "border-line-strong bg-card", number: "text-ink", icon: "text-quiet-ink" },
  calm: { tile: "border-line bg-card", number: "text-ink-muted", icon: "text-done" },
};

// The tone icons (the same drawings as the status chips'): decorative, beside words.
const TONE_PATHS: Record<TileTone, ReactNode> = {
  urgent: (
    <>
      <path d="M12 3.5 2.5 20h19L12 3.5Z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </>
  ),
  attention: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  quiet: <path d="M6 12h12" />,
  calm: <path d="m5 12.5 4.5 4.5L19 7.5" />,
};

function ToneIcon({ tone, size = 20 }: { tone: TileTone; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${TILE_TONE[tone].icon}`}
    >
      {TONE_PATHS[tone]}
    </svg>
  );
}

type Tile = { id: SectionId; n: number; more: boolean; tone: Exclude<TileTone, "calm"> };

// "Strike evidence" (12C.4): each failed evidence email, and the strikes team's address while it
// isn't confirmed. Only shown when there's one.
const evidenceItems = (e: TodayEvidence) => e.failed.length + (e.addressConfirmed ? 0 : 1);

export function evidenceAddressText(waiting: number): string {
  const base =
    "The strikes team's email isn't set and confirmed, so strike records can't be emailed to them.";
  if (waiting === 0) return base;
  return `${base} ${waiting} ${waiting === 1 ? "record waits" : "records wait"} for it.`;
}

// One tile per section on the page, in the page's order. "Bookings to check" and "From your rota
// sheet" only exist when there's something in them.
function summaryTiles(view: Omit<TodayView, "officeUser">): Tile[] {
  const tiles: (Tile | false)[] = [
    { id: "urgent", n: view.urgent.length, more: false, tone: "urgent" },
    view.toCheck.length > 0 && {
      id: "to-check",
      n: view.toCheck.length,
      more: view.toCheckMore,
      tone: "urgent",
    },
    view.fromSheet.length > 0 && {
      id: "from-sheet",
      n: view.fromSheet.length,
      more: view.fromSheetMore,
      tone: "attention",
    },
    evidenceItems(view.evidence) > 0 && {
      id: "evidence",
      n: evidenceItems(view.evidence),
      more: view.evidence.failedMore,
      tone: "attention",
    },
    { id: "requests", n: view.requests.total, more: false, tone: "attention" },
    { id: "gaps", n: view.gaps.length, more: view.gapsMore, tone: "attention" },
    { id: "to-mark", n: view.toMark.length, more: view.toMarkMore, tone: "attention" },
    { id: "cancelled", n: view.cancellations.length, more: false, tone: "quiet" },
    { id: "unknown", n: view.unknownMessages.length, more: view.unknownMore, tone: "attention" },
    { id: "expiring", n: view.expiring.length, more: false, tone: "attention" },
  ];
  return tiles.filter((t): t is Tile => t !== false);
}

function Summary({ view }: { view: Omit<TodayView, "officeUser"> }) {
  return (
    <nav aria-label="Summary">
      <ul role="list" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {summaryTiles(view).map((t) => {
          const tone: TileTone = t.n === 0 ? "calm" : t.tone;
          return (
            <li key={t.id}>
              <a href={`#${t.id}`} className={`${TILE} ${TILE_TONE[tone].tile}`}>
                <span className="flex items-start justify-between gap-2">
                  <span
                    className={`text-3xl leading-none font-bold tabular-nums ${TILE_TONE[tone].number}`}
                  >
                    {shown(t.n, t.more)}
                  </span>
                  <ToneIcon tone={tone} />
                </span>{" "}
                <span className="text-sm leading-snug font-semibold text-ink">
                  {HEADINGS[t.id]}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// --- Sections --------------------------------------------------------------------------------

// A section: its heading (the summary's links land on it), a count beside it when there are any,
// then the content.
function Section({
  id,
  n = 0,
  more = false,
  children,
}: {
  id: SectionId;
  n?: number;
  more?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={sectionGap.office} aria-labelledby={id}>
      <div className="flex items-center">
        <h2 id={id} className={`${h2} scroll-mt-6`}>
          {HEADINGS[id]}
        </h2>
        {n > 0 && <span className={count}>{shown(n, more)}</span>}
      </div>
      {children}
    </section>
  );
}

// "No urgent shifts.": nothing to do here, with a check.
function Nothing({ children }: { children: ReactNode }) {
  return (
    <p className={`${headingGap} flex items-center gap-2 text-ink-muted`}>
      <ToneIcon tone="calm" size={18} />
      {children}
    </p>
  );
}

// "Showing the first 50." under a list.
function More({ children }: { children: ReactNode }) {
  return <p className={`mt-2 ${meta}`}>{children}</p>;
}

// "From your Google Sheet": its status is changed in the sheet (so it has no "Mark as filled").
function SheetChip({ shift }: { shift: TodayShift }) {
  return shift.fromSheet ? <StatusChip tone="quiet">From your Google Sheet</StatusChip> : null;
}

export function TodayContent({
  view,
  isAdmin = false,
}: {
  view: Omit<TodayView, "officeUser">;
  isAdmin?: boolean; // only admins can open Settings
}) {
  const tz = view.timeZone;
  return (
    <>
      <Summary view={view} />

      <Section id="urgent" n={view.urgent.length}>
        {view.urgent.length === 0 ? (
          <Nothing>No urgent shifts.</Nothing>
        ) : (
          <div className={`${headingGap} flex flex-col gap-3`}>
            {view.urgent.map((u) => (
              <article
                key={u.shiftId}
                className={`${card} flex flex-col gap-4 border-l-4 border-l-urgent lg:flex-row lg:items-start lg:justify-between lg:gap-6`}
              >
                <div className={`${block} min-w-0`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip tone="urgent">Urgent</StatusChip>
                    <StatusChip tone="attention">
                      {placesText(u.placesLeft, u.headcount)}
                    </StatusChip>
                    <SheetChip shift={u} />
                  </div>
                  <h3 className="mt-2 text-lg font-semibold">
                    <ShiftTitle shift={u} stretch />
                  </h3>
                  <p className="tabular-nums">{shiftWhen(u.startsAt, u.endsAt, tz)}</p>
                  <p className={`mt-2 ${meta} tabular-nums`}>{waveText(u)}</p>
                  {stoppedText(u) && <p className="text-sm font-semibold">{stoppedText(u)}</p>}
                  {u.escalated && <p className={meta}>The office was emailed about it.</p>}
                </div>
                <ShiftActions
                  shiftId={u.shiftId}
                  isUrgent
                  fromSheet={u.fromSheet}
                  className="lg:shrink-0"
                />
              </article>
            ))}
          </div>
        )}
      </Section>

      {view.toCheck.length > 0 && (
        <Section id="to-check" n={view.toCheck.length} more={view.toCheckMore}>
          <p className={`${headingGap} max-w-prose text-ink-muted`}>
            These people are booked, but can&apos;t work these shifts as things stand. Cancel the
            booking (they&apos;re told), or keep it.
          </p>
          <ul role="list" className={`${headingGap} flex flex-col gap-3`}>
            {view.toCheck.map((b) => (
              <li key={`${b.shiftId}-${b.workerId}`} className={card}>
                <p className="font-semibold">{toCheckText(b)}</p>
                <p className="mt-1">
                  <ShiftTitle shift={b} />
                  <span className="tabular-nums">, {shiftWhen(b.startsAt, b.endsAt, tz)}</span>
                </p>
                <p className="mt-1">
                  <Link href={`/office/casuals/${b.workerId}`} className={titleLink}>
                    {b.worker}&apos;s page
                  </Link>
                </p>
                <BookingToCheckActions shiftId={b.shiftId} workerId={b.workerId} name={b.worker} />
              </li>
            ))}
          </ul>
          {view.toCheckMore && <More>Showing the first 50.</More>}
        </Section>
      )}

      {view.fromSheet.length > 0 && (
        <Section id="from-sheet" n={view.fromSheet.length} more={view.fromSheetMore}>
          <p className={`${headingGap} max-w-prose text-ink-muted`}>
            Your rota sheet asks for these, but the app couldn&apos;t do them.
          </p>
          <ul role="list" className={`${headingGap} ${rows}`}>
            {view.fromSheet.map((i) => (
              <li key={i.shiftId} className={row}>
                <div className={block}>
                  <p className="font-semibold">
                    <ShiftTitle shift={i} stretch />
                  </p>
                  <p className={`${meta} tabular-nums`}>{shiftWhen(i.startsAt, i.endsAt, tz)}</p>
                </div>
                <div className="mt-2 flex max-w-prose flex-col gap-2">
                  {i.change && <p>{sheetChangeText(i.change)}</p>}
                  {i.names.map((n, k) => (
                    <p key={`${n.name}-${k}`}>{sheetNameText(n)}</p>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {view.fromSheetMore && <More>Showing the first 50.</More>}
        </Section>
      )}

      {evidenceItems(view.evidence) > 0 && (
        <Section id="evidence" n={evidenceItems(view.evidence)} more={view.evidence.failedMore}>
          <ul role="list" className={`${headingGap} ${rows}`}>
            {!view.evidence.addressConfirmed && (
              <li className={`${row} flex max-w-prose flex-col gap-2`}>
                <p>{evidenceAddressText(view.evidence.waiting)}</p>
                {isAdmin ? (
                  <Link href="/office/settings" className={`${titleLink} self-start`}>
                    Set it in Settings
                  </Link>
                ) : (
                  <p className={meta}>An admin can set it in Settings.</p>
                )}
              </li>
            )}
            {view.evidence.failed.map((f) => (
              <li key={f.assignmentId} className={`${row} flex max-w-prose flex-col gap-2`}>
                <p>
                  {f.casual}&apos;s strike record{" "}
                  {f.stuck ? "hasn't been emailed to" : "couldn't be emailed to"} the strikes team
                  (cancelled <span className="tabular-nums">{timeOnDay(f.cancelledAt, tz)}</span>).{" "}
                  {f.stuck
                    ? "It's held up."
                    : f.nothingSent
                      ? "Nothing was sent."
                      : "It may have arrived anyway."}
                </p>
                <Link
                  href={`/office/cancellations/${f.assignmentId}`}
                  className={`${titleLink} self-start`}
                >
                  Open the record to resend it
                </Link>
              </li>
            ))}
          </ul>
          {view.evidence.failedMore && <More>Showing the first 50.</More>}
        </Section>
      )}

      <Section id="requests" n={view.requests.total}>
        <div
          className={`${headingGap} ${card} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}
        >
          {view.requests.total === 0 ? (
            <p className="flex items-center gap-2 text-ink-muted">
              <ToneIcon tone="calm" size={18} />
              {requestsText(view.requests)}
            </p>
          ) : (
            <p className="font-semibold">{requestsText(view.requests)}</p>
          )}
          <Link
            href="/office/requests"
            className={`${view.requests.total > 0 ? btn.primary : btn.secondary} self-start sm:shrink-0 sm:self-auto`}
          >
            See requests
          </Link>
        </div>
      </Section>

      <Section id="gaps" n={view.gaps.length} more={view.gapsMore}>
        {view.gaps.length === 0 ? (
          <Nothing>No gaps in the next 7 days.</Nothing>
        ) : (
          <div className={`${headingGap} ${rows}`}>
            {view.gaps.map((g) => (
              <article
                key={g.shiftId}
                className={`${row} flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6`}
              >
                <div className={`${block} min-w-0 lg:py-0.5`}>
                  <p className="font-semibold">
                    <ShiftTitle shift={g} stretch />
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className={`${meta} tabular-nums`}>{shiftWhen(g.startsAt, g.endsAt, tz)}</p>
                    <StatusChip tone="attention">
                      {placesText(g.placesLeft, g.headcount)}
                    </StatusChip>
                    <SheetChip shift={g} />
                  </div>
                </div>
                <ShiftActions
                  shiftId={g.shiftId}
                  isUrgent={false}
                  fromSheet={g.fromSheet}
                  className="lg:shrink-0"
                />
              </article>
            ))}
          </div>
        )}
        {view.gapsMore && <More>Showing the first 50.</More>}
      </Section>

      <Section id="to-mark" n={view.toMark.length} more={view.toMarkMore}>
        {view.toMark.length === 0 ? (
          <Nothing>Nothing to mark from the last 7 days.</Nothing>
        ) : (
          <ul role="list" className={`${headingGap} ${rows}`}>
            {view.toMark.map((t) => (
              <li
                key={t.shiftId}
                className={`${block} ${row} hover:bg-quiet-soft first:rounded-t-xl last:rounded-b-xl lg:grid lg:grid-cols-[minmax(0,1fr)_14rem_15rem] lg:items-center lg:gap-4`}
              >
                <p className="font-semibold">
                  <ShiftTitle shift={t} stretch />
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 lg:contents">
                  <p className={`${meta} tabular-nums`}>{shiftWhen(t.startsAt, t.endsAt, tz)}</p>
                  <p>
                    <StatusChip tone="attention">{toMarkText(t.unmarked)}</StatusChip>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {view.toMarkMore && <More>Showing the first 50.</More>}
      </Section>

      <Section id="cancelled" n={view.cancellations.length}>
        {view.cancellations.length === 0 ? (
          <Nothing>No cancellations in the last 24 hours.</Nothing>
        ) : (
          <ul role="list" className={`${headingGap} ${rows}`}>
            {view.cancellations.map((c) => (
              <li
                key={c.assignmentId}
                className={`${row} flex flex-col gap-1 lg:flex-row lg:justify-between lg:gap-6`}
              >
                <div className="min-w-0">
                  <p className="font-semibold">
                    {c.byFirm ? `The office cancelled ${c.worker}` : `${c.worker} cancelled`}
                  </p>
                  <p className={`${meta} tabular-nums`}>
                    {roleLabel(c.role)}
                    {c.site ? ` at ${c.site}` : ""}, {shiftWhen(c.startsAt, c.endsAt, tz)}
                  </p>
                </div>
                <div className="min-w-0 lg:max-w-sm lg:text-right">
                  <p className={`${meta} tabular-nums`}>
                    {noticeText(c.noticeHours).replace(/^./, (ch) => ch.toUpperCase())}. Recorded at{" "}
                    {timeOnDay(c.cancelledAt, tz)}.
                  </p>
                  {c.reason && <p className="text-sm text-ink">Reason: {c.reason}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="unknown" n={view.unknownMessages.length} more={view.unknownMore}>
        {view.unknownMessages.length === 0 ? (
          <Nothing>None in the last 7 days.</Nothing>
        ) : (
          <ul role="list" className={`${headingGap} ${rows}`}>
            {view.unknownMessages.map((u) => (
              <li key={u.messageId} className={row}>
                <p className="font-semibold tabular-nums">
                  {u.from ? lineWords(u.from) : "Number withheld"}
                  {u.formerWorker
                    ? ` (${u.formerWorker}${u.formerWorkerActive ? "" : ", not active"})`
                    : ""}{" "}
                  · {timeOnDay(u.receivedAt, view.timeZone)}
                  {u.channel === "voice" ? " · Voicemail" : u.channel === "sms" ? " · Text" : ""}
                </p>
                <p className="mt-1 max-w-prose break-words">
                  {u.text
                    ? `“${u.text.length > UNKNOWN_TEXT_MAX ? `${u.text.slice(0, UNKNOWN_TEXT_MAX)}…` : u.text}”`
                    : u.channel === "voice"
                      ? "(A voicemail we couldn't turn into text.)"
                      : "(A photo or file, with no text.)"}
                </p>
              </li>
            ))}
          </ul>
        )}
        {view.unknownMore && <More>Showing the newest 50.</More>}
      </Section>

      <Section id="expiring" n={view.expiring.length}>
        {view.expiring.length === 0 ? (
          <Nothing>Nothing expires in the next 7 days.</Nothing>
        ) : (
          <ul role="list" className={`${headingGap} ${rows}`}>
            {view.expiring.map((e, i) => (
              <li key={`${e.worker}-${e.credential}-${i}`} className={row}>
                {e.worker}: {e.credential}, expires {dayLabel(e.expiresOn)}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
