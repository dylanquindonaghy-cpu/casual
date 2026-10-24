"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { staffBtn } from "@/app/ui/classes";
import { clearOfflineCopy } from "@/lib/portal/offline";
import { forgetThisPhonesPush } from "@/lib/portal/push-client";
import { TooManyTries } from "../too-many-tries";
import { consumeLoginLinkAction } from "./actions";
import { tryAgainText } from "@/lib/portal/copy";
import { tokenFromFragment } from "@/lib/auth/link-fragment";

// The login link is /l#<token>. The token stays in the fragment, which browsers never send to
// the server; this reads it, clears it from the address bar and history, and sends it only
// when the worker taps the button.
type LinkAction = (
  token: string,
) => Promise<
  { status: "ok" | "rejected" | "error" } | { status: "rate_limited"; retryAfterMinutes: number }
>;

// In the office (/office/l), its button is the office's main one (Phase 23): the sky with
// near-black words, 44px, a 1px edge, dipping when pressed. `office:` values only, so the casual
// app's button (the firm's colour, 52px) is unchanged.
const officeMain =
  "office:press office:min-h-11 office:border office:border-accent office:bg-accent office:py-2 office:text-base office:text-on-accent office:hover:border-accent-hover office:hover:bg-accent-hover office:hover:brightness-100 office:active:border-accent-press office:active:bg-accent-press";

// Shared by worker (/l) and office (/office/l) link pages.
export function LinkLogin({
  firmName,
  action = consumeLoginLinkAction,
  home = "/",
  newLink = "/login",
  prompt = `Tap the button to log in to ${firmName} on this phone.`,
}: {
  firmName: string;
  action?: LinkAction;
  home?: string;
  newLink?: string;
  prompt?: string;
}) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [rejected, setRejected] = useState(false);
  const [failed, setFailed] = useState(false);
  const [waitMinutes, setWaitMinutes] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const fromHash = tokenFromFragment(window.location.hash);
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    // Keep the first value read: in development React runs this effect twice, and the second run
    // finds the fragment already cleared. Reading the fragment is only possible in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken((previous) => previous ?? (fromHash || null));
  }, []);

  if (token === undefined) return null;

  if (token === null || rejected) {
    return (
      <div role="alert" className="mt-6">
        <p className="text-2xl font-semibold">This link has expired or was already used.</p>
        <Link href={newLink} className={`${staffBtn.primary} mt-4 ${officeMain}`}>
          Send me a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <p>{prompt}</p>
      {waitMinutes !== null && <TooManyTries minutes={waitMinutes} />}
      {failed && (
        <p role="alert" className="mt-4 font-semibold text-urgent">
          {tryAgainText()}
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setFailed(false);
            setWaitMinutes(null);
            try {
              const result = await action(token);
              if (result.status === "ok") {
                // A new login starts without any earlier worker's offline copy of My shifts.
                await clearOfflineCopy();
                await forgetThisPhonesPush(); // not the last worker's alerts either
                router.replace(home);
              } else if (result.status === "rejected") setRejected(true);
              else if (result.status === "rate_limited") setWaitMinutes(result.retryAfterMinutes);
              else setFailed(true);
            } catch {
              setFailed(true); // e.g. no signal
            }
          })
        }
        className={`${staffBtn.primary} mt-4 ${officeMain}`}
      >
        {pending ? "Logging in…" : "Log me in"}
      </button>
    </div>
  );
}
