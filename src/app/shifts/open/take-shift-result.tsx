import Link from "next/link";
import type { TakeShiftOutcome } from "@/lib/portal/take-shift";
import { tryAgainText } from "@/lib/portal/copy";
import { TooManyTries } from "../../too-many-tries";
import { staffBtn } from "../../ui/classes";
import { Icon } from "../../ui/icons";
import { Slip } from "../../ui/slip";

// What the worker sees after tapping "Take shift" (docs/screens.md copy rules: plain words, and a
// confirmation they can screenshot: what, when, a reference, signed by the firm).
// Phase 18: booked is a green tick, the shift and its reference, and the way to see it among her
// shifts (where it arrives marked "New"). Phase 24 (round 7): "You're booked." covers the whole
// screen as what floats does (`glass-float`: the page blurred behind it, solid in the fallbacks);
// the button puts it in <body> (src/app/shifts/open/take-shift-button.tsx). Phase 28 (28.5): every
// other answer is one of 28.1's slips (someone else took it first, the rules' reasons: red; not
// yet, try again: amber; already booked: green; not open any more: grey), and "See my shifts"
// always goes to her shifts.
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
        <Slip tone="urgent" role="alert" title="Someone else took it first.">
          <p>You haven&apos;t been booked.</p>
        </Slip>
      );
    case "already_assigned":
      return (
        <div role="status">
          <Slip tone="done" title="You're already booked on this shift." />
          <Link href="/shifts" className={`${staffBtn.secondary} mt-3`}>
            See my shifts
          </Link>
        </div>
      );
    case "gone":
      return <Slip tone="quiet" role="alert" title="This shift isn't open any more." />;
    case "not_eligible":
      return (
        <Slip tone="urgent" role="alert" title="You can't take this shift:">
          <ul className="list-disc pl-5">
            {outcome.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
          <p className="mt-1">If you think this is wrong, ask the office to review it.</p>
          {reviewHref && (
            <Link href={reviewHref} className={`${staffBtn.secondary} mt-2`}>
              Ask the office to review
            </Link>
          )}
        </Slip>
      );
    case "not_yet":
      return (
        <Slip
          tone="attention"
          role="alert"
          title={`This shift is offered first to people with fewer hours that week. You can take it from ${outcome.opensAt}.`}
        />
      );
    case "ask_first":
      return (
        <Slip
          tone="attention"
          role="alert"
          title="The office now chooses who works this one. Ask for it instead."
        />
      );
    case "try_again":
      return (
        <Slip
          tone="attention"
          role="alert"
          title="We can't confirm this shift right now. Try again in a few minutes."
        />
      );
    case "rate_limited":
      return <TooManyTries minutes={outcome.retryAfterMinutes} />;
    case "error":
      return <Slip tone="urgent" role="alert" title={tryAgainText()} />;
  }
}
