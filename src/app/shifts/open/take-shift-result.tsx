import Link from "next/link";
import type { TakeShiftOutcome } from "@/lib/portal/take-shift";
import { tryAgainText } from "@/lib/portal/copy";
import { TooManyTries } from "../../too-many-tries";
import { staffBtn } from "../../ui/classes";
import { Icon } from "../../ui/icons";

// What the worker sees after tapping "Take shift" (docs/screens.md copy rules: plain words, and a
// confirmation they can screenshot: what, when, a reference, signed by the firm).
// Phase 18: booked is a green tick, the shift and its reference, and the way to see it among her
// shifts (where it arrives marked "New"); someone else taking it first is a red note. Phase 24
// (round 7): "You're booked." covers the whole screen as what floats does (`glass-float`: the page
// blurred behind it, solid in the fallbacks); the button puts it in <body>
// (src/app/shifts/open/take-shift-button.tsx).
export function TakeShiftResult({
  outcome,
  reviewHref,
  shiftId,
}: {
  outcome: Exclude<TakeShiftOutcome, { status: "logged_out" }>;
  reviewHref?: string; // the shift's page, where the worker can ask the office to review
  shiftId?: string; // to mark it "New" on her shifts
}) {
  switch (outcome.status) {
    case "booked":
      return (
        <div
          role="status"
          data-booked=""
          className="glass-float fixed inset-0 z-50 flex animate-fade flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-10 text-center"
        >
          <span
            aria-hidden="true"
            className="flex size-20 animate-toast items-center justify-center rounded-full bg-done-fill text-on-done shadow-lift"
          >
            <Icon name="check" size={44} />
          </span>
          <p className="text-3xl font-semibold tracking-heading">You&apos;re booked.</p>
          <div className="text-lg">
            {outcome.when && <p className="font-semibold tabular-nums">{outcome.when}</p>}
            {outcome.role && (
              <p>
                {outcome.role}
                {outcome.siteName ? ` at ${outcome.siteName}` : ""}
              </p>
            )}
            <p className="mt-1 font-semibold tabular-nums">Reference: {outcome.ref}</p>
            <p className="mt-1 text-ink-muted">— {outcome.signOff}</p>
          </div>
          <Link
            href={shiftId ? `/shifts?new=${shiftId}` : "/shifts"}
            className={`${staffBtn.primary} mt-2 max-w-sm`}
          >
            See my shifts
          </Link>
        </div>
      );
    case "filled":
      return (
        <p role="alert" className="flex items-start gap-2.5 rounded-xl bg-urgent-soft p-3.5">
          <span
            aria-hidden="true"
            className="flex size-6.5 shrink-0 items-center justify-center rounded-[5px] bg-urgent-fill text-on-urgent"
          >
            <Icon name="close" size={17} />
          </span>
          <span>
            <strong className="font-semibold">Someone else took it first.</strong> You haven&apos;t
            been booked.
          </span>
        </p>
      );
    case "already_assigned":
      return (
        <div role="status">
          <p className="font-semibold">You&apos;re already booked on this shift.</p>
          <Link href="/" className={`${staffBtn.secondary} mt-3`}>
            See my shifts
          </Link>
        </div>
      );
    case "gone":
      return (
        <p role="alert" className="font-semibold">
          This shift isn&apos;t open any more.
        </p>
      );
    case "not_eligible":
      return (
        <div role="alert" className="rounded-xl bg-urgent-soft p-4">
          <p className="font-semibold text-urgent-ink">You can&apos;t take this shift:</p>
          <ul className="mt-1 list-disc pl-5 text-urgent-ink">
            {outcome.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
          <p className="mt-2 text-base">If you think this is wrong, ask the office to review it.</p>
          {reviewHref && (
            <Link href={reviewHref} className={`${staffBtn.secondary} mt-3`}>
              Ask the office to review
            </Link>
          )}
        </div>
      );
    case "not_yet":
      return (
        <p role="alert" className="font-semibold">
          This shift is offered first to people with fewer hours that week. You can take it from{" "}
          {outcome.opensAt}.
        </p>
      );
    case "try_again":
      return (
        <p role="alert" className="font-semibold">
          We can&apos;t confirm this shift right now. Try again in a few minutes.
        </p>
      );
    case "rate_limited":
      return <TooManyTries minutes={outcome.retryAfterMinutes} />;
    case "error":
      return (
        <p role="alert" className="font-semibold text-urgent">
          {tryAgainText()}
        </p>
      );
  }
}
