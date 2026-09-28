import Link from "next/link";
import {
  credentialExpiredMessage,
  credentialExpiringMessage,
  credentialMarkedExpiredMessage,
  type FirmVoice,
} from "@/lib/messaging/templates";
import { isOnNow, mapLink, roleLabel, shiftWhen, siteAddress } from "@/lib/portal/format";
import type { CredentialNotice, MyShift, ShiftsView } from "@/lib/portal/my-shifts";
import { shortDate } from "@/lib/rules/reasons";
import { wallTimeOf } from "@/lib/time/zoned";

// My shifts (docs/screens.md, `/`): the next shift in a card (time, role, site, map link,
// instructions), the rest in a list where each opens to the same details, a toggle to the last 30
// days, and a banner for credentials that expire soon or have expired. Plain server-rendered HTML
// (the list opens with <details>): nothing here needs JavaScript.

export interface MyShiftsViewProps {
  firstName: string;
  voice: FirmVoice;
  timeZone: string;
  now: Date;
  view: ShiftsView;
  shifts: MyShift[];
  notices: CredentialNotice[];
}

export function MyShiftsView(props: MyShiftsViewProps) {
  const { firstName, voice, view, shifts } = props;
  return (
    <>
      <p className="text-base text-slate-600">{voice.name}</p>
      <h1 className="text-3xl font-bold">Hello {firstName}</h1>
      <Notices {...props} />
      <nav aria-label="Which shifts" className="mt-6 grid grid-cols-2 gap-2">
        <Toggle href="/" current={view === "upcoming"}>
          Upcoming
        </Toggle>
        <Toggle href="/?view=past" current={view === "past"}>
          Past 30 days
        </Toggle>
      </nav>
      {view === "upcoming" ? (
        <Upcoming {...props} />
      ) : shifts.length === 0 ? (
        <p className="mt-6">No shifts in the last 30 days.</p>
      ) : (
        <section aria-labelledby="past-heading" className="mt-6">
          <h2 id="past-heading" className="text-xl font-semibold">
            The last 30 days
          </h2>
          <ul className="mt-2 divide-y">
            {shifts.map((s) => (
              <ShiftRow key={s.assignmentId} shift={s} {...props} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Toggle({ href, current, children }: { href: string; current: boolean; children: string }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`block rounded-xl border-2 px-3 py-3 text-center font-semibold ${
        current ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"
      }`}
    >
      {children}
    </Link>
  );
}

function Notices({ notices, voice, timeZone, now }: MyShiftsViewProps) {
  if (notices.length === 0) return null;
  const year = wallTimeOf(now, timeZone).year;
  return (
    <div className="mt-4 space-y-2">
      {notices.map((n) => {
        const date = n.expiresOn ? shortDate(n.expiresOn, year) : null;
        const text = !n.expired
          ? credentialExpiringMessage(voice, n.name, date ?? "")
          : date
            ? credentialExpiredMessage(voice, n.name, date)
            : credentialMarkedExpiredMessage(voice, n.name);
        return (
          <p
            key={n.type}
            className={`rounded-xl border-2 p-3 text-base ${
              n.expired ? "border-red-700 bg-red-50 text-red-900" : "border-amber-600 bg-amber-50"
            }`}
          >
            {text}
          </p>
        );
      })}
    </div>
  );
}

function Upcoming(props: MyShiftsViewProps) {
  const [next, ...later] = props.shifts;
  if (!next) {
    return (
      <div className="mt-6">
        <p>No shifts booked yet.</p>
        <Link
          href="/shifts/open"
          className="mt-3 block w-full rounded-xl border-2 border-slate-900 px-4 py-4 text-center text-lg font-semibold"
        >
          See open shifts
        </Link>
      </div>
    );
  }
  return (
    <>
      <NextShift shift={next} {...props} />
      {later.length > 0 && (
        <section aria-labelledby="later-heading" className="mt-6">
          <h2 id="later-heading" className="text-xl font-semibold">
            Coming up
          </h2>
          <ul className="mt-2 divide-y">
            {later.map((s) => (
              <UpcomingRow key={s.assignmentId} shift={s} {...props} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function NextShift({ shift, timeZone, now }: MyShiftsViewProps & { shift: MyShift }) {
  return (
    <section
      aria-labelledby="next-heading"
      className="mt-6 rounded-2xl border-2 border-slate-900 p-4"
    >
      <h2 id="next-heading" className="text-base font-semibold text-slate-600">
        {isOnNow(shift, now) ? "On now" : "Your next shift"}
      </h2>
      <p className="mt-1 text-2xl font-bold">{shiftWhen(shift.startsAt, shift.endsAt, timeZone)}</p>
      <p className="mt-1">{roleLabel(shift.role)}</p>
      <ShiftDetails shift={shift} />
    </section>
  );
}

// Where and what to do: the site and its address, a maps button, the instructions.
function ShiftDetails({ shift }: { shift: MyShift }) {
  const map = shift.site ? mapLink(shift.site) : null;
  const address = shift.site ? siteAddress(shift.site) : null;
  return (
    <>
      {shift.site && (
        <div className="mt-3">
          <p className="font-semibold">{shift.site.name}</p>
          {address && <p className="text-base text-slate-700">{address}</p>}
          {map && (
            <a
              href={map}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 block w-full rounded-xl border-2 border-slate-900 px-4 py-3 text-center font-semibold"
            >
              Open in maps
            </a>
          )}
        </div>
      )}
      {shift.instructions && (
        <div className="mt-3">
          <h3 className="font-semibold">Instructions</h3>
          <p className="whitespace-pre-line">{shift.instructions}</p>
        </div>
      )}
    </>
  );
}

// An upcoming shift in the list: tap it to open the same details as the next shift's card.
function UpcomingRow({ shift, timeZone, now }: MyShiftsViewProps & { shift: MyShift }) {
  return (
    <li className="py-1">
      <details>
        <summary className="cursor-pointer py-2">
          <span className="block font-semibold">
            {shiftWhen(shift.startsAt, shift.endsAt, timeZone)}
          </span>
          <span className="block text-base">
            {roleLabel(shift.role)}
            {shift.site ? ` at ${shift.site.name}` : ""}
          </span>
          {isOnNow(shift, now) && <span className="block text-base text-slate-600">On now</span>}
        </summary>
        <div className="pb-3">
          <ShiftDetails shift={shift} />
          {!shift.site && !shift.instructions && (
            <p className="mt-2 text-base text-slate-600">No site or instructions yet.</p>
          )}
        </div>
      </details>
    </li>
  );
}

const PAST_LABELS: Record<MyShift["status"], string> = {
  confirmed: "Booked",
  completed: "Worked",
  no_show: "Marked as not attended",
};

// A shift in the last 30 days, with what happened.
function ShiftRow({ shift, timeZone }: MyShiftsViewProps & { shift: MyShift }) {
  const label = PAST_LABELS[shift.status];
  return (
    <li className="py-3">
      <p className="font-semibold">{shiftWhen(shift.startsAt, shift.endsAt, timeZone)}</p>
      <p className="text-base">
        {roleLabel(shift.role)}
        {shift.site ? ` at ${shift.site.name}` : ""}
      </p>
      <p className="text-base text-slate-600">{label}</p>
    </li>
  );
}
