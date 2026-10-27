import Link from "next/link";
import type { ReactNode } from "react";
import type { NeedsAttention } from "@/lib/office/dashboard";
import { evidenceItems, needsCount } from "@/lib/office/dashboard";
import {
  COUNT_ERROR,
  expiredText,
  NEEDS_HEADINGS,
  plannerRefusedText,
  SECTIONS,
  uploadsText,
  webhookFailingText,
  type NeedsKey,
} from "@/lib/office/dashboard-copy";
import { sheetChangeText, sheetNameText, toCheckText, toMarkText } from "@/lib/office/today-copy";
import { toMarkGroups } from "@/lib/office/to-mark";
import { roleLabel, shiftWhen, timeOnDay } from "@/lib/portal/format";
import { qualificationTitle } from "@/lib/portal/qualification-copy";
import { uploadWhat } from "@/lib/portal/upload-copy";
import { dayLabel } from "@/lib/rules/reasons";
import { localDateOf } from "@/lib/time/zoned";
import { btn, count, headingGap, meta, nums, textLink } from "../ui/classes";
import { StatusChip } from "../ui/status-chip";
import { BookingToCheckActions } from "./keep-booking";

// Needs attention's items, in parts (docs/office-v2.md 3.2; Phases 18 and 20: on their own page,
// `/office/needs-attention`, a menu link with the one count; the dashboard counts them too). Each
// part is a region the browser tests find it by, a pale yellow panel with its heading and count
// (Phase 21: the dashboard's tinted panels, its items near-white rows on it), then its items and
// what to do about each: the sessions to mark one row per role,
// place and time (with how many sessions and people, and each session's way in), each upload by
// name and time with its own Check, and the enquiries that need a person. Pure: the page loads the
// data.

// "Staff photo" after a name: "Ben Fraser's staff photo" (an acronym stays: "SIA …").
const inSentence = (w: string) =>
  /^[A-Z][a-z]/.test(w) ? w.charAt(0).toLowerCase() + w.slice(1) : w;

// The items of a part, each a white row with its hairline on its tinted part (Phase 23, flat;
// raised off it in Phase 22).
const items = "mt-3 flex flex-col gap-2";
const item = "glass-tile rounded-row px-4 py-3 text-ink";

function Empty({ children }: { children: ReactNode }) {
  return <p className={`${item} text-ink-muted`}>{children}</p>;
}

// One part of Needs attention: its heading (a region the browser tests find it by) and items, on
// an amber wash with its edge, 22px round (Phase 23, flat).
export function Need({
  id,
  n,
  more,
  children,
}: {
  id: NeedsKey;
  n: number;
  more?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="rounded-inner border border-attention-line bg-attention-soft p-4 sm:p-6"
    >
      <h3 id={id} className="flex items-center text-lg font-bold tracking-heading">
        {NEEDS_HEADINGS[id]}
        <span className={count}>{more ? `${n}+` : n}</span>
      </h3>
      {children}
      {more && <p className={`${meta} mt-2`}>Showing the first 50.</p>}
    </section>
  );
}

// "Steward at Acme Demo Arena": a shift's title, a link to its page.
function ShiftTitle({ shift }: { shift: { shiftId: string; role: string; site: string | null } }) {
  return (
    <Link href={`/office/shifts/${shift.shiftId}`} className={textLink}>
      {roleLabel(shift.role)}
      {shift.site ? ` at ${shift.site}` : ""}
    </Link>
  );
}

export function evidenceAddressText(waiting: number): string {
  const base =
    "The strikes team's email isn't set and confirmed, so strike records can't be emailed to them.";
  if (waiting === 0) return base;
  return `${base} ${waiting} ${waiting === 1 ? "record waits" : "records wait"} for it.`;
}

export function NeedsItems({
  n,
  timeZone: tz,
  today,
  isAdmin,
  needPerson = 0,
}: {
  n: NeedsAttention;
  timeZone: string;
  today: string;
  isAdmin: boolean;
  needPerson?: number; // enquiries that need a person (Phase 20: they count here too)
}) {
  if (needsCount(n).count === 0 && needPerson === 0) return <Empty>{SECTIONS.needs.empty}</Empty>;
  const evidence = evidenceItems(n.evidence);
  return (
    <div className="flex flex-col gap-4">
      {n.toCheck.length > 0 && (
        <Need id="to-check" n={n.toCheck.length} more={n.toCheckMore}>
          <p className={`${headingGap} max-w-prose text-ink-muted`}>
            These people are booked, but can&apos;t work these shifts as things stand. Cancel the
            booking (they&apos;re told), or keep it.
          </p>
          <ul role="list" className={items}>
            {n.toCheck.map((b) => (
              <li key={`${b.shiftId}-${b.workerId}`} className={item}>
                <p className="font-semibold">{toCheckText(b)}</p>
                <p className="mt-1">
                  <ShiftTitle shift={b} />
                  <span className={nums}>, {shiftWhen(b.startsAt, b.endsAt, tz)}</span>
                </p>
                <p className="mt-1">
                  <Link href={`/office/casuals/${b.workerId}`} className={textLink}>
                    {b.worker}&apos;s page
                  </Link>
                </p>
                <BookingToCheckActions shiftId={b.shiftId} workerId={b.workerId} name={b.worker} />
              </li>
            ))}
          </ul>
        </Need>
      )}

      {n.fromSheet.length > 0 && (
        <Need id="from-sheet" n={n.fromSheet.length} more={n.fromSheetMore}>
          <p className={`${headingGap} max-w-prose text-ink-muted`}>
            Your rota sheet asks for these, but the app couldn&apos;t do them.
          </p>
          <ul role="list" className={items}>
            {n.fromSheet.map((i) => (
              <li key={i.shiftId} className={item}>
                <p className="font-semibold">
                  <ShiftTitle shift={i} />
                </p>
                <p className={`${meta} ${nums}`}>{shiftWhen(i.startsAt, i.endsAt, tz)}</p>
                <div className="mt-2 flex max-w-prose flex-col gap-2">
                  {i.change && <p>{sheetChangeText(i.change)}</p>}
                  {i.names.map((x, k) => (
                    <p key={`${x.name}-${k}`}>{sheetNameText(x)}</p>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Need>
      )}

      {n.toMark.length > 0 && (
        <Need id="to-mark" n={n.toMark.length} more={n.toMarkMore}>
          <ul role="list" className={items}>
            {toMarkGroups(n.toMark).map((g) => (
              <li
                key={g.sessions[0]!.shiftId}
                className={`${item} flex flex-wrap items-center gap-x-4 gap-y-2`}
              >
                {/* At least 192px for the words, so on a phone the chip goes under them. */}
                <div className="min-w-48 flex-1">
                  <p className="font-semibold">
                    {roleLabel(g.role)}
                    {g.site ? ` at ${g.site}` : ""}
                  </p>
                  <p className={`${meta} ${nums}`}>
                    {shiftWhen(g.startsAt, g.endsAt, tz)}
                    {g.sessions.length > 1 ? ` · ${g.sessions.length} sessions` : ""}
                  </p>
                </div>
                <StatusChip tone="attention">{toMarkText(g.unmarked)}</StatusChip>
                {g.sessions.length === 1 ? (
                  <Link href={`/office/shifts/${g.sessions[0]!.shiftId}`} className={btn.secondary}>
                    Mark who worked
                  </Link>
                ) : (
                  <p className="flex w-full flex-wrap items-center gap-2">
                    <span className={meta}>Mark who worked:</span>
                    {g.sessions.map((t, i) => (
                      <Link
                        key={t.shiftId}
                        href={`/office/shifts/${t.shiftId}`}
                        className={btn.secondary}
                      >
                        Session {i + 1}
                      </Link>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Need>
      )}

      {n.expired.length > 0 && (
        <Need id="expired" n={n.expired.length} more={n.expiredMore}>
          <ul role="list" className={items}>
            {n.expired.map((e) => (
              <li key={`${e.assignmentId}-${e.type}`} className={`${item} flex flex-col gap-1`}>
                <p className="max-w-prose">{expiredText(e, today, tz)}</p>
                <p className="flex flex-wrap gap-x-4 gap-y-1">
                  <Link href={`/office/casuals/${e.workerId}`} className={textLink}>
                    {e.worker}&apos;s page
                  </Link>
                  <Link href={`/office/shifts/${e.shiftId}`} className={textLink}>
                    The {roleLabel(e.role).toLowerCase()} shift
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        </Need>
      )}

      {n.uploads > 0 && (
        <Need id="uploads" n={n.uploads}>
          <p className={`${headingGap} flex flex-wrap items-center gap-x-4 gap-y-1`}>
            <span>{uploadsText(n.uploads)}</span>
            <Link href="/office/casuals?view=uploads" className={textLink}>
              Check uploads
            </Link>
          </p>
          <ul role="list" className={items}>
            {n.uploadList.map((u) => (
              <li key={u.id} className={`${item} flex flex-wrap items-center gap-x-4 gap-y-2`}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {u.name}&apos;s{" "}
                    {inSentence(
                      uploadWhat(
                        u.kind,
                        u.qualificationName ? qualificationTitle(u.qualificationName) : null,
                      ),
                    )}
                  </p>
                  <p className={`${meta} ${nums}`}>Uploaded at {timeOnDay(u.sentAt, tz)}</p>
                </div>
                <Link
                  href={`/office/casuals/${u.workerId}#uploads`}
                  aria-label={`Check ${u.name}'s upload`}
                  className={btn.secondary}
                >
                  Check
                </Link>
              </li>
            ))}
          </ul>
          {n.uploads > n.uploadList.length && (
            <p className={`${meta} mt-2`}>Showing the first {n.uploadList.length}.</p>
          )}
        </Need>
      )}

      {needPerson > 0 && (
        <Need id="enquiries" n={needPerson}>
          <p className={`${headingGap} flex flex-wrap items-center gap-x-4 gap-y-1`}>
            <span>
              {needPerson === 1
                ? "1 message or request the shifts line couldn't answer."
                : `${needPerson} messages and requests the shifts line couldn't answer.`}
            </span>
            <Link href="/office/enquiries" className={textLink}>
              Open Enquiries
            </Link>
          </p>
        </Need>
      )}

      {evidence > 0 && (
        <Need id="evidence" n={evidence} more={n.evidence.failedMore}>
          <ul role="list" className={items}>
            {!n.evidence.addressConfirmed && (
              <li className={`${item} flex flex-col gap-2`}>
                <p>{evidenceAddressText(n.evidence.waiting)}</p>
                {isAdmin ? (
                  <Link href="/office/settings" className={`${textLink} self-start`}>
                    Set it in Settings
                  </Link>
                ) : (
                  <p className={meta}>An admin can set it in Settings.</p>
                )}
              </li>
            )}
            {n.evidence.failed.map((f) => (
              <li key={f.assignmentId} className={`${item} flex flex-col gap-2`}>
                <p>
                  {f.casual}&apos;s strike record{" "}
                  {f.stuck ? "hasn't been emailed to" : "couldn't be emailed to"} the strikes team
                  (cancelled <span className={nums}>{timeOnDay(f.cancelledAt, tz)}</span>).{" "}
                  {f.stuck
                    ? "It's held up."
                    : f.nothingSent
                      ? "Nothing was sent."
                      : "It may have arrived anyway."}
                </p>
                <Link
                  href={`/office/cancellations/${f.assignmentId}`}
                  className={`${textLink} self-start`}
                >
                  Open the record to resend it
                </Link>
              </li>
            ))}
          </ul>
        </Need>
      )}

      {n.webhookFailing && (
        <Need id="webhook" n={1} more={false}>
          <div className={`${item} mt-3 flex flex-col gap-2`}>
            <p className={nums}>{webhookFailingText(n.webhookFailing.since, tz)}</p>
            {isAdmin ? (
              <Link href="/office/settings/integrations" className={`${textLink} self-start`}>
                Open Integrations
              </Link>
            ) : (
              <p className={meta}>An admin can check it in Integrations.</p>
            )}
          </div>
        </Need>
      )}

      {n.plannerRefused.length > 0 && (
        <Need id="planner-refused" n={n.plannerRefused.length} more={n.plannerRefusedMore}>
          <ul role="list" className={items}>
            {n.plannerRefused.map((r) => (
              <li key={r.shiftId} className={`${item} flex flex-col gap-1`}>
                <p>{plannerRefusedText(r, tz)}</p>
                <p>
                  <ShiftTitle shift={r} />
                  <span className={nums}>, {shiftWhen(r.startsAt, r.endsAt, tz)}</span>
                </p>
                <p className={`${meta} ${nums}`}>Refused {timeOnDay(r.refusedAt, tz)}</p>
              </li>
            ))}
          </ul>
        </Need>
      )}
    </div>
  );
}

// The page's line under its heading: how many things, then where each is dealt with; "6+" when a
// part couldn't be read in full; just the hint when the items couldn't be read at all.
export function needsPageLine(count: { count: number; more: boolean } | null): string {
  if (!count) return `${SECTIONS.needs.hint}.`;
  const n = `${count.count}${count.more ? "+" : ""}`;
  return `${n} ${count.count === 1 ? "thing" : "things"} for you. ${SECTIONS.needs.hint}.`;
}

// "Also needs you" beside the items (Phase 20): the urgent places still to fill, so the page and
// the dashboard's count add up, with the way to the dashboard where they're offered; that there
// are none; or that their count couldn't be read.
export function AlsoNeedsYou({
  urgent,
  timeZone,
}: {
  urgent: { places: number; firstStartsAt: Date | null } | null;
  timeZone: string;
}) {
  return (
    <section
      aria-labelledby="also-needs-you"
      className="flex flex-col items-start gap-3 self-start rounded-inner border border-urgent-line bg-urgent-soft p-4 sm:p-6 lg:col-span-4"
    >
      <h2 id="also-needs-you" className="text-lg font-bold tracking-heading">
        Also needs you
      </h2>
      <p>
        {!urgent
          ? COUNT_ERROR
          : urgent.places === 0
            ? "No urgent places to fill."
            : `${urgent.places} urgent ${urgent.places === 1 ? "place" : "places"} to fill${
                urgent.firstStartsAt
                  ? `, the first on ${dayLabel(localDateOf(urgent.firstStartsAt, timeZone))}`
                  : ""
              }.`}
      </p>
      {urgent && urgent.places > 0 && (
        <Link href="/office" className={btn.secondary}>
          Go to the Dashboard
        </Link>
      )}
    </section>
  );
}
