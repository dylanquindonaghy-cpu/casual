import Link from "next/link";
import type { ReactNode } from "react";
import { roleLabel } from "@/lib/portal/format";
import type { OpenShiftFilters, OpenShiftsList } from "@/lib/portal/open-shifts";
import type { StripDay } from "@/lib/portal/shifts-strip";
import { dayLabel } from "@/lib/rules/reasons";
import { btn, h2, muted, staffBtnInline } from "../../ui/classes";
import { Icon } from "../../ui/icons";
import { PageHeader } from "../../ui/page-header";
import { ShiftsSwitch } from "../../my-shifts-view";
import { OpenShiftCard } from "./open-shift-card";
import { AreaPrompt, FurtherNote } from "./travel-notes";

// Open shifts (docs/screens.md, `/shifts/open`; Phases 18 and 20): only shifts this worker can
// take. Under the heading, what limits them (her licences and hours, and her travel area); the
// next 8 days as a strip, each day lifted off the page (her booked days in the firm's colour with
// a tick, urgent days pale red with their count, days with open shifts an outlined count), a day
// with shifts a link to just that day, and its key in words; right under it, the day, site and
// role to choose (a plain form: it works without JavaScript); then urgent shifts first, then the
// rest in date order like the strip, one card each (src/app/shifts/open/open-shift-card.tsx), each
// opening the shift's page where she takes it. The cards' lists have role="list": Safari stops
// announcing a list once its bullets are styled away. With no travel area, a prompt to add one;
// under the list, how many more are further than she travels (12G.3). No "Back" button: the tab
// bar is always there.

export const limitText = (maxMinutes: number | null) =>
  maxMinutes === null
    ? "Only shifts your licences and hours allow."
    : `Only shifts your licences and hours allow, up to ${maxMinutes} minutes from home.`;

const STRIP_BOX: Record<StripDay["kind"], string> = {
  booked: "bg-brand text-on-brand shadow-pass",
  urgent: "bg-urgent-tile text-urgent-ink shadow-lift",
  open: "bg-card text-ink shadow-lift",
  none: "bg-card text-ink-muted shadow-lift",
};

function Strip({ days, current }: { days: StripDay[]; current?: string }) {
  return (
    <section aria-label="Your next 8 days" className="flex flex-col gap-2.5">
      <ul role="list" className="grid grid-cols-8 gap-1">
        {days.map((d, i) => {
          const body = (
            <>
              <span className={`text-xs leading-tight ${i === 0 ? "font-semibold" : ""}`}>
                {d.dow}
              </span>
              <span className="font-sign text-lg leading-none">{d.day}</span>
              {d.kind === "booked" ? (
                <Icon name="check" size={16} />
              ) : d.kind === "urgent" || d.kind === "open" ? (
                <span
                  className={`flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-semibold ${
                    d.kind === "open" ? "border-[1.5px] border-line-strong" : ""
                  }`}
                >
                  {d.count}
                </span>
              ) : (
                <span className="h-5" />
              )}
            </>
          );
          const box = `flex h-19 flex-col items-center justify-between rounded-[14px] pt-1.5 pb-2 ${STRIP_BOX[d.kind]}`;
          return (
            <li key={d.date} className="min-w-0">
              {d.kind === "urgent" || d.kind === "open" ? (
                <Link
                  href={`/shifts/open?day=${d.date}`}
                  aria-label={d.label}
                  aria-current={current === d.date ? "true" : undefined}
                  className={`${box} hover:brightness-[0.97] focus-visible:outline-offset-2 aria-[current]:ring-2 aria-[current]:ring-ink`}
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
      <p className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3 rounded-[4px] bg-brand" />
          You&apos;re booked
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3 rounded-[4px] bg-urgent-tile" />
          Urgent
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-3 rounded-[4px] border-[1.5px] border-line-strong"
          />
          Open
        </span>
      </p>
    </section>
  );
}

// A filter as a chip: a select in a pill, its arrow drawn over its right end.
const CHIP =
  "min-h-11 w-full min-w-0 appearance-none truncate rounded-full border-[1.5px] border-line-strong bg-card py-2 pr-9 pl-3.5 text-base font-medium text-ink";

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
      </div>
      <Strip days={strip} current={filters.day} />
      {(choices.sites.length > 1 || choices.roles.length > 1 || choices.days.length > 1) && (
        <form
          method="get"
          aria-label="Choose a day, site or role"
          className="-mt-2 grid grid-cols-2 gap-2"
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
              <h2 id="urgent-heading" className={`${h2} flex items-center gap-2`}>
                <span aria-hidden="true" className="size-2 rounded-full bg-urgent" />
                Urgent, needed now
              </h2>
              {cards(urgent)}
            </section>
          )}
          <section aria-labelledby="more-heading" className="flex flex-col gap-2.5">
            <h2 id="more-heading" className={h2}>
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
          These are the first open shifts. Choose a day, site or role to see others.
        </p>
      )}
      <FurtherNote list={list} />
    </div>
  );
}
