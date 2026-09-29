import Link from "next/link";
import { roleLabel, shiftWhen, siteAddress, soonLabel } from "@/lib/portal/format";
import type { OpenShiftFilters, OpenShiftsList } from "@/lib/portal/open-shifts";
import { dayLabel } from "@/lib/rules/reasons";
import { TakeShiftButton } from "./take-shift-button";

// Open shifts (docs/screens.md, `/shifts/open`): only shifts this worker can take. Filters by day,
// site and role (a plain form: it works without JavaScript); each card shows the time, role, site
// and places left, with "Take shift".

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
  const select = "mt-1 block w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-3";
  return (
    <>
      <h1 className="text-3xl font-bold">Open shifts</h1>
      {(choices.days.length > 1 || choices.sites.length > 1 || choices.roles.length > 1) && (
        <form method="get" className="mt-4 space-y-3">
          <label className="block">
            <span className="font-semibold">Day</span>
            <select name="day" defaultValue={filters.day ?? ""} className={select}>
              <option value="">Any day</option>
              {choices.days.map((d) => (
                <option key={d} value={d}>
                  {dayLabel(d)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-semibold">Site</span>
            <select name="site" defaultValue={filters.siteId ?? ""} className={select}>
              <option value="">Any site</option>
              {choices.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-semibold">Role</span>
            <select name="role" defaultValue={filters.role ?? ""} className={select}>
              <option value="">Any role</option>
              {choices.roles.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="w-full rounded-xl border-2 border-slate-900 px-4 py-3 text-lg font-semibold"
          >
            Show shifts
          </button>
        </form>
      )}
      {list.shifts.length === 0 ? (
        filtered ? (
          <div className="mt-6">
            <p>No open shifts match.</p>
            <Link
              href="/shifts/open"
              className="mt-3 block w-full rounded-xl border-2 border-slate-900 px-4 py-3 text-center text-lg font-semibold"
            >
              Show all open shifts
            </Link>
          </div>
        ) : (
          <p className="mt-6">
            {list.offerAlerts
              ? "Nothing open right now. We'll message you when something matches."
              : "Nothing open right now. Check back later."}
          </p>
        )
      ) : (
        <ul className="mt-6 space-y-4">
          {list.shifts.map((s) => {
            const address = s.site ? siteAddress(s.site) : null;
            return (
              <li key={s.shiftId} className="rounded-2xl border-2 border-slate-300 p-4">
                <p className="text-xl font-bold">{shiftWhen(s.startsAt, s.endsAt, timeZone)}</p>
                <p className="mt-1">{roleLabel(s.role)}</p>
                {s.site && (
                  <p className="mt-1">
                    <span className="font-semibold">{s.site.name}</span>
                    {address && <span className="block text-base text-slate-700">{address}</span>}
                  </p>
                )}
                <p className="mt-1 text-base text-slate-600">
                  {s.placesLeft === 1 ? "1 place left" : `${s.placesLeft} places left`}
                </p>
                {s.opensAt ? (
                  <div className="mt-3 rounded-xl bg-slate-100 p-3">
                    <p>
                      Offered first to people with fewer hours that week. You can take it from{" "}
                      {soonLabel(s.opensAt, now, timeZone)}.
                    </p>
                    <Link
                      href="/shifts/open"
                      className="mt-1 inline-block py-2 font-semibold underline"
                    >
                      Check again
                    </Link>
                  </div>
                ) : (
                  <TakeShiftButton shiftId={s.shiftId} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {list.truncated && (
        <p className="mt-4 text-base text-slate-600">
          These are the first open shifts. Choose a day, site or role to see others.
        </p>
      )}
      <Link
        href="/"
        className="mt-8 block w-full rounded-xl border-2 border-slate-900 px-4 py-3 text-center text-lg font-semibold"
      >
        Back to my shifts
      </Link>
    </>
  );
}
