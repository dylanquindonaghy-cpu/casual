"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { clearOfflineCopy } from "@/lib/portal/offline";
import { forgetThisPhonesPush } from "@/lib/portal/push-client";

// Logs out through the given server action, then the browser goes to `after` itself.
export function LogoutButton({ action, after }: { action: () => Promise<void>; after: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          // The offline copy of My shifts goes first, even if logging out fails (no signal): a
          // shared phone must not keep it. It never throws or waits long.
          await clearOfflineCopy();
          await forgetThisPhonesPush(); // a shared phone stops getting this worker's alerts
          await action();
          router.replace(after);
        })
      }
      className="mt-8 w-full rounded-xl border-2 border-slate-900 px-4 py-4 text-lg font-semibold disabled:opacity-60"
    >
      {pending ? "Logging out…" : "Log out"}
    </button>
  );
}
