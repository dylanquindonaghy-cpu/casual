import Link from "next/link";
import { roleLabel } from "@/lib/portal/format";
import type { OpenShiftFilters, OpenShiftsList } from "@/lib/portal/open-shifts";
import type { StripDay } from "@/lib/portal/shifts-strip";
import { dayLabel } from "@/lib/rules/reasons";
import { btn, field, h2, labelStack, muted } from "../../ui/classes";
import { Icon } from "../../ui/icons";
import { PageHeader } from "../../ui/page-header";
import { ShiftsSwitch } from "../../my-shifts-view";
import { OpenShiftCard } from "./open-shift-card";
import { AreaPrompt, FurtherNote } from "./travel-notes";

// Open shifts (docs/screens.md, `/shifts/open`; Phase 18): only shifts this worker can take. Under
// the heading, what limits them (her licences and hours, and her travel area); the next 8 days as
// a strip (her booked days filled in, a red count on days with urgent shifts, an outlined count on
// days with open ones), a day with shifts a link to just that day; then urgent shifts first, then
// the rest, one card each (src/app/shifts/open/open-shift-card.tsx), each opening the shift's page
// where she takes it. A site or role can still be chosen (a plain form, folded away: it works
// without JavaScript). The cards' lists have role="list": Safari stops announcing a list once its
// bullets are styled away. With no travel area, a prompt to add one; under the list, how many more
// are further than she travels (12G.3). No "Back" button: the tab bar is always there.

export const limitText = (maxMinutes: number | null) =>
  maxMinutes === null
    ? "Only shifts your licences and hours allow."
    : `Only shifts your licences and hours allow, up to ${maxMinutes} minutes from home.`;

const STRIP_BOX: Record<StripDay["kind"], string> = {
  booked: "bg-brand text-on-brand",
  urgent: "bg-urgent-soft text-ink",
  open: "text-ink",
  none: "text-ink-muted",
};

function Strip({ days, current }: { days: StripDay[]; current?: string }) {
  return (
    <section aria-label="Your next 8 days" className="flex flex-col gap-2">
      <ul
        role="list"
        className="grid grid-cols-8 divide-x divide-line overflow-hidden rounded-xl border border-line bg-card"
      >
        {days.map((d, i) => {
          const body = (
            <>
              <span className="text-sm leading-tight">{d.dow}</span>
              <span className="font-sign text-2xl leading-none">{d.day}</span>
              {d.kind === "booked" ? (
                <Icon name="check" size={20} />
              ) : d.kind === "urgent" ? (
                <span className="min-w-6 rounded bg-urgent-fill px-1 text-center font-sign text-base leading-[22px] text-on-urgent">
                  {d.count}
                </span>
              ) : d.kind === "open" ? (
                <span className="min-w-6 rounded border-[1.5px] border-ink px-1 text-center font-sign text-base leading-[19px]">
                  {d.count}
                </span>
              ) : (
                <span className="h-[22px]" />
              )}
            </>
          );
          const box = `flex h-23 flex-col items-center justify-between pt-1.5 pb-2 ${STRIP_BOX[d.kind]} ${
            i === 0 && d.kind !== "booked" ? "border-t-[3px] border-t-ink" : ""
          }`;
          return (
            <li key={d.date} className="min-w-0">
              {d.kind === "urgent" || d.kind === "open" ? (
                <Link
                  href={`/shifts/open?day=${d.date}`}
                  aria-label={d.label}
                  aria-current={current === d.date ? "true" : undefined}
                  className={`${box} hover:bg-quiet-soft focus-visible:-outline-offset-2 aria-[current]:ring-2 aria-[current]:ring-ink aria-[current]:ring-inset`}
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
      <p className="flex flex-wrap gap-x-4 gap-y-1.5 text-base text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-4 rounded-[3px] bg-brand" />
          You&apos;re booked
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-4 rounded-[3px] bg-urgent-fill" />
          Urgent
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-4 rounded-[3px] border-[1.5px] border-ink" />
          Open
        </span>
      </p>
    </section>
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
  const select = `${field} w-full`;
  const urgent = list.shifts.filter((s) => s.isUrgent);
  const rest = list.shifts.filter((s) => !s.isUrgent);
  const cards = (shifts: typeof list.shifts) => (
    <ul role="list" className="flex flex-col gap-2.5">
      {shifts.map((s) => (
        <OpenShiftCard key={s.shiftId} shift={s} timeZone={timeZone} now={now} />
      ))}
    </ul>
  );
  return (
    <div className="flex flex-col gap-7">
      <div>
        <PageHeader title="Open shifts">
          <p className={muted}>{limitText(list.area ? list.area.maxMinutes : null)}</p>
        </PageHeader>
        <ShiftsSwitch current="open" />
        <AreaPrompt list={list} />
      </div>
      <Strip days={strip} current={filters.day} />
      {filtered && (
        <p className="-mt-4 flex flex-wrap items-center gap-x-3 text-base">
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
        <p className="rounded-xl border-2 border-dashed border-line-strong p-5 text-center text-base text-ink-muted">
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
                <span
                  aria-hidden="true"
                  className="flex size-6.5 items-center justify-center rounded-[5px] bg-urgent-fill text-on-urgent"
                >
                  <Icon name="urgent" size={17} />
                </span>
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
              <p className="rounded-xl border-2 border-dashed border-line-strong p-5 text-center text-base text-ink-muted">
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
      {(choices.sites.length > 1 || choices.roles.length > 1 || choices.days.length > 1) && (
        // Open while a site or role is chosen, so she sees it and can change it.
        <details
          open={Boolean(filters.siteId || filters.role) || undefined}
          className="group rounded-xl border border-line bg-card"
        >
          <summary className="flex min-h-12 items-center gap-2 px-4 text-base font-semibold">
            <Icon
              name="chevron"
              className="transition-transform duration-200 ease-sd group-open:rotate-90"
            />
            Choose a day, site or role
          </summary>
          <form method="get" className="grid grid-cols-2 gap-x-3 gap-y-2 px-4 pb-4 text-base">
            <label className={labelStack}>
              <span>Day</span>
              <select name="day" defaultValue={filters.day ?? ""} className={select}>
                <option value="">Any day</option>
                {choices.days.map((d) => (
                  <option key={d} value={d}>
                    {dayLabel(d)}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelStack}>
              <span>Site</span>
              <select name="site" defaultValue={filters.siteId ?? ""} className={select}>
                <option value="">Any site</option>
                {choices.sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelStack}>
              <span>Role</span>
              <select name="role" defaultValue={filters.role ?? ""} className={select}>
                <option value="">Any role</option>
                {choices.roles.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={`${btn.secondary} self-end`}>
              Show shifts
            </button>
          </form>
        </details>
      )}
    </div>
  );
}
