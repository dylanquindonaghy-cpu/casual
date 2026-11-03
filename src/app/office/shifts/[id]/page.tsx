import Link from "next/link";
import { notFound } from "next/navigation";
import {
  btn,
  card,
  field,
  headingGap,
  labelStack,
  muted,
  page as width,
  row,
  rows,
  tab,
  tabCurrent,
  tabs,
} from "@/app/ui/classes";
import { Icon } from "@/app/ui/icons";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { ERASED_REASON } from "@/lib/gdpr/free-text";
import { BREADCRUMB, SHOWING_CHIP } from "@/lib/office/event-page-copy";
import {
  CHECKS_FIRST,
  CHECKS_FIRST_LEAD,
  clockTime,
  MORE_FOR_SESSION,
  PANEL_WORDS,
  SEE_IN_LOG,
  SESSION_TAB_WORDS,
  SESSION_TABS,
  THIS_SESSION,
  type PanelKey,
  type SessionTab,
} from "@/lib/office/session-page-copy";
import { officeShiftDetail } from "@/lib/office/shift-pages";
import {
  FROM_PLANNER_WORDS,
  PLACE_FLAG_WORDS,
  PLACE_STATUS_WORDS,
  SHIFT_STATUS_WORDS,
} from "@/lib/office/shifts-copy";
import { noticeText } from "@/lib/portal/cancel-reasons";
import { dayLabel } from "@/lib/rules/reasons";
import { perHour, roleLabel, timeOnDay } from "@/lib/portal/format";
import type { OverridableCode } from "@/lib/rules/eligibility";
import { localDateOf } from "@/lib/time/zoned";
import { ShowHideButton } from "../../events/[id]/event-actions";
import { FLAG_TONE, PLACE_TONE, SHIFT_TONE } from "../shift-tones";
import { AssignButton } from "./assign-button";
import { AttendanceButtons, MarkRestWorked } from "./attendance-forms";
import { BookBest, CasualsAskSwitch } from "./casual-actions";
import { CasualsCard, casualsHref, casualsQueryOf, type CasualsQuery } from "./casuals-card";
import { summaryButton } from "./chevron";
import { SessionDetailsForm } from "./details-form";
import { EditShiftForm } from "./edit-form";
import {
  CancelBookingForm,
  CancelShiftForm,
  MoveShiftForm,
  PlacesConfirmation,
} from "./firm-change-forms";
import { SessionPanel } from "./session-panel";

const MARKABLE = ["confirmed", "completed", "no_show"] as const;
const isMarkable = (status: string): status is (typeof MARKABLE)[number] =>
  (MARKABLE as readonly string[]).includes(status);
const PANELS = Object.keys(PANEL_WORDS) as PanelKey[];

// One session for the office, round 8 (Phase 26.6, ses-1 to ses-5; docs/screens.md "A session,
// round 8"). A breadcrumb (its event), the role and day as the title with whether casuals see it,
// its times, venue, post and how full it is; actions: Hide from casuals (its own switch), the main
// "Book the best N" (the asks waiting the rules allow, where the office chooses) or "Offer to
// someone", and a "…" menu holding the forms that change it (assign someone, edit, its details,
// move, shorten or cancel), each in a slide-in panel (`?panel=`), and the action log. Tabs:
// Casuals (the default) and History. Casuals: "Casuals for this session" (who asked, was offered,
// said no, is booked, could take it; the Booked tab is where a booking is cancelled or marked
// worked) beside "This session" (booked, pay, needs, post, the event's "Casuals ask, you choose"
// switch and the rule that booking checks everything first). Admins and resourcers. A session from
// the firm's planner keeps Assign and the cancelling of one booking, but its edit, details, move
// and cancel are changed in the planner; a sheet's is changed in the sheet.
export default async function OfficeShiftPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { firm } = await requireOfficeArea("shifts");
  const { id } = await params;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const { filters } = casualsQueryOf(sp, "asked");
  const worker = one("worker");
  const page = await officeShiftDetail(
    { firm },
    (await readSessionToken("office")) ?? "",
    id,
    worker,
    filters,
  );
  if (!page) notFound();
  const { shift, form, casuals } = page;
  const tz = form.timeZone;
  const live = page.places.filter((p) => !p.status.startsWith("cancelled"));
  const cancelled = page.places.filter((p) => p.status.startsWith("cancelled"));
  const unmarked = live.filter((p) => p.status === "confirmed").length;
  const offerable = shift.status === "open" && shift.booked < shift.headcount && !shift.started;
  const shown = shift.showing && page.event.showing;
  const base = `/office/shifts/${shift.shiftId}`;

  const query: CasualsQuery = casualsQueryOf(
    sp,
    casuals.casualsAsk || casuals.counts.asked > 0 ? "asked" : "booked",
  );
  const current: SessionTab = one("tab") === "history" ? "history" : "casuals";
  const panelParam = one("panel");
  // A check from "Assign someone" (`?worker=`) shows its answer in that panel.
  const panel: PanelKey | null = (PANELS as string[]).includes(panelParam ?? "")
    ? (panelParam as PanelKey)
    : worker
      ? "assign"
      : null;
  const here =
    current === "history" ? `${base}?tab=history` : casualsHref(shift.shiftId, query, {});
  const withPanel = (p: PanelKey) => `${here}${here.includes("?") ? "&" : "?"}panel=${p}`;
  const title = `${roleLabel(shift.role)} · ${dayLabel(localDateOf(shift.startsAt, tz))}`;
  const line = [
    `${clockTime(shift.startsAt, tz)}–${clockTime(shift.endsAt, tz)}`,
    shift.site,
    shift.post,
    `${shift.booked} of ${shift.headcount} booked`,
  ].filter(Boolean);
  const best = casuals.best.map((c) => c.name);
  const changeable = page.edit.editable;

  const bookedList = (
    <PlacesConfirmation>
      <section aria-labelledby="places">
        <h3 id="places" className="sr-only">
          Booked places
        </h3>
        {live.length === 0 ? (
          <p className="rounded-row glass-tile p-4 text-sm text-ink-muted">Nobody booked yet.</p>
        ) : (
          <>
            {shift.started && (
              <p className="mb-2 px-1">Mark who worked it and who didn&apos;t attend.</p>
            )}
            <ul role="list" className={rows}>
              {live.map((p) => (
                <li key={p.assignmentId} className={`${row} flex flex-col gap-2`}>
                  <p className="leading-8">
                    <span className="font-semibold">{p.worker}:</span>{" "}
                    <StatusChip tone={PLACE_TONE[p.status] ?? "quiet"}>
                      {PLACE_STATUS_WORDS[p.status] ?? p.status}
                    </StatusChip>
                    {p.overrideReason ? (
                      <span className="text-ink-muted">
                        {p.overrideReason === ERASED_REASON
                          ? ". Placed despite a rule (the reason was deleted with the worker's details)"
                          : `. Placed despite a rule. Reason: ${p.overrideReason}`}
                      </span>
                    ) : null}
                    {p.flag && p.status === "confirmed" && (
                      <>
                        {" "}
                        ·{" "}
                        <StatusChip tone={FLAG_TONE[p.flag]}>{PLACE_FLAG_WORDS[p.flag]}</StatusChip>
                      </>
                    )}
                  </p>
                  {page.canPlace && p.status === "confirmed" && p.workerId && (
                    <CancelBookingForm
                      shiftId={shift.shiftId}
                      workerId={p.workerId}
                      name={p.worker}
                    />
                  )}
                  {shift.started && p.workerId && isMarkable(p.status) && (
                    <AttendanceButtons
                      shiftId={shift.shiftId}
                      workerId={p.workerId}
                      name={p.worker}
                      status={p.status}
                    />
                  )}
                </li>
              ))}
            </ul>
            {/* Stays after the last one is marked, so its confirmation survives the refresh. */}
            {shift.ended && <MarkRestWorked shiftId={shift.shiftId} count={unmarked} />}
          </>
        )}
        {cancelled.length > 0 && (
          <>
            <h4 className="mt-6 px-1 font-semibold text-ink">Cancelled</h4>
            <ul role="list" className={`${rows} mt-2`}>
              {cancelled.map((p) => (
                <li key={p.assignmentId} className={`${row} text-ink-muted`}>
                  <span className="font-semibold text-ink">{p.worker}:</span>{" "}
                  {PLACE_STATUS_WORDS[p.status] ?? p.status}
                  {p.noticeHours !== null ? `, ${noticeText(p.noticeHours)}` : ""}
                  {p.cancelledAt ? ` (${timeOnDay(p.cancelledAt, tz)})` : ""}
                  {p.reason ? `. Reason: ${p.reason}` : ""}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </PlacesConfirmation>
  );

  return (
    <main className={`${width.office} @container`}>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-ink-muted">
        <ol role="list" className="flex flex-wrap items-center gap-1">
          <li className="flex items-center gap-1">
            <Icon name="home" size={14} />
            <Link href="/office" className="press hover:text-ink hover:underline">
              {BREADCRUMB[0]}
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li>
            <Link href="/office/events" className="press hover:text-ink hover:underline">
              {BREADCRUMB[1]}
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li>
            <Link
              href={`/office/events/${page.event.id}`}
              className="press hover:text-ink hover:underline"
            >
              {page.event.name}
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li>
            <span aria-current="page" className="font-medium text-ink">
              {title}
            </span>
          </li>
        </ol>
      </nav>
      <PageHeader
        title={title}
        actions={
          <>
            {shift.status !== "cancelled" && (
              <ShowHideButton eventId={shift.shiftId} showing={shift.showing} target="session" />
            )}
            {page.canPlace && casuals.casualsAsk && best.length > 0 ? (
              <BookBest
                shiftId={shift.shiftId}
                people={casuals.best.map((c) => ({ workerId: c.workerId, name: c.name }))}
              />
            ) : (
              <Link
                href={`/office/offer/${shift.shiftId}`}
                className={offerable ? btn.primary : btn.secondary}
              >
                Offer to someone
              </Link>
            )}
            <details key={panel ?? "none"} className="group relative shrink-0">
              <summary
                aria-label={MORE_FOR_SESSION}
                className={`${summaryButton} press-glass glass-button inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-button-hover hover:text-ink active:bg-button-press group-open:bg-button-press group-open:text-ink`}
              >
                <Icon name="dots" />
              </summary>
              <div className="absolute top-full right-0 z-30 mt-2 flex w-64 max-w-[80vw] origin-top-right animate-pop flex-col gap-2 rounded-inner glass-float p-3">
                {page.canPlace && casuals.casualsAsk && best.length > 0 && (
                  <Link
                    href={`/office/offer/${shift.shiftId}`}
                    className={`${btn.secondary} justify-start`}
                  >
                    Offer to someone
                  </Link>
                )}
                {page.canPlace && (
                  <Link href={withPanel("assign")} className={`${btn.secondary} justify-start`}>
                    {PANEL_WORDS.assign}
                  </Link>
                )}
                <Link href={withPanel("edit")} className={`${btn.secondary} justify-start`}>
                  {PANEL_WORDS.edit}
                </Link>
                <Link href={withPanel("details")} className={`${btn.secondary} justify-start`}>
                  {PANEL_WORDS.details}
                </Link>
                {changeable && (
                  <Link href={withPanel("change")} className={`${btn.secondary} justify-start`}>
                    {shift.booked > 0 ? PANEL_WORDS.change : "Cancel"}
                  </Link>
                )}
                <Link
                  href={`/office/log?shift=${shift.shiftId}`}
                  className={`${btn.secondary} justify-start`}
                >
                  {SEE_IN_LOG}
                </Link>
              </div>
            </details>
          </>
        }
      >
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted tabular-nums">
          <StatusChip tone={shown ? "done" : "quiet"}>
            {shown ? SHOWING_CHIP.on : SHOWING_CHIP.off}
          </StatusChip>
          <span>{line.join(" · ")}</span>
          <StatusChip tone={SHIFT_TONE[shift.status]}>
            {SHIFT_STATUS_WORDS[shift.status]}
          </StatusChip>
          {shift.isUrgent && <StatusChip tone="urgent">Urgent</StatusChip>}
        </p>
        {shift.fromSheet && (
          <p className={muted}>This shift comes from your Google Sheet. Change it there.</p>
        )}
        {shift.fromPlanner && <p className={muted}>{FROM_PLANNER_WORDS}</p>}
        {shift.fromImport && (
          <p className={muted}>
            This shift came from an import. Importing the file again updates it.
          </p>
        )}
        {shift.instructions && (
          <p className="glass-tile rounded-row px-3 py-2 whitespace-pre-line">
            <span className="font-semibold">Instructions:</span> {shift.instructions}
          </p>
        )}
      </PageHeader>

      <nav aria-label="Show" className={`${tabs} mb-4`}>
        {SESSION_TABS.map((t) => (
          <Link
            key={t}
            href={t === "history" ? `${base}?tab=history` : base}
            aria-current={t === current ? "page" : undefined}
            className={t === current ? tabCurrent : tab}
          >
            {SESSION_TAB_WORDS[t]}
          </Link>
        ))}
      </nav>

      {current === "casuals" ? (
        <div className="grid items-start gap-4 @min-[64rem]:grid-cols-[minmax(0,1fr)_22rem]">
          <CasualsCard
            shiftId={shift.shiftId}
            casuals={casuals}
            query={query}
            timeZone={tz}
            canPlace={page.canPlace}
            booked={bookedList}
          />
          <section aria-labelledby="this-session" className="glass rounded-inner p-4">
            <h2 id="this-session" className="flex items-center gap-2 px-1 text-lg font-semibold">
              <Icon name="log" size={18} />
              {THIS_SESSION}
            </h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 px-1 text-sm">
              <div>
                <dt className="text-ink-muted">Booked</dt>
                <dd className="font-medium text-ink tabular-nums">
                  {shift.booked} of {shift.headcount}
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Pay</dt>
                <dd className="font-medium text-ink">
                  {shift.payRatePence === null ? "Not set" : perHour(shift.payRatePence)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Needs</dt>
                <dd className="font-medium text-ink">
                  {shift.needs.length > 0 ? shift.needs.join(", ") : "Nothing extra"}
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Post</dt>
                <dd className="font-medium text-ink">{shift.post ?? "None"}</dd>
              </div>
            </dl>
            <div className="mt-4 border-t border-line pt-3">
              <CasualsAskSwitch
                eventId={page.event.id}
                on={casuals.casualsAsk}
                canChange={shift.status !== "cancelled"}
              />
            </div>
            <p className="mt-3 flex gap-2 rounded-row border border-attention-line bg-attention-soft p-3 text-sm text-attention-ink">
              <Icon name="urgent" size={16} className="mt-1 shrink-0" />
              <span>
                <b className="font-semibold">{CHECKS_FIRST_LEAD}</b> {CHECKS_FIRST}
              </span>
            </p>
          </section>
        </div>
      ) : (
        <section aria-labelledby="history" className="glass rounded-inner p-4">
          <h2 id="history" className="px-1 text-lg font-semibold text-ink">
            History
          </h2>
          {page.history.length === 0 ? (
            <p className={`${headingGap} rounded-row glass-tile p-4 text-sm text-ink-muted`}>
              Nothing recorded yet.
            </p>
          ) : (
            <ul role="list" className={`${headingGap} flex flex-col divide-y divide-line`}>
              {page.history.map((h, i) => (
                <li key={i} className="py-2 text-sm text-ink">
                  <span className="text-ink-muted tabular-nums">{timeOnDay(h.at, tz)}:</span>{" "}
                  {h.words}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 px-1">
            <Link href={`/office/log?shift=${shift.shiftId}`} className={btn.link}>
              See this shift in the action log
            </Link>
          </p>
        </section>
      )}

      <p className="mt-6 px-1">
        <Link href="/office/shifts" className={btn.link}>
          Back to shifts
        </Link>
      </p>

      {panel === "assign" && page.canPlace && (
        <SessionPanel title={PANEL_WORDS.assign} closeHref={here}>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="panel" value="assign" />
            <label className={`${labelStack} w-full`}>
              Who?
              <select
                name="worker"
                defaultValue={page.check?.workerId ?? ""}
                className={`${field} w-full`}
              >
                <option value="" disabled>
                  Choose someone with this role
                </option>
                {page.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={page.check ? btn.secondary : btn.primary}>
              Check
            </button>
          </form>
          {page.people.length === 0 && (
            <p className={`${muted} mt-3`}>Nobody else active has this role.</p>
          )}
          {page.check && (
            <div
              className={`mt-4 rounded-row border p-4 ${
                page.check.ok
                  ? "border-done-line bg-done-soft"
                  : page.check.overridable
                    ? "border-attention-line bg-attention-soft"
                    : "border-urgent-line bg-urgent-soft"
              }`}
            >
              {page.check.ok ? (
                <p className="font-semibold">
                  The rules say {page.check.name} can work this shift.
                </p>
              ) : (
                <>
                  <p className="font-semibold">{page.check.name} can&apos;t be booked:</p>
                  <ul className="mt-1 list-disc pl-6">
                    {page.check.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  {page.check.overridable ? (
                    <p className="mt-2">The office may allow this, with a reason.</p>
                  ) : (
                    <p className="mt-2">These can&apos;t be overridden.</p>
                  )}
                </>
              )}
              {(page.check.ok || page.check.overridable) && (
                <AssignButton
                  shiftId={shift.shiftId}
                  workerId={page.check.workerId}
                  name={page.check.name}
                  overrides={page.check.ok ? null : (page.check.codes as OverridableCode[])}
                />
              )}
            </div>
          )}
        </SessionPanel>
      )}

      {panel === "edit" && (
        <SessionPanel title={PANEL_WORDS.edit} closeHref={here}>
          {page.edit.editable ? (
            <EditShiftForm
              shiftId={shift.shiftId}
              booked={shift.booked}
              sites={form.sites}
              defaults={{
                date: page.edit.date,
                start: page.edit.start,
                end: page.edit.end,
                role: shift.role.replace(/_/g, " "),
                siteId: shift.siteId ?? "",
                headcount: String(shift.headcount),
                instructions: shift.instructions ?? "",
              }}
            />
          ) : (
            <p className={`${card} text-ink-muted`}>
              {shift.fromSheet
                ? "Change it in your Google Sheet."
                : shift.fromPlanner
                  ? "Change it in your planner."
                  : "This shift has started or was cancelled, so it can't be changed."}
            </p>
          )}
        </SessionPanel>
      )}

      {panel === "details" && (
        <SessionPanel title={PANEL_WORDS.details} closeHref={here}>
          {page.details.editable ? (
            <SessionDetailsForm
              shiftId={shift.shiftId}
              qualifications={form.qualifications}
              requirementsLocked={page.details.requirementsLocked}
              defaults={{
                payRate: page.details.payRate,
                post: page.details.post,
                meetingPoint: page.details.meetingPoint,
                uniform: page.details.uniform,
                requirements: page.details.requirements,
              }}
            />
          ) : (
            <p className={`${card} text-ink-muted`}>
              {shift.fromPlanner && !shift.started && shift.status !== "cancelled"
                ? "Change it in your planner."
                : "This shift has started or was cancelled, so its details can't be changed."}
            </p>
          )}
        </SessionPanel>
      )}

      {panel === "change" && (
        <SessionPanel title={shift.booked > 0 ? PANEL_WORDS.change : "Cancel"} closeHref={here}>
          {!changeable ? (
            <p className={`${card} text-ink-muted`}>
              {shift.fromSheet
                ? "Change it in your Google Sheet."
                : shift.fromPlanner
                  ? "Change it in your planner."
                  : "This shift has started or was cancelled, so it can't be changed."}
            </p>
          ) : shift.booked > 0 ? (
            <div className="flex flex-col gap-4">
              <p>Everyone booked is told, and the notice they had is logged for each of them.</p>
              <MoveShiftForm
                shiftId={shift.shiftId}
                sites={form.sites}
                defaults={{
                  date: page.edit.date,
                  start: page.edit.start,
                  end: page.edit.end,
                  siteId: shift.siteId ?? "",
                }}
              />
              <CancelShiftForm shiftId={shift.shiftId} booked={shift.booked} />
            </div>
          ) : (
            <CancelShiftForm shiftId={shift.shiftId} booked={shift.booked} />
          )}
        </SessionPanel>
      )}
    </main>
  );
}
