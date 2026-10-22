import Link from "next/link";
import { notFound } from "next/navigation";
import {
  btn,
  card,
  field,
  h2,
  headingGap,
  labelStack,
  muted,
  page as width,
  row,
  rows,
  sectionGap,
} from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { ERASED_REASON } from "@/lib/gdpr/free-text";
import { officeShiftDetail } from "@/lib/office/shift-pages";
import {
  FROM_PLANNER_WORDS,
  PLACE_FLAG_WORDS,
  PLACE_STATUS_WORDS,
  SHIFT_STATUS_WORDS,
} from "@/lib/office/shifts-copy";
import { noticeText } from "@/lib/portal/cancel-reasons";
import { roleLabel, shiftWhen, timeOnDay } from "@/lib/portal/format";
import type { OverridableCode } from "@/lib/rules/eligibility";
import { FLAG_TONE, PLACE_TONE, RESPONSE_TONE, SHIFT_TONE, WAITING_TONE } from "../shift-tones";
import { AssignButton } from "./assign-button";
import { AttendanceButtons, MarkRestWorked } from "./attendance-forms";
import { SessionDetailsForm } from "./details-form";
import { EditShiftForm } from "./edit-form";
import { CancelBookingForm, CancelShiftForm, MoveShiftForm } from "./firm-change-forms";

const section = sectionGap.office;

const MARKABLE = ["confirmed", "completed", "no_show"] as const;
const isMarkable = (status: string): status is (typeof MARKABLE)[number] =>
  (MARKABLE as readonly string[]).includes(status);

const RESPONSE: Record<string, string> = {
  accepted: "took it",
  declined: "said no",
  expired: "didn't answer in time",
  filled_elsewhere: "filled by someone else",
  failed: "couldn't be sent",
};

// One shift for the office (docs/screens.md `/office/shifts/[id]`). The header says what, when
// and how full it is; then who is booked (Places) and the ways to fill it (Assign someone,
// Offers) come first, the forms that change it (Edit, then Move, shorten or cancel) after, and
// the History last. Admins and resourcers. A session from the firm's planner keeps Assign and the
// cancelling of one booking, but its edit, details, move and cancel are changed in the planner.
// "Offer to someone" is the header's main (dark) button only while the shift can still be offered:
// open, a place free and not started, the offer page's own rule (src/lib/office/offer-page.ts).
// Otherwise it's an ordinary button, as the offer page then says "This shift isn't open any more."
export default async function OfficeShiftPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ worker?: string }>;
}) {
  const { firm } = await requireOfficeArea("shifts");
  const { id } = await params;
  const { worker } = await searchParams;
  const page = await officeShiftDetail(
    { firm },
    (await readSessionToken("office")) ?? "",
    id,
    typeof worker === "string" ? worker : undefined,
  );
  if (!page) notFound();
  const { shift, form } = page;
  const tz = form.timeZone;
  const live = page.places.filter((p) => !p.status.startsWith("cancelled"));
  const cancelled = page.places.filter((p) => p.status.startsWith("cancelled"));
  const unmarked = live.filter((p) => p.status === "confirmed").length;
  const offerable = shift.status === "open" && shift.booked < shift.headcount && !shift.started;
  return (
    <main className={width.officeForm}>
      <PageHeader
        title={
          <>
            {roleLabel(shift.role)}
            {shift.site ? ` at ${shift.site}` : ""}
          </>
        }
        actions={
          <Link
            href={`/office/offer/${shift.shiftId}`}
            className={offerable ? btn.primary : btn.secondary}
          >
            Offer to someone
          </Link>
        }
      >
        <p className="text-lg font-semibold tabular-nums">
          {shiftWhen(shift.startsAt, shift.endsAt, tz)}
        </p>
        <p className="leading-8">
          <span className="tabular-nums">
            {shift.booked} of {shift.headcount} booked
          </span>{" "}
          ·{" "}
          <StatusChip tone={SHIFT_TONE[shift.status]}>
            {SHIFT_STATUS_WORDS[shift.status]}
          </StatusChip>
          {shift.isUrgent && (
            <>
              {" "}
              · <StatusChip tone="urgent">Urgent</StatusChip>
            </>
          )}
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
          <p className="rounded-row border border-line bg-card px-3 py-2 whitespace-pre-line">
            <span className="font-semibold">Instructions:</span> {shift.instructions}
          </p>
        )}
      </PageHeader>

      <section aria-labelledby="places">
        <h2 id="places" className={h2}>
          Places
        </h2>
        {live.length === 0 ? (
          <p className={`${card} ${headingGap} text-ink-muted`}>Nobody booked yet.</p>
        ) : (
          <>
            {shift.started && (
              <p className={headingGap}>Mark who worked it and who didn&apos;t attend.</p>
            )}
            <ul role="list" className={`${rows} ${headingGap}`}>
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
            <h3 className="mt-6 font-semibold text-ink">Cancelled</h3>
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

      {page.canPlace && (
        <section className={section} aria-labelledby="assign">
          <h2 id="assign" className={h2}>
            Assign someone
          </h2>
          <div className={`${card} ${headingGap}`}>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <label className={`${labelStack} w-full sm:w-auto`}>
                Who?
                <select
                  name="worker"
                  defaultValue={page.check?.workerId ?? ""}
                  className={`${field} w-full sm:w-80`}
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
          </div>
        </section>
      )}

      <section className={section} aria-labelledby="offers">
        <h2 id="offers" className={h2}>
          Offers
        </h2>
        {page.offers.length === 0 ? (
          <p className={`${card} ${headingGap} text-ink-muted`}>No offers sent.</p>
        ) : (
          <ul role="list" className={`${rows} ${headingGap}`}>
            {page.offers.map((o, i) => (
              <li key={`${o.worker}-${i}`} className={`${row} leading-8`}>
                <span className="font-semibold">{o.worker}:</span>{" "}
                <StatusChip
                  tone={o.response ? (RESPONSE_TONE[o.response] ?? "quiet") : WAITING_TONE}
                >
                  {o.response ? (RESPONSE[o.response] ?? o.response) : "waiting"}
                </StatusChip>{" "}
                <span className="text-ink-muted">
                  ({o.byOffice ? `by ${o.byOffice}` : `wave ${o.wave ?? ""}`},{" "}
                  {timeOnDay(o.sentAt, tz)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={section} aria-labelledby="edit">
        <h2 id="edit" className={h2}>
          Edit this shift
        </h2>
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
          <p className={`${card} ${headingGap} text-ink-muted`}>
            {shift.fromSheet
              ? "Change it in your Google Sheet."
              : shift.fromPlanner
                ? "Change it in your planner."
                : "This shift has started or was cancelled, so it can't be changed."}
          </p>
        )}
      </section>

      <section className={section} aria-labelledby="details">
        <h2 id="details" className={h2}>
          Session details
        </h2>
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
          <p className={`${card} ${headingGap} text-ink-muted`}>
            {shift.fromPlanner && !shift.started && shift.status !== "cancelled"
              ? "Change it in your planner."
              : "This shift has started or was cancelled, so its details can't be changed."}
          </p>
        )}
      </section>

      {page.edit.editable && (
        <section className={section} aria-labelledby="change">
          <h2 id="change" className={h2}>
            {shift.booked > 0 ? "Move, shorten or cancel" : "Cancel"}
          </h2>
          {shift.booked > 0 ? (
            <div className={`${card} ${headingGap} sm:p-6`}>
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
            <div className={headingGap}>
              <CancelShiftForm shiftId={shift.shiftId} booked={shift.booked} />
            </div>
          )}
        </section>
      )}

      <section className={section} aria-labelledby="history">
        <h2 id="history" className={h2}>
          History
        </h2>
        {page.history.length === 0 ? (
          <p className={`${card} ${headingGap} text-ink-muted`}>Nothing recorded yet.</p>
        ) : (
          <ul role="list" className={`${rows} ${headingGap}`}>
            {page.history.map((h, i) => (
              <li key={i} className={row}>
                <span className="text-ink-muted tabular-nums">{timeOnDay(h.at, tz)}:</span>{" "}
                {h.words}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2">
          <Link href={`/office/log?shift=${shift.shiftId}`} className={btn.link}>
            See this shift in the action log
          </Link>
        </p>
      </section>

      <p className={section}>
        <Link href="/office/shifts" className={btn.link}>
          Back to shifts
        </Link>
      </p>
    </main>
  );
}
