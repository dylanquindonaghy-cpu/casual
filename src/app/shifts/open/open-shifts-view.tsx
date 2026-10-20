import Link from "next/link";
import { roleLabel } from "@/lib/portal/format";
import type { OpenShiftFilters, OpenShiftsList } from "@/lib/portal/open-shifts";
import { dayLabel } from "@/lib/rules/reasons";
import { btn, field, labelStack, muted, staffBtn } from "../../ui/classes";
import { PageHeader } from "../../ui/page-header";
import { ShiftsSwitch } from "../../my-shifts-view";
import { OpenShiftCard } from "./open-shift-card";
import { AreaPrompt, FurtherNote } from "./travel-notes";

// Open shifts (docs/screens.md, `/shifts/open`): only shifts this worker can take. Filters by day,
// site and role (a plain form: it works without JavaScript), kept to two short rows so the first
// shift shows on a phone's first screen; each card shows the time, role, site and places left,
// with "Take shift". No "Back" button: the tab bar is always there (Phase 17). The cards' list has
// role="list": Safari stops announcing a list once its
// bullets are styled away. Only shifts in her travel area, urgent first, then the nearest; with no
// area, a prompt to add one; under the list, how many more are further than she travels (12G.3).

export function OpenShiftsView({
  list,
  filters,
  timeZone,
  now,
}: {
  list: OpenShiftsList;
  filters: OpenShiftFilters;
  timeZone: string;
  now: Date;
}) {
  const filtered = !!(filters.day || filters.siteId || filters.role);
  const { choices } = list;
  const select = `${field} w-full`;
  return (
    <>
      <PageHeader title="Open shifts" />
      <ShiftsSwitch current="open" />
      <AreaPrompt list={list} />
      {(choices.days.length > 1 || choices.sites.length > 1 || choices.roles.length > 1) && (
        <form method="get" className="mb-5 grid grid-cols-2 gap-x-3 gap-y-2 text-base">
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
      )}
      {list.shifts.length === 0 ? (
        filtered ? (
          <div className="rounded-xl border border-dashed border-line-strong p-4">
            <p>No open shifts match.</p>
            <Link href="/shifts/open" className={`${staffBtn.secondary} mt-3`}>
              Show all open shifts
            </Link>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-line-strong p-4 text-ink-muted">
            {list.offerAlerts
              ? "Nothing open right now. We'll message you when something matches."
              : "Nothing open right now. Check back later."}
          </p>
        )
      ) : (
        <ul role="list" className="flex flex-col gap-3">
          {list.shifts.map((s) => (
            <OpenShiftCard
              key={s.shiftId}
              shift={s}
              timeZone={timeZone}
              now={now}
              checkAgainHref="/shifts/open"
            />
          ))}
        </ul>
      )}
      {list.truncated && (
        <p className={`mt-4 ${muted}`}>
          These are the first open shifts. Choose a day, site or role to see others.
        </p>
      )}
      <FurtherNote list={list} />
    </>
  );
}
