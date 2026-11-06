import Link from "next/link";
import type { AskShiftOutcome } from "@/lib/portal/ask-shift";
import { tryAgainText } from "@/lib/portal/copy";
import { TooManyTries } from "../../too-many-tries";
import { disc, slip, staffBtn } from "../../ui/classes";
import { Slip } from "../../ui/slip";
import { ToneIcon } from "../../ui/status-chip";

// "Casuals ask, you choose" in the casual app (Phase 26.6, ses-6; docs/screens.md `/shifts/[id]`):
// what she sees once she has asked ("Asked: we'll tell you", and when), when the office said no
// ("Not this time"), and the other answers to "I can do this". Plain words; every tap ends with an
// answer. Phase 28 (28.5): each is one of 28.1's slips (asked: green; not this time: grey; a
// refusal: red), and the way on is "See open shifts" (one name for one page).

export function AskedNote({ at }: { at: string }) {
  return (
    <div role="status" data-asked="" className={`${slip.base} ${slip.done}`}>
      <span aria-hidden="true" className={`${disc.base} ${disc.done}`}>
        <ToneIcon tone="done" size={16} />
      </span>
      <p className="min-w-0 flex-1 self-center">
        <strong className="font-semibold">Asked: we&apos;ll tell you.</strong> You asked at {at}.
        The office chooses who works this one. We&apos;ll message you when they decide.
      </p>
    </div>
  );
}

export function NotThisTimeNote() {
  return (
    <div role="status" data-not-this-time="" className={`${slip.base} ${slip.quiet}`}>
      <span aria-hidden="true" className={`${disc.base} ${disc.quiet}`}>
        <ToneIcon tone="quiet" size={16} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3 self-center">
        <p>
          <strong className="font-semibold">Not this time.</strong> You&apos;re not booked for this
          one. Thanks for asking.
        </p>
        <Link href="/shifts/open" className={staffBtn.secondary}>
          See open shifts
        </Link>
      </div>
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
          <Slip tone="done" title="You're already booked on this shift." />
          <Link href="/shifts" className={`${staffBtn.secondary} mt-3`}>
            See my shifts
          </Link>
        </div>
      );
    case "filled":
      return (
        <Slip tone="urgent" role="alert" title="Every place has been filled.">
          <p>You haven&apos;t been booked.</p>
        </Slip>
      );
    case "gone":
      return <Slip tone="quiet" role="alert" title="This shift isn't open any more." />;
    case "not_eligible":
      return (
        <Slip tone="urgent" role="alert" title="You can't ask for this shift:">
          <ul className="list-disc pl-5">
            {outcome.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </Slip>
      );
    case "rate_limited":
      return <TooManyTries minutes={outcome.retryAfterMinutes} />;
    case "error":
      return <Slip tone="urgent" role="alert" title={tryAgainText()} />;
  }
}
