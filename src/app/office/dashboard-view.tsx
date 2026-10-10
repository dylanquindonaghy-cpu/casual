import Link from "next/link";
import type { ReactNode } from "react";
import type { Dashboard, NeedsAttention, Part } from "@/lib/office/dashboard";
import { evidenceItems, needsCount } from "@/lib/office/dashboard";
import {
  cancelledByText,
  countLine,
  countNumber,
  COUNTS,
  expiredText,
  HIDDEN_WARNING,
  moreSessionsText,
  NEEDS_HEADINGS,
  noticeChip,
  SECTION_ERROR,
  SECTIONS,
  uploadsText,
  urgentLine,
  type NeedsKey,
  type SectionKey,
} from "@/lib/office/dashboard-copy";
import {
  eventSummary,
  eventSwitchLabel,
  eventWhereWhen,
  filledText,
  sessionName,
  spansDays,
} from "@/lib/office/events-copy";
import {
  placesText,
  sheetChangeText,
  sheetNameText,
  toCheckText,
  toMarkText,
} from "@/lib/office/today-copy";
import { noticeText } from "@/lib/portal/cancel-reasons";
import { roleLabel, shiftWhen, timeOnDay } from "@/lib/portal/format";
import { card, h2, headingGap, meta, nums, row, rows, sectionGap, textLink } from "../ui/classes";
import { StatusChip } from "../ui/status-chip";
import { EnquiryItem } from "./enquiries/enquiry-row";
import { ShowingSwitch } from "./events/showing-switch";
import { BookingToCheckActions } from "./keep-booking";
import { ShiftActions } from "./shift-actions";

// The office dashboard (docs/office-v2.md 3.2, 3.9; docs/screens.md `/office`). Pure: the page
// loads the data. The four counts first, each a link to its list (the first tinted and larger),
// then the sections in the spec's order, each with its hint, its empty words and, when its data
// couldn't be read, its error words. Needs attention holds the to-dos in parts (the regions the
// browser tests find them by); the bell in the top bar counts its items.

// --- The counts ------------------------------------------------------------------------------

function Counts({ d }: { d: Dashboard }) {
  return (
    <nav aria-label="Counts">
      <ul role="list" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {COUNTS.map((c, i) => {
          const n = countNumber(c.key, d.counts);
          const first = i === 0;
          return (
            <li key={c.key}>
              <Link
                href={c.href}
                className={`flex h-full flex-col gap-1 rounded-xl border-2 p-3 shadow-sm hover:border-ink sm:p-4 ${
                  first ? "border-urgent bg-urgent-soft" : "border-line bg-card"
                }`}
              >
                <span
                  className={`leading-none font-bold ${nums} ${
                    first ? "text-3xl text-urgent" : "text-2xl text-ink-muted"
                  }`}
                >
                  {n ?? "–"}
                </span>
                <span className="text-sm leading-snug font-semibold text-ink">{c.label}</span>
                <span className={`text-sm leading-snug text-ink-muted ${nums}`}>
                  {countLine(c.key, d.counts, d.timeZone)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// --- Sections --------------------------------------------------------------------------------

function Section({ id, children }: { id: SectionKey; children: ReactNode }) {
  const s = SECTIONS[id];
  const headingId = id === "needs" ? "needs-attention" : id;
  return (
    <section className={sectionGap.office} aria-labelledby={headingId}>
      <h2 id={headingId} className={`${h2} scroll-mt-20`}>
        {s.heading}
      </h2>
      <p className={`${meta} mt-1`}>{s.hint}</p>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className={`${card} ${headingGap} text-ink-muted`}>{children}</p>;
}

function Failed() {
  return (
    <p
      role="status"
      className={`${headingGap} rounded-md border-l-4 border-attention bg-attention-soft px-3 py-2 text-attention-ink`}
    >
      {SECTION_ERROR}
    </p>
  );
}

// A part's content, or its error words.
function Loaded<T>({ part, children }: { part: Part<T>; children: (data: T) => ReactNode }) {
  return part.ok ? <>{children(part.data)}</> : <Failed />;
}

function UrgentCards({ d }: { d: Dashboard }) {
  const tz = d.timeZone;
  return (
    <Loaded part={d.urgent}>
      {(u) =>
        u.events.length === 0 ? (
          <Empty>{SECTIONS.urgent.empty}</Empty>
        ) : (
          <div className={`${headingGap} flex flex-col gap-3`}>
            {u.events.map((e) => (
              <article
                key={e.eventId}
                aria-labelledby={`urgent-${e.eventId}`}
                className={`${card} flex flex-col gap-3 border-l-4 border-l-urgent`}
              >
                <div>
                  <h3 id={`urgent-${e.eventId}`} className="text-lg font-bold">
                    <Link href={`/office/events/${e.eventId}`} className={textLink}>
                      {e.name}
                    </Link>
                  </h3>
                  {e.place && e.place !== e.name && <p className={meta}>{e.place}</p>}
                </div>
                {!e.showing && (
                  <p className="rounded-md border-l-4 border-urgent bg-urgent-soft px-3 py-2 font-semibold text-urgent">
                    {HIDDEN_WARNING}
                  </p>
                )}
                <ul role="list" className="flex flex-col gap-3">
                  {e.sessions.map((s) => (
                    <li
                      key={s.shiftId}
                      className="flex flex-col gap-3 border-t border-line pt-3 first:border-t-0 first:pt-0 lg:flex-row lg:items-start lg:justify-between lg:gap-6"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusChip tone="urgent">Urgent</StatusChip>
                          <StatusChip tone="attention">
                            {placesText(s.placesLeft, s.headcount)}
                          </StatusChip>
                          {s.fromSheet && (
                            <StatusChip tone="quiet">From your Google Sheet</StatusChip>
                          )}
                        </div>
                        <p className="mt-2 font-semibold">
                          <Link href={`/office/shifts/${s.shiftId}`} className={textLink}>
                            {roleLabel(s.role)}, {shiftWhen(s.startsAt, s.endsAt, tz)}
                          </Link>
                        </p>
                        <p className={`mt-1 ${nums}`}>{urgentLine(s)}</p>
                        {s.escalated && <p className={meta}>The office was emailed about it.</p>}
                      </div>
                      <ShiftActions
                        shiftId={s.shiftId}
                        isUrgent
                        fromSheet={s.fromSheet}
                        className="lg:shrink-0"
                      />
                    </li>
                  ))}
                </ul>
              </article>
            ))}
            {u.more && <p className={meta}>Showing the first 50 events.</p>}
          </div>
        )
      }
    </Loaded>
  );
}

function ShowingCards({ d }: { d: Dashboard }) {
  const tz = d.timeZone;
  return (
    <Loaded part={d.showing}>
      {(sh) =>
        sh.events.length === 0 ? (
          <Empty>{SECTIONS.showing.empty}</Empty>
        ) : (
          <div className={headingGap}>
            <ul role="list" className="grid gap-3 lg:grid-cols-2">
              {sh.events.map((e) => {
                const withDay = spansDays(e, tz);
                return (
                  <li key={e.eventId}>
                    <article
                      aria-labelledby={`showing-${e.eventId}`}
                      className={`${card} flex h-full flex-col gap-2`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 id={`showing-${e.eventId}`} className="font-bold">
                            <Link href={`/office/events/${e.eventId}`} className={textLink}>
                              {e.name}
                            </Link>
                          </h3>
                          <p className={`${meta} ${nums}`}>
                            {[eventWhereWhen(e, tz), eventSummary(e)]
                              .filter((x) => x !== e.name)
                              .join(" · ")}
                          </p>
                        </div>
                        <ShowingSwitch
                          target="event"
                          id={e.eventId}
                          showing={e.showing}
                          label={eventSwitchLabel(e)}
                          small
                        />
                      </div>
                      <ul role="list" className={`flex flex-col gap-1 text-sm ${nums}`}>
                        {e.sessions.map((s) => (
                          <li key={s.shiftId}>
                            {sessionName(s, tz, withDay)} · {filledText(s)}
                          </li>
                        ))}
                      </ul>
                      {e.moreSessions > 0 && (
                        <p className={`${meta} text-sm`}>{moreSessionsText(e.moreSessions)}</p>
                      )}
                    </article>
                  </li>
                );
              })}
            </ul>
            {sh.more > 0 && (
              <p className={`${meta} mt-3`}>
                And {sh.more} more.{" "}
                <Link href="/office/events?view=showing" className={textLink}>
                  All events showing
                </Link>
              </p>
            )}
          </div>
        )
      }
    </Loaded>
  );
}

function LatestCancellations({ d }: { d: Dashboard }) {
  const tz = d.timeZone;
  return (
    <Loaded part={d.cancellations}>
      {(c) => (
        <>
          {c.rows.length === 0 ? (
            <Empty>{SECTIONS.cancellations.empty}</Empty>
          ) : (
            <ul role="list" className={`${headingGap} ${rows}`}>
              {c.rows.map((r) => (
                <li key={r.assignmentId} className={row}>
                  <p className="font-semibold">
                    <Link href={`/office/cancellations/${r.ref}`} className={textLink}>
                      {cancelledByText(r)}
                    </Link>
                  </p>
                  <p className={`${meta} ${nums}`}>
                    {roleLabel(r.role)}
                    {r.eventName ? ` · ${r.eventName}` : ""}
                    {r.siteName && r.siteName !== r.eventName ? `, ${r.siteName}` : ""} ·{" "}
                    {shiftWhen(r.startsAt, r.endsAt, tz)}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusChip tone={r.noticeHours < c.threshold ? "urgent" : "quiet"}>
                      {noticeChip(noticeText(r.noticeHours))}
                    </StatusChip>
                    {r.strike && (
                      <StatusChip tone="attention">
                        {r.strike.status === "withdrawn" ? "Strike withdrawn" : "Strike issued"}
                      </StatusChip>
                    )}
                    <span className={`${meta} ${nums}`}>
                      Cancelled {timeOnDay(r.cancelledAt, tz)}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3">
            <Link href="/office/cancellations" className={textLink}>
              All records
            </Link>
          </p>
        </>
      )}
    </Loaded>
  );
}

function LatestEnquiries({ d }: { d: Dashboard }) {
  return (
    <Loaded part={d.enquiries}>
      {(q) => (
        <>
          {q.rows.length === 0 ? (
            <Empty>{SECTIONS.enquiries.empty}</Empty>
          ) : (
            <ul role="list" className={`${headingGap} ${rows}`}>
              {q.rows.map((r) => (
                <EnquiryItem
                  key={r.messageId}
                  r={r}
                  timeZone={d.timeZone}
                  reply={q.replies[r.messageId] ?? null}
                />
              ))}
            </ul>
          )}
          <p className="mt-3">
            <Link href="/office/enquiries" className={textLink}>
              All enquiries
            </Link>
          </p>
        </>
      )}
    </Loaded>
  );
}

// --- Needs attention -------------------------------------------------------------------------

// One part of Needs attention: its heading (a region the browser tests find it by) and items.
function Need({
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
    <section aria-labelledby={id} className="mt-6">
      <h3 id={id} className="flex items-center gap-2 text-lg font-bold">
        {NEEDS_HEADINGS[id]}
        <span className={`rounded-full bg-attention-soft px-2 text-sm text-attention-ink ${nums}`}>
          {more ? `${n}+` : n}
        </span>
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

function NeedsItems({
  n,
  timeZone: tz,
  today,
  isAdmin,
}: {
  n: NeedsAttention;
  timeZone: string;
  today: string;
  isAdmin: boolean;
}) {
  if (needsCount(n).count === 0) return <Empty>{SECTIONS.needs.empty}</Empty>;
  const evidence = evidenceItems(n.evidence);
  return (
    <>
      {n.toCheck.length > 0 && (
        <Need id="to-check" n={n.toCheck.length} more={n.toCheckMore}>
          <p className={`${headingGap} max-w-prose text-ink-muted`}>
            These people are booked, but can&apos;t work these shifts as things stand. Cancel the
            booking (they&apos;re told), or keep it.
          </p>
          <ul role="list" className={`${headingGap} flex flex-col gap-3`}>
            {n.toCheck.map((b) => (
              <li key={`${b.shiftId}-${b.workerId}`} className={card}>
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
          <ul role="list" className={`${headingGap} ${rows}`}>
            {n.fromSheet.map((i) => (
              <li key={i.shiftId} className={row}>
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
          <ul role="list" className={`${headingGap} ${rows}`}>
            {n.toMark.map((t) => (
              <li key={t.shiftId} className={`${row} flex flex-wrap items-center gap-x-4 gap-y-1`}>
                <p className="font-semibold">
                  <ShiftTitle shift={t} />
                </p>
                <p className={`${meta} ${nums}`}>{shiftWhen(t.startsAt, t.endsAt, tz)}</p>
                <StatusChip tone="attention">{toMarkText(t.unmarked)}</StatusChip>
              </li>
            ))}
          </ul>
        </Need>
      )}

      {n.expired.length > 0 && (
        <Need id="expired" n={n.expired.length} more={n.expiredMore}>
          <ul role="list" className={`${headingGap} ${rows}`}>
            {n.expired.map((e) => (
              <li key={`${e.assignmentId}-${e.type}`} className={`${row} flex flex-col gap-1`}>
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
        </Need>
      )}

      {evidence > 0 && (
        <Need id="evidence" n={evidence} more={n.evidence.failedMore}>
          <ul role="list" className={`${headingGap} ${rows}`}>
            {!n.evidence.addressConfirmed && (
              <li className={`${row} flex max-w-prose flex-col gap-2`}>
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
              <li key={f.assignmentId} className={`${row} flex max-w-prose flex-col gap-2`}>
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
    </>
  );
}

export function DashboardContent({ d, isAdmin = false }: { d: Dashboard; isAdmin?: boolean }) {
  return (
    <>
      <Counts d={d} />
      <Section id="urgent">
        <UrgentCards d={d} />
      </Section>
      <Section id="showing">
        <ShowingCards d={d} />
      </Section>
      <Section id="cancellations">
        <LatestCancellations d={d} />
      </Section>
      <Section id="enquiries">
        <LatestEnquiries d={d} />
      </Section>
      <Section id="needs">
        <Loaded part={d.needs}>
          {(n) => <NeedsItems n={n} timeZone={d.timeZone} today={d.today} isAdmin={isAdmin} />}
        </Loaded>
      </Section>
    </>
  );
}
