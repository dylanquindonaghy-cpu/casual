import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { roleLabel } from "@/lib/portal/format";
import type { OpenShiftFilters, OpenShiftsList } from "@/lib/portal/open-shifts";
import { stripKey, stripTiles, type StripDay, type StripMark } from "@/lib/portal/shifts-strip";
import { dayLabel } from "@/lib/rules/reasons";
import { btn, emptyBox, muted, staffBtnInline } from "../../ui/classes";
import { Icon } from "../../ui/icons";
import { PageHeader } from "../../ui/page-header";
import { ShiftsSwitch } from "../../my-shifts-view";
import { ShiftGroup } from "./shift-group";
import { AreaPrompt, FurtherNote } from "./travel-notes";

// Open shifts (docs/screens.md, `/shifts/open`; Phases 18, 20, 24 and 28): only shifts this worker
// can take. As round 7 of the canvas has it (24.6): "Shifts you can take", inside her travel area;
// the Open | Booked switch; the next 8 days as a strip of glass tiles (her booked days grey with a
// tick, urgent days with their count in red, days with open shifts with their count, the chosen day
// in ink), a day with shifts a link to just that day, and its key in words; how many shifts there
// are and "Site and role", which opens the day, site and role to choose (a <details> holding a
// plain form: it opens and works without JavaScript); then urgent shifts first, then the rest in
// date order like the strip, each opening the shift's page where she takes it. With no travel area,
// a prompt to add one; under the list, how many more are outside her travel area (12G.3). No "Back"
// button: the tab bar is always there.
//
// Phase 28 (28.8; docs/screens.md "The casual app, Phase 28"): the two lists are grouped as the
// office's event card is, each one glass section with its heading and count inside and its shifts
// as tiles (src/app/shifts/open/shift-group.tsx); the urgent heading is led by the office's red
// leaf. The strip's tiles are 48px wide, 8px apart, in a row that scrolls sideways inside itself
// (never the page) when they don't fit; a day with nothing has no tile, and the key names only the
// marks on screen. An empty list is the one empty state (`emptyBox`) in its section.

export const limitText = (maxMinutes: number | null) =>
  maxMinutes === null
    ? "Shifts you can take."
    : `Shifts you can take, inside your travel area (up to ${maxMinutes} minutes).`;

const STRIP_BOX: Record<StripMark, string> = {
  booked: "bg-ink/12 text-ink inset-ring inset-ring-white/30",
  urgent: "glass-tile text-ink",
  open: "glass-tile text-ink",
};

// The strip's key in words, so a day's colour never says it alone (the mock-up has none). Each
// number is a count of that day's shifts, so the key names the colour, not a sample "1". It names
// only the marks on screen (28.8).
const KEY: Record<StripMark, ReactNode> = {
  urgent: (
    <span>
      <span className="font-semibold text-urgent-ink">Red number</span>: urgent shifts that day
    </span>
  ),
  open: <span>Grey number: open shifts that day</span>,
  booked: (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="flex size-5 items-center justify-center rounded-md bg-ink/12 text-ink"
      >
        <Icon name="check" size={14} />
      </span>
      You&apos;re booked
    </span>
  ),
};

function Strip({ days, current }: { days: StripDay[]; current?: string }) {
  // Only the days with something on them (28.8); with none at all, no strip.
  const tiles = stripTiles(days);
  if (tiles.length === 0) return null;
  return (
    <section aria-label="Your next 8 days">
      {/* 48px tiles 8px apart (rule 11's 44px targets, with their gaps). The row scrolls sideways
          inside itself when they don't fit, fading at the edge with more to see (`fade-x`, as the
          office's tabs); its 4px padding keeps a tile's focus ring inside what it shows. */}
      <ul role="list" className="scrollbar-none fade-x -mx-1 flex gap-2 overflow-x-auto p-1">
        {tiles.map((d) => {
          const kind = d.kind as StripMark;
          const chosen = current === d.date;
          const body = (
            <>
              <span
                className={`text-sm leading-tight ${d.dow === "Today" ? "tracking-tight" : ""}`}
              >
                {d.dow}
              </span>
              <span className="font-sign text-lg leading-none">{d.day}</span>
              {kind === "booked" ? (
                <Icon name="check" size={16} />
              ) : (
                <span
                  className={`text-sm leading-none tabular-nums ${
                    chosen
                      ? "font-semibold"
                      : kind === "urgent"
                        ? "font-semibold text-urgent-ink"
                        : "text-ink-muted"
                  }`}
                >
                  {d.count}
                </span>
              )}
            </>
          );
          const box = `flex h-17 w-12 flex-col items-center justify-between rounded-row pt-1.5 pb-2 ${
            chosen ? "bg-ink text-on-ink" : STRIP_BOX[kind]
          }`;
          return (
            <li key={d.date} className="shrink-0">
              {kind === "booked" ? (
                <span role="img" aria-label={d.label} className={box}>
                  {body}
                </span>
              ) : (
                <Link
                  href={`/shifts/open?day=${d.date}`}
                  aria-label={d.label}
                  aria-current={chosen ? "true" : undefined}
                  className={`${box} press-glass hover:brightness-[0.97] focus-visible:outline-offset-2`}
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-ink-muted">
        {stripKey(tiles).map((k) => (
          <Fragment key={k}>{KEY[k]}</Fragment>
        ))}
      </p>
    </section>
  );
}

// A filter as a chip: a select in a pill, its arrow drawn over its right end.
const CHIP =
  "min-h-11 w-full min-w-0 appearance-none truncate rounded-full glass-tile border-[1.5px] border-line-strong py-2 pr-9 pl-3.5 text-base font-medium text-ink";

function Chip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="relative flex min-w-0">
      <span className="sr-only">{label}</span>
      {children}
      <Icon
        name="chevron"
        size={16}
        className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 rotate-90 text-ink-muted"
      />
    </label>
  );
}

const shiftsWord = (n: number) => (n === 1 ? "1 shift" : `${n} shifts`);

// The one empty state of the list (`emptyBox`): nothing open at all, nothing the filters match, or
// only urgent shifts (above it) open. "We'll message you" only when her alerts are on and something
// reaches her (`canReach`, as Home: never to a casual Home tells "We can't reach you about shifts").
function emptyText(list: OpenShiftsList, filtered: boolean, canReach: boolean): string {
  const willMessage = list.offerAlerts && canReach;
  if (list.shifts.length > 0)
    return willMessage
      ? "Nothing else open right now. We'll message you when a shift comes up."
      : "Nothing else open right now. Check back later.";
  if (filtered) return "No open shifts match.";
  return willMessage
    ? "Nothing open right now. We'll message you when something matches."
    : "Nothing open right now. Check back later.";
}

export function OpenShiftsView({
  list,
  filters,
  strip,
  timeZone,
  now,
  canReach = true,
}: {
  list: OpenShiftsList;
  filters: OpenShiftFilters;
  strip: StripDay[];
  timeZone: string;
  now: Date;
  // Something can reach her about shifts (src/lib/portal/reach-me.ts: no "unreachable").
  canReach?: boolean;
}) {
  const filtered = !!(filters.day || filters.siteId || filters.role);
  const { choices } = list;
  const hasChoices =
    choices.sites.length > 1 || choices.roles.length > 1 || choices.days.length > 1;
  const urgent = list.shifts.filter((s) => s.isUrgent);
  // The rest in date order, like the strip (the list comes nearest first: src/lib/portal/open-shifts.ts).
  const rest = list.shifts
    .filter((s) => !s.isUrgent)
    .sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || (a.shiftId < b.shiftId ? -1 : 1),
    );
  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader title="Open shifts">
          <p className={muted}>{limitText(list.area ? list.area.maxMinutes : null)}</p>
        </PageHeader>
        <ShiftsSwitch current="open" />
        <AreaPrompt list={list} />
        <Strip days={strip} current={filters.day} />
        {/* How many, and "Site and role": a <details> whose summary is the button; the form under the
          row shows while it's open (a `:has()` rule), so it works without JavaScript. */}
        <div data-filters-box="" className="mt-3 flex flex-col gap-3">
          <div className="flex min-h-13 items-center justify-between gap-3">
            <p className="text-lg text-ink-muted">{shiftsWord(list.shifts.length)}</p>
            {hasChoices && (
              <details data-filters="" open={!!(filters.siteId || filters.role) || undefined}>
                <summary
                  aria-controls="shift-filters"
                  className="press-glass glass-button inline-flex min-h-13 cursor-pointer list-none items-center justify-center gap-2 rounded-full px-5 py-2 text-base font-semibold text-ink hover:bg-button-hover [&::-webkit-details-marker]:hidden [[open]>&]:lens"
                >
                  <Icon name="filter" size={20} />
                  Site and role
                </summary>
              </details>
            )}
          </div>
          {hasChoices && (
            <form
              id="shift-filters"
              method="get"
              aria-label="Choose a day, site or role"
              className="hidden grid-cols-2 gap-2 [[data-filters-box]:has([data-filters][open])_&]:grid"
            >
              <Chip label="Day">
                <select name="day" defaultValue={filters.day ?? ""} className={CHIP}>
                  <option value="">Any day</option>
                  {choices.days.map((d) => (
                    <option key={d} value={d}>
                      {dayLabel(d)}
                    </option>
                  ))}
                </select>
              </Chip>
              <Chip label="Site">
                <select name="site" defaultValue={filters.siteId ?? ""} className={CHIP}>
                  <option value="">Any site</option>
                  {choices.sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Chip>
              <Chip label="Role">
                <select name="role" defaultValue={filters.role ?? ""} className={CHIP}>
                  <option value="">Any role</option>
                  {choices.roles.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
              </Chip>
              <button type="submit" className={staffBtnInline}>
                Show shifts
              </button>
            </form>
          )}
        </div>
      </div>
      {filtered && (
        <p className="-mt-3 flex flex-wrap items-center gap-x-3 text-base">
          <span className="font-semibold">
            {filters.day ? dayLabel(filters.day) : "Some shifts"}
            {filters.siteId || filters.role ? ", chosen site or role" : ""}
          </span>
          {/* Clearing a filter: the one place "Show all open shifts" stays (28.8). */}
          <Link href="/shifts/open" className={btn.link}>
            Show all open shifts
          </Link>
        </p>
      )}
      {urgent.length > 0 && (
        <ShiftGroup
          id="urgent-heading"
          title="Urgent, needed now"
          urgent
          shifts={urgent}
          timeZone={timeZone}
          now={now}
        />
      )}
      <ShiftGroup
        id="more-heading"
        title={urgent.length > 0 ? "More shifts you can take" : "Shifts you can take"}
        shifts={rest}
        timeZone={timeZone}
        now={now}
        empty={<p className={emptyBox}>{emptyText(list, filtered, canReach)}</p>}
      />
      {list.truncated && (
        <p className={muted}>
          These are the first open shifts. Tap Site and role to choose a day, site or role and see
          others.
        </p>
      )}
      <FurtherNote list={list} />
    </div>
  );
}
