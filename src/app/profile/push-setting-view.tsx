import type { PushState } from "@/lib/portal/push-state";

// What "Notifications on this phone" says in each state (push-setting.tsx decides the state).
// `justTurnedOff` adds the confirmation after "Turn off notifications".
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
  const button = "mt-3 w-full rounded-xl px-4 py-4 text-lg font-semibold disabled:opacity-60";
  const note = "mt-1 text-base text-slate-600";
  return (
    <div className="mt-6">
      <h3 className="font-semibold">Notifications on this phone</h3>
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
            className={`${button} bg-slate-900 text-white`}
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
            className={`${button} border-2 border-slate-900`}
          >
            Turn off notifications
          </button>
        </>
      )}
      {problem && (
        <p role="alert" className="mt-2 text-red-700">
          {problem}
        </p>
      )}
    </div>
  );
}
