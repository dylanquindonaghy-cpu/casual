import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { officeShiftDetail } from "@/lib/office/shift-pages";
import { PLACE_STATUS_WORDS, SHIFT_STATUS_WORDS } from "@/lib/office/shifts-copy";
import { noticeText } from "@/lib/portal/cancel-reasons";
import { roleLabel, shiftWhen, timeOnDay } from "@/lib/portal/format";
import type { OverridableCode } from "@/lib/rules/eligibility";
import { AssignButton } from "./assign-button";
import { EditShiftForm } from "./edit-form";
import { CancelBookingForm, CancelShiftForm, MoveShiftForm } from "./firm-change-forms";

const section = "mt-8";
const heading = "text-2xl font-bold";
const button = "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100";

const RESPONSE: Record<string, string> = {
  accepted: "took it",
  declined: "said no",
  expired: "didn't answer in time",
  filled_elsewhere: "filled by someone else",
  failed: "couldn't be sent",
};

// One shift for the office (docs/screens.md `/office/shifts/[id]`): details, edit, places,
// assign someone (with the rules' answer first), offers, history. Admins and resourcers.
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
  return (
    <main className="mx-auto max-w-4xl p-6">
      <p className="text-base text-slate-600">{firm.name} office</p>
      <h1 className="text-3xl font-bold">
        {roleLabel(shift.role)}
        {shift.site ? ` at ${shift.site}` : ""}
      </h1>
      <p className="mt-1 text-lg">{shiftWhen(shift.startsAt, shift.endsAt, tz)}</p>
      <p>
        {shift.booked} of {shift.headcount} booked · {SHIFT_STATUS_WORDS[shift.status]}
        {shift.isUrgent ? " · Urgent" : ""}
      </p>
      {shift.fromSheet && <p>This shift comes from your Google Sheet. Change it there.</p>}
      {shift.fromImport && (
        <p>This shift came from an import. Importing the file again updates it.</p>
      )}
      {shift.instructions && (
        <p className="mt-2 whitespace-pre-line">Instructions: {shift.instructions}</p>
      )}
      <Link href={`/office/offer/${shift.shiftId}`} className={`${button} mt-3 inline-block`}>
        Offer to someone
      </Link>

      <section className={section} aria-labelledby="edit">
        <h2 id="edit" className={heading}>
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
          <p className="mt-2">
            {shift.fromSheet
              ? "Change it in your Google Sheet."
              : "This shift has started or was cancelled, so it can't be changed."}
          </p>
        )}
      </section>

      {page.edit.editable && (
        <section className={section} aria-labelledby="change">
          <h2 id="change" className={heading}>
            {shift.booked > 0 ? "Move, shorten or cancel" : "Cancel"}
          </h2>
          {shift.booked > 0 && (
            <>
              <p className="mt-2">
                Everyone booked is told, and the notice they had is logged for each of them.
              </p>
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
            </>
          )}
          <CancelShiftForm shiftId={shift.shiftId} booked={shift.booked} />
        </section>
      )}

      <section className={section} aria-labelledby="places">
        <h2 id="places" className={heading}>
          Places
        </h2>
        {live.length === 0 ? (
          <p className="mt-2">Nobody booked yet.</p>
        ) : (
          <ul className="mt-2 list-disc pl-6">
            {live.map((p) => (
              <li key={p.assignmentId}>
                {p.worker}: {PLACE_STATUS_WORDS[p.status] ?? p.status}
                {page.edit.editable && p.status === "confirmed" && p.workerId && (
                  <CancelBookingForm
                    shiftId={shift.shiftId}
                    workerId={p.workerId}
                    name={p.worker}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {cancelled.length > 0 && (
          <>
            <h3 className="mt-3 font-semibold">Cancelled</h3>
            <ul className="list-disc pl-6">
              {cancelled.map((p) => (
                <li key={p.assignmentId}>
                  {p.worker}: {PLACE_STATUS_WORDS[p.status] ?? p.status}
                  {p.noticeHours !== null ? `, ${noticeText(p.noticeHours)}` : ""}
                  {p.cancelledAt ? ` (${timeOnDay(p.cancelledAt, tz)})` : ""}
                  {p.reason ? `. Reason: ${p.reason}` : ""}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {page.edit.editable && (
        <section className={section} aria-labelledby="assign">
          <h2 id="assign" className={heading}>
            Assign someone
          </h2>
          <form method="get" className="mt-2 flex flex-wrap items-end gap-2">
            <label className="flex flex-col">
              <span className="font-semibold">Who?</span>
              <select
                name="worker"
                defaultValue={page.check?.workerId ?? ""}
                className="rounded border border-slate-400 px-2 py-1"
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
            <button type="submit" className={button}>
              Check
            </button>
          </form>
          {page.people.length === 0 && <p className="mt-2">Nobody else active has this role.</p>}
          {page.check && (
            <div className="mt-3 rounded-xl border border-slate-300 p-3">
              {page.check.ok ? (
                <p>The rules say {page.check.name} can work this shift.</p>
              ) : (
                <>
                  <p>{page.check.name} can&apos;t be booked:</p>
                  <ul className="list-disc pl-6">
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
        </section>
      )}

      <section className={section} aria-labelledby="offers">
        <h2 id="offers" className={heading}>
          Offers
        </h2>
        {page.offers.length === 0 ? (
          <p className="mt-2">No offers sent.</p>
        ) : (
          <ul className="mt-2 list-disc pl-6">
            {page.offers.map((o, i) => (
              <li key={`${o.worker}-${i}`}>
                {o.worker}: {o.response ? (RESPONSE[o.response] ?? o.response) : "waiting"} (
                {o.byOffice ? `by ${o.byOffice}` : `wave ${o.wave ?? ""}`},{" "}
                {timeOnDay(o.sentAt, tz)})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={section} aria-labelledby="history">
        <h2 id="history" className={heading}>
          History
        </h2>
        {page.history.length === 0 ? (
          <p className="mt-2">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-2">
            {page.history.map((h, i) => (
              <li key={i} className="mt-1">
                <span className="text-slate-600">{timeOnDay(h.at, tz)}:</span> {h.words}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/office/shifts" className="mt-8 inline-block underline">
        Back to shifts
      </Link>
    </main>
  );
}
