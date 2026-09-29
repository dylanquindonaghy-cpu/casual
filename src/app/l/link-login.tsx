"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { clearOfflineCopy } from "@/lib/portal/offline";
import { forgetThisPhonesPush } from "@/lib/portal/push-client";
import { TooManyTries } from "../too-many-tries";
import { consumeLoginLinkAction } from "./actions";
import { tryAgainText } from "@/lib/portal/copy";

// The login link is /l#<token>. The token stays in the fragment, which browsers never send to
// the server; this reads it, clears it from the address bar and history, and sends it only
// when the worker taps the button.
type LinkAction = (
  token: string,
) => Promise<
  { status: "ok" | "rejected" | "error" } | { status: "rate_limited"; retryAfterMinutes: number }
>;

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
    const fromHash = window.location.hash.replace(/^#/, "");
    if (fromHash) window.history.replaceState(null, "", window.location.pathname);
    // Keep the first value read: in development React runs this effect twice, and the second run
    // finds the fragment already cleared. Reading the fragment is only possible in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken((previous) => previous ?? (fromHash || null));
  }, []);

  if (token === undefined) return null;

  if (token === null || rejected) {
    return (
      <div role="alert" className="mt-6">
        <p className="text-xl">This link has expired or was already used.</p>
        <Link
          href={newLink}
          className="mt-4 block w-full rounded-xl bg-slate-900 px-4 py-4 text-center text-lg font-semibold text-white"
        >
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
        <p role="alert" className="mt-4 text-red-700">
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
        className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Logging in…" : "Log me in"}
      </button>
    </div>
  );
}
