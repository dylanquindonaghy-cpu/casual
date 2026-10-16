import Link from "next/link";
import type { ReactNode } from "react";
import {
  mapLink,
  payWords,
  roleLabel,
  shiftWhen,
  siteAddress,
  soonLabel,
  timeOnDay,
} from "@/lib/portal/format";
import type { MyShift } from "@/lib/portal/my-shifts";
import type { ShiftFacts } from "@/lib/portal/shift-facts";
import {
  gettingThereLines,
  placesText,
  requirementWords,
  strikeNoteText,
} from "@/lib/portal/shift-page-copy";
import { wallTimeOf } from "@/lib/time/zoned";
import type { ShiftPage, ShiftSummary } from "@/lib/portal/shift-detail";
import { ShiftActions } from "../../my-shifts-view";
import { h2, headingGap, muted, row, rows, sectionGap, staffBtn } from "../../ui/classes";
import { PageHeader } from "../../ui/page-header";
import { StatusChip } from "../../ui/status-chip";
import { TakeShiftButton } from "../open/take-shift-button";
import { RequirementChips } from "../requirement-chips";
import { ReviewForm } from "./review-form";

// One shift's page (docs/office-v2.md 4.4; docs/screens.md `/shifts/[id]`; 12H.2). At the top,
// the chips (Urgent, what it needs) and the title: the role, then the place (site · event) and its
// address. For a shift she can take, is held for, is blocked from or is booked on, the page in
// full: the facts (when, pay with its estimate, meet, post, uniform, places), "Getting there" from
// her home area with "Open in maps", "What it needs" with her status for each, then what she can do
// (Take shift and the strike note; when it opens; the rules' reasons with "Ask the office to
// review"; or her booking's instructions and actions). Filled, started and cancelled say so.

function Header({
  shift,
  timeZone,
  eyebrow,
  facts,
  children,
}: {
  shift: ShiftSummary | MyShift;
  timeZone: string;
  eyebrow?: string;
  facts?: ShiftFacts;
  children?: ReactNode;
}) {
  const address = shift.site ? siteAddress(shift.site) : null;
  const place = [shift.site?.name, facts?.eventName].filter(Boolean).join(" · ");
  return (
    <PageHeader eyebrow={eyebrow} title={roleLabel(shift.role)}>
      {(facts?.isUrgent || (facts?.requirements.length ?? 0) > 0) && (
        <div className="flex flex-wrap gap-2">
          {facts?.isUrgent && <StatusChip tone="urgent">Urgent</StatusChip>}
          <RequirementChips requirements={facts?.requirements} />
        </div>
      )}
      {place && <p className="font-semibold">{place}</p>}
      {address && <p className={muted}>{address}</p>}
      {!facts && (
        <p className="font-semibold tabular-nums">
          {shiftWhen(shift.startsAt, shift.endsAt, timeZone)}
        </p>
      )}
      {children}
    </PageHeader>
  );
}

// The facts, as a list of label and value: when, pay with its estimate, meet, post, uniform,
// places left.
function Facts({
  shift,
  facts,
  placesLeft,
  timeZone,
}: {
  shift: ShiftSummary | MyShift;
  facts: ShiftFacts;
  placesLeft: number | null;
  timeZone: string;
}) {
  const list: [label: string, value: string][] = [
    ["When", shiftWhen(shift.startsAt, shift.endsAt, timeZone)],
  ];
  if (facts.payRatePence != null) {
    list.push(["Pay", payWords(facts.payRatePence, shift.startsAt, shift.endsAt)]);
  }
  if (facts.meetingPoint) list.push(["Meet", facts.meetingPoint]);
  if (facts.post) list.push(["Post", facts.post]);
  if (facts.uniform) list.push(["Uniform", facts.uniform]);
  if (placesLeft !== null) list.push(["Places", placesText(placesLeft, facts.headcount)]);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border border-line bg-card p-4">
      {list.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="font-semibold">{label}</dt>
          <dd className="break-words tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// "Getting there", from her home area: the distance, by car, by public transport, then the maps
// button. Where the firm has travel areas off (13.4), only the maps button (nothing without one).
function GettingThere({
  shift,
  facts,
  timeZone,
}: {
  shift: ShiftSummary | MyShift;
  facts: ShiftFacts;
  timeZone: string;
}) {
  const map = shift.site ? mapLink(shift.site) : null;
  if (!facts.travel && !map) return null;
  return (
    <section aria-labelledby="getting-there-heading" className={sectionGap.staff}>
      <h2 id="getting-there-heading" className={h2}>
        Getting there
      </h2>
      {facts.travel && (
        <>
          <p className={`mt-1 ${muted}`}>From your home area</p>
          <ul role="list" className={`${headingGap} flex flex-col gap-1`} data-travel-line="">
            {gettingThereLines(facts.travel, timeZone).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
      {map && (
        <a
          href={map}
          target="_blank"
          rel="noopener noreferrer"
          className={`${staffBtn.secondary} mt-3`}
        >
          Open in maps
        </a>
      )}
    </section>
  );
}

// "What it needs": each requirement with her status, and where she can sort one herself, "upload
// it" (to that qualification's upload page).
function WhatItNeeds({ facts, year }: { facts: ShiftFacts; year: number }) {
  if (facts.requirements.length === 0) return null;
  return (
    <section aria-labelledby="needs-heading" className={sectionGap.staff}>
      <h2 id="needs-heading" className={h2}>
        What it needs
      </h2>
      <ul role="list" className={`${rows} ${headingGap}`}>
        {facts.requirements.map((r) => {
          const w = requirementWords(r.status, {
            lastDay: facts.lastDay,
            year,
            uploadable: r.uploadable,
          });
          return (
            <li key={r.code} className={row} data-requirement={r.code}>
              <p className="font-semibold">{capitalise(r.name)}</p>
              <p
                className={
                  w.tone === "done"
                    ? "text-ink"
                    : w.tone === "attention"
                      ? "text-attention-ink"
                      : "font-semibold text-urgent-ink"
                }
              >
                {w.words}
                {w.upload && (
                  <>
                    {" "}
                    <Link
                      href={`/profile/upload/${r.code}`}
                      aria-label={`Upload your ${r.name}`}
                      className="font-semibold underline underline-offset-4"
                    >
                      upload it
                    </Link>
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const capitalise = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

// The page in full, with what she can do (the action) after "What it needs".
function FullShift({
  shift,
  facts,
  placesLeft,
  timeZone,
  eyebrow,
  status,
  children,
}: {
  shift: ShiftSummary | MyShift;
  facts: ShiftFacts;
  placesLeft: number | null;
  timeZone: string;
  eyebrow?: string;
  status?: ReactNode;
  children: ReactNode;
}) {
  const year = wallTimeOf(shift.startsAt, timeZone).year;
  return (
    <>
      <Header shift={shift} timeZone={timeZone} eyebrow={eyebrow} facts={facts}>
        {status}
      </Header>
      <Facts shift={shift} facts={facts} placesLeft={placesLeft} timeZone={timeZone} />
      <GettingThere shift={shift} facts={facts} timeZone={timeZone} />
      <WhatItNeeds facts={facts} year={year} />
      <div className={sectionGap.staff}>{children}</div>
    </>
  );
}

// A plain sentence about the shift, in a grey box.
const stateBox = "rounded-xl bg-quiet-soft p-4 font-semibold";

const openShiftsLink = (
  <Link href="/shifts/open" className={`${staffBtn.primary} mt-4`}>
    See open shifts
  </Link>
);

export function ShiftView({
  page,
  timeZone,
  now,
  eyebrow,
}: {
  page: ShiftPage;
  timeZone: string;
  now: Date;
  eyebrow?: string; // the firm's name above the heading
}) {
  switch (page.state) {
    case "missing":
      return (
        <>
          <PageHeader eyebrow={eyebrow} title="This shift isn't available.">
            <p>It may have been removed, or the link is wrong.</p>
          </PageHeader>
          {openShiftsLink}
        </>
      );
    case "booked":
      return (
        <FullShift
          shift={page.shift}
          facts={page.facts}
          placesLeft={null}
          timeZone={timeZone}
          eyebrow={eyebrow}
          status={
            <p>
              <StatusChip tone="done">You&apos;re booked on this shift</StatusChip>
            </p>
          }
        >
          {page.shift.instructions && (
            <div className="rounded-xl bg-quiet-soft p-4">
              <h2 className="font-semibold">Instructions</h2>
              <p className="mt-1 whitespace-pre-line">{page.shift.instructions}</p>
            </div>
          )}
          <ShiftActions shift={page.shift} now={now} />
        </FullShift>
      );
    case "open":
    case "held":
    case "blocked":
      return (
        <FullShift
          shift={page.shift}
          facts={page.facts}
          placesLeft={page.shift.placesLeft}
          timeZone={timeZone}
          eyebrow={eyebrow}
        >
          {page.state === "open" ? (
            <>
              <TakeShiftButton shiftId={page.shift.shiftId} onShiftPage />
              <p className={`mt-3 ${muted}`}>{strikeNoteText(page.facts.noticeHours)}</p>
            </>
          ) : page.state === "held" ? (
            <p className={stateBox}>
              Offered first to people with fewer hours that week. You can take it from{" "}
              {soonLabel(page.opensAt, now, timeZone)}.
            </p>
          ) : (
            <Blocked page={page} timeZone={timeZone} />
          )}
        </FullShift>
      );
    case "filled":
      return (
        <>
          <Header shift={page.shift} timeZone={timeZone} eyebrow={eyebrow} />
          <p className={stateBox}>This shift has been filled.</p>
          {openShiftsLink}
        </>
      );
    case "started":
      return (
        <>
          <Header shift={page.shift} timeZone={timeZone} eyebrow={eyebrow} />
          <p className={stateBox}>This shift has already started.</p>
          {openShiftsLink}
        </>
      );
    case "cancelled":
      return (
        <>
          <Header shift={page.shift} timeZone={timeZone} eyebrow={eyebrow} />
          <p className={stateBox}>This shift was cancelled.</p>
          {openShiftsLink}
        </>
      );
  }
}

// The rules said no: their reasons in plain English, then her review request or the form to ask.
function Blocked({
  page,
  timeZone,
}: {
  page: Extract<ShiftPage, { state: "blocked" }>;
  timeZone: string;
}) {
  return (
    <>
      <section
        aria-labelledby="why-heading"
        className="rounded-xl border-2 border-urgent bg-urgent-soft p-4 text-urgent-ink"
      >
        <h2 id="why-heading" className="text-lg font-bold">
          You can&apos;t take this shift:
        </h2>
        <ul className="mt-2 list-disc pl-5">
          {page.reasons.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      </section>
      {page.review ? (
        <div role="status" className="mt-6">
          <p className="font-semibold">
            You asked the office to review this at {timeOnDay(page.review.askedAt, timeZone)}.
            Reference: {page.review.ref}.
          </p>
          <p className="mt-1">You can see it in My requests.</p>
          <Link href="/requests" className={`${staffBtn.secondary} mt-3`}>
            See my requests
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-6">If you think this is wrong, ask the office to review it.</p>
          <ReviewForm shiftId={page.shift.shiftId} />
        </>
      )}
    </>
  );
}
