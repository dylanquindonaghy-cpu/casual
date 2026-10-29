import Link from "next/link";
import type { ReactNode } from "react";
import { roleLabel } from "@/lib/portal/format";
import type { OpenShiftFilters, OpenShiftsList } from "@/lib/portal/open-shifts";
import type { StripDay } from "@/lib/portal/shifts-strip";
import { dayLabel } from "@/lib/rules/reasons";
import { btn, muted, staffBtnInline, staffH2 } from "../../ui/classes";
import { Icon } from "../../ui/icons";
import { PageHeader } from "../../ui/page-header";
import { ShiftsSwitch } from "../../my-shifts-view";
import { OpenShiftCard } from "./open-shift-card";
import { AreaPrompt, FurtherNote } from "./travel-notes";

// Open shifts (docs/screens.md, `/shifts/open`; Phases 18, 20 and 24): only shifts this worker can
// take. As round 7 of the canvas has it (24.6): "Shifts you can take", up to how far she travels;
// the Open | Booked switch; the next 8 days as a strip of glass tiles (her booked days grey with a
// tick, urgent days with their count in red, days with open shifts with their count, the chosen day
// in ink), a day with shifts a link to just that day, and its key in words; how many shifts there
// are and "Site and role", which opens the day, site and role to choose (a <details> holding a
// plain form: it opens and works without JavaScript); then urgent shifts first, then the rest in
// date order like the strip, one card each (src/app/shifts/open/open-shift-card.tsx), each opening
// the shift's page where she takes it. The cards' lists have role="list": Safari stops announcing a list once its bullets are
// styled away. With no travel area, a prompt to add one; under the list, how many more are further
// than she travels (12G.3). No "Back" button: the tab bar is always there.

export const limitText = (maxMinutes: number | null) =>
  maxMinutes === null
    ? "Shifts you can take."
    : `Shifts you can take, up to ${maxMinutes} minutes from home.`;

const STRIP_BOX: Record<StripDay["kind"], string> = {
  booked: "bg-ink/12 text-ink inset-ring inset-ring-white/30",
  urgent: "glass-tile text-ink",
  open: "glass-tile text-ink",
  none: "glass-tile text-ink-muted",
};

function Strip({ days, current }: { days: StripDay[]; current?: string }) {
  return (
    <section aria-label="Your next 8 days">
      <ul role="list" className="grid grid-cols-8 gap-1.5">
        {days.map((d, i) => {
          const chosen = current === d.date;
          const body = (
            <>
              <span className={`text-sm leading-tight ${i === 0 ? "tracking-tight" : ""}`}>
                {d.dow}
              </span>
              <span className="font-sign text-lg leading-none">{d.day}</span>
              {d.kind === "booked" ? (
                <Icon name="check" size={16} />
              ) : d.kind === "urgent" || d.kind === "open" ? (
                <span
                  className={`text-sm leading-none tabular-nums ${
                    chosen
                      ? "font-semibold"
                      : d.kind === "urgent"
                        ? "font-semibold text-urgent-ink"
                        : "text-ink-muted"
                  }`}
                >
                  {d.count}
                </span>
              ) : (
                <span className="h-4" />
              )}
            </>
          );
          const box = `flex h-17 flex-col items-center justify-between rounded-[14px] pt-1.5 pb-2 ${
            chosen ? "bg-ink text-on-ink" : STRIP_BOX[d.kind]
          }`;
          return (
            <li key={d.date} className="min-w-0">
              {d.kind === "urgent" || d.kind === "open" ? (
                <Link
                  href={`/shifts/open?day=${d.date}`}
                  aria-label={d.label}
                  aria-current={chosen ? "true" : undefined}
                  className={`${box} press-glass hover:brightness-[0.97] focus-visible:outline-offset-2`}
                >
                  {body}
                </Link>
              ) : (
                <span role="img" aria-label={d.label} className={box}>
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {/* Its key in words, so a day's colour never says it alone (the mock-up has none). */}
      <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="flex size-5 items-center justify-center rounded-md bg-ink/12 text-ink"
          >
            <Icon name="check" size={14} />
          </span>
          You&apos;re booked
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="glass-tile flex size-5 items-center justify-center rounded-md font-semibold text-urgent-ink"
          >
            1
          </span>
          Urgent
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="glass-tile flex size-5 items-center justify-center rounded-md"
          >
            1
          </span>
          Open
        </span>
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

const heading = `${staffH2} mt-2`;

const shiftsWord = (n: number) => (n === 1 ? "1 shift" : `${n} shifts`);

export function OpenShiftsView({
  list,
  filters,
  strip,
  timeZone,
  now,
}: {
  list: OpenShiftsList;
  filters: OpenShiftFilters;
  strip: StripDay[];
  timeZone: string;
  now: Date;
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
  const cards = (shifts: typeof list.shifts) => (
    <ul role="list" className="flex flex-col gap-2.5">
      {shifts.map((s) => (
        <OpenShiftCard key={s.shiftId} shift={s} timeZone={timeZone} now={now} />
      ))}
    </ul>
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
          <Link href="/shifts/open" className={btn.link}>
            Show all open shifts
          </Link>
        </p>
      )}
      {list.shifts.length === 0 ? (
        <p className="rounded-3xl border-2 border-dashed border-line-strong p-5 text-center text-base text-ink-muted">
          {filtered
            ? "No open shifts match."
            : list.offerAlerts
              ? "Nothing open right now. We'll message you when something matches."
              : "Nothing open right now. Check back later."}
        </p>
      ) : (
        <>
          {urgent.length > 0 && (
            <section aria-labelledby="urgent-heading" className="flex flex-col gap-2.5">
              <h2 id="urgent-heading" className={`${heading} flex items-center gap-2.5`}>
                <span aria-hidden="true" className="size-2.5 rounded-full bg-urgent" />
                Urgent, needed now
              </h2>
              {cards(urgent)}
            </section>
          )}
          <section aria-labelledby="more-heading" className="flex flex-col gap-2.5">
            <h2 id="more-heading" className={heading}>
              {urgent.length > 0 ? "More shifts you can apply for" : "Shifts you can apply for"}
            </h2>
            {rest.length > 0 ? (
              cards(rest)
            ) : (
              <p className="rounded-3xl border-2 border-dashed border-line-strong p-5 text-center text-base text-ink-muted">
                {list.offerAlerts
                  ? "Nothing else open right now. We'll message you when a shift comes up."
                  : "Nothing else open right now. Check back later."}
              </p>
            )}
          </section>
        </>
      )}
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
