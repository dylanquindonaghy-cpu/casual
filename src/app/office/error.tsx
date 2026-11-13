"use client";

import { useHydrated } from "../use-hydrated";
import { useOnline } from "../use-online";
import { OfficeErrorView } from "./error-view";

// An office page that fails (Phase 37.6, w1-08): inside the office layout, so the rail, the top bar
// and the account menu stay. "Try again" is Next's retry(), never reset() (src/app/error.tsx).
export default function OfficeError({ retry }: { retry: () => void }) {
  return <OfficeErrorView online={useOnline()} ready={useHydrated()} retry={retry} />;
}
