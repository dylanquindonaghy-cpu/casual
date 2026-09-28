import { noticeText, type CancelShiftOutcome } from "@/lib/portal/cancel-reasons";

// What the worker sees after confirming a cancellation: an instant confirmation they can
// screenshot (what, when, the notice recorded, a reference, signed by the firm), or a plain answer.
export function CancelShiftResult({
  outcome,
}: {
  outcome: Exclude<CancelShiftOutcome, { status: "logged_out" | "invalid_reason" }>;
}) {
  switch (outcome.status) {
    case "cancelled":
      return (
        <div role="status" className="rounded-xl border-2 border-slate-900 bg-slate-50 p-4">
          <p className="text-xl font-bold">We&apos;ve recorded your cancellation.</p>
          {outcome.when && <p className="mt-1 font-semibold">{outcome.when}</p>}
          {outcome.role && (
            <p>
              {outcome.role}
              {outcome.siteName ? ` at ${outcome.siteName}` : ""}
            </p>
          )}
          <p className="mt-2">You gave {noticeText(outcome.noticeHours)}.</p>
          <p>Recorded at {outcome.recordedAt}.</p>
          <p className="mt-2">Reference: {outcome.ref}</p>
          <p className="mt-2 text-base">— {outcome.signOff}</p>
        </div>
      );
    case "started":
      return (
        <p role="alert" className="font-semibold">
          This shift has already started. Contact the office.
        </p>
      );
    case "not_booked":
      return (
        <p role="alert" className="font-semibold">
          You&apos;re not booked on this shift any more. If you&apos;ve just cancelled it, it&apos;s
          recorded.
        </p>
      );
    case "error":
      return (
        <p role="alert" className="font-semibold text-red-700">
          Something went wrong. Try again.
        </p>
      );
  }
}
