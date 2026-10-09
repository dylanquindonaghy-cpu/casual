"use client";

import { ErrorBody } from "./error-body";
import { useHydrated } from "./use-hydrated";
import { useOnline } from "./use-online";

// Shown instead of a raw error screen when a page fails. Plain words; the details are in the
// (masked) server log. With no network at all, it says that instead. "Try again" is Next's
// retry() (src/app/error-body.tsx).
export default function ErrorPage({ retry }: { retry: () => void }) {
  return <ErrorBody online={useOnline()} ready={useHydrated()} retry={retry} />;
}
