import { muted, staffBtn } from "@/app/ui/classes";
import type { PushState } from "@/lib/portal/push-state";

// How else messages reach them, for the lines below (P2.7; Phase 26.9): by text or by email (their
// choice, src/app/profile/profile-view.tsx otherWayOf), else no other way.
export type OtherWay = "text" | "email" | "none";
const by = (other: OtherWay) => (other === "text" ? "by text" : "by email");

// What "Notifications on this phone" says in each state (push-setting.tsx decides the state).
// `justTurnedOff` adds the confirmation after "Turn off notifications". A part of "How we reach
// you" under its own line; its buttons are secondary there ("Save settings" is the card's main one).
// Profile shows it only where the firm has phone notifications (28.11), so its "no_key" words are
// for any other caller.
export function PushSettingView({
  state,
  firmName,
  otherWay,
  pending = false,
  problem = null,
  justTurnedOff = false,
  onTurnOn,
  onTurnOff,
}: {
  state: PushState;
  firmName: string;
  otherWay: OtherWay;
  pending?: boolean;
  problem?: string | null;
  justTurnedOff?: boolean;
  onTurnOn?: () => void;
  onTurnOff?: () => void;
}) {
  const note = `mt-1 ${muted}`;
  return (
    <div className="mt-6 border-t border-line pt-5">
      <h3 className="text-lg font-semibold text-ink">Notifications on this phone</h3>
      {state === "no_key" && (
        <p className={note}>
          {firmName} doesn&apos;t use phone notifications yet.
          {otherWay !== "none" && ` We'll send your messages ${by(otherWay)}.`}
        </p>
      )}
      {state === "unsupported" && (
        <p className={note}>
          This browser can&apos;t show notifications.
          {otherWay !== "none" && ` You'll still get messages ${by(otherWay)}.`}
        </p>
      )}
      {state === "add_to_home_screen" && (
        <p className={note}>
          On iPhone, add this page to your home screen first. Then open it from there and turn
          notifications on.
        </p>
      )}
      {state === "blocked" && (
        <p className={note}>
          Notifications are blocked for this site. You can allow them in your phone&apos;s settings.
        </p>
      )}
      {state === "off" && (
        <>
          {justTurnedOff ? (
            <p role="status" className="mt-1">
              Notifications are off for this phone.
              {otherWay !== "none" && ` You'll still get messages ${by(otherWay)}.`}
            </p>
          ) : (
            <p className="mt-1">
              {otherWay === "none"
                ? "Get urgent shift alerts on this phone."
                : `Get urgent shift alerts on this phone, as well as ${otherWay === "text" ? "by message" : "by email"}.`}
            </p>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={onTurnOn}
            className={`${staffBtn.secondary} mt-3`}
          >
            Turn on notifications
          </button>
        </>
      )}
      {state === "on" && (
        <>
          <p role="status" className="mt-1">
            Notifications are on for this phone.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={onTurnOff}
            className={`${staffBtn.secondary} mt-3`}
          >
            Turn off notifications
          </button>
        </>
      )}
      {problem && (
        <p role="alert" className="mt-2 font-semibold text-urgent-ink">
          {problem}
        </p>
      )}
    </div>
  );
}
