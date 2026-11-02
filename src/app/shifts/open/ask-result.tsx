import Link from "next/link";
import type { AskShiftOutcome } from "@/lib/portal/ask-shift";
import { tryAgainText } from "@/lib/portal/copy";
import { TooManyTries } from "../../too-many-tries";
import { staffBtn } from "../../ui/classes";
import { Icon } from "../../ui/icons";

// "Casuals ask, you choose" in the casual app (Phase 26.6, ses-6; docs/screens.md `/shifts/[id]`):
// what she sees once she has asked ("Asked: we'll tell you", and when), when the office said no
// ("Not this time"), and the other answers to "I can do this". Plain words; every tap ends with an
// answer.

export function AskedNote({ at }: { at: string }) {
  return (
    <div
      role="status"
      data-asked=""
      className="flex items-start gap-2.5 rounded-xl bg-done-soft p-3.5"
    >
      <span
        aria-hidden="true"
        className="flex size-6.5 shrink-0 items-center justify-center rounded-[5px] bg-done-fill text-on-done"
      >
        <Icon name="check" size={17} />
      </span>
      <span>
        <strong className="font-semibold">Asked: we&apos;ll tell you.</strong> You asked at {at}.
        The office chooses who works this one. We&apos;ll message you when they decide.
      </span>
    </div>
  );
}

export function NotThisTimeNote() {
  return (
    <div role="status" data-not-this-time="" className="rounded-xl bg-urgent-soft p-3.5">
      <p>
        <strong className="font-semibold">Not this time.</strong> You&apos;re not booked for this
        one. Thanks for asking.
      </p>
      <Link href="/shifts/open" className={`${staffBtn.secondary} mt-3`}>
        See other shifts
      </Link>
    </div>
  );
}

export function AskResult({
  outcome,
}: {
  outcome: Exclude<AskShiftOutcome, { status: "logged_out" } | { status: "take_it" }>;
}) {
  switch (outcome.status) {
    case "asked":
      return <AskedNote at={outcome.at} />;
    case "not_this_time":
      return <NotThisTimeNote />;
    case "booked":
      return (
        <div role="status">
          <p className="font-semibold">You&apos;re already booked on this shift.</p>
          <Link href="/shifts" className={`${staffBtn.secondary} mt-3`}>
            See my shifts
          </Link>
        </div>
      );
    case "filled":
      return (
        <p role="alert" className="font-semibold">
          Every place has been filled. You haven&apos;t been booked.
        </p>
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
          <p className="font-semibold text-urgent-ink">You can&apos;t ask for this shift:</p>
          <ul className="mt-1 list-disc pl-5 text-urgent-ink">
            {outcome.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </div>
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
