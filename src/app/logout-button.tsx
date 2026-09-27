"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

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
