import { muted, staffBtn } from "@/app/ui/classes";
import type { PushState } from "@/lib/portal/push-state";

// What "Notifications on this phone" says in each state (push-setting.tsx decides the state).
// `justTurnedOff` adds the confirmation after "Turn off notifications". A part of "How we reach
// you" under its own line; its buttons are secondary there ("Save settings" is the card's main one).
export function PushSettingView({
  state,
  firmName,
  pending = false,
  problem = null,
  justTurnedOff = false,
  onTurnOn,
  onTurnOff,
}: {
  state: PushState;
  firmName: string;
  pending?: boolean;
  problem?: string | null;
  justTurnedOff?: boolean;
  onTurnOn?: () => void;
  onTurnOff?: () => void;
}) {
  const note = `mt-1 ${muted}`;
  return (
    <div className="mt-6 border-t border-line pt-5">
      <h3 className="text-lg font-bold text-ink">Notifications on this phone</h3>
      {state === "no_key" && (
        <p className={note}>
          Phone notifications aren&apos;t switched on for {firmName} yet. You&apos;ll get messages
          by WhatsApp or text.
        </p>
      )}
      {state === "unsupported" && (
        <p className={note}>
          This browser can&apos;t show notifications. You&apos;ll still get messages by WhatsApp or
          text.
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
              Notifications are off for this phone. You&apos;ll still get messages by WhatsApp or
              text.
            </p>
          ) : (
            <p className="mt-1">Get urgent shift alerts on this phone, as well as by message.</p>
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
        <p role="alert" className="mt-2 font-semibold text-urgent">
          {problem}
        </p>
      )}
    </div>
  );
}
