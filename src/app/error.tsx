"use client";

import { usePathname } from "next/navigation";
import { ErrorBody } from "./error-body";
import { OfficeErrorView } from "./office/error-view";
import { useHydrated } from "./use-hydrated";
import { useOnline } from "./use-online";

// Shown instead of a raw error screen when a page fails. Plain words; the details are in the
// (masked) server log. With no network at all, it says that instead. "Try again" is Next's
// retry() (src/app/error-body.tsx). On an /office address it only shows when the office's frame
// itself failed (src/app/office/error.tsx catches its pages' failures inside the frame), so it uses
// the office's words and "Back to the office" (Phase 37.6).
const isOfficePath = (path: string | null) =>
  path === "/office" || (path?.startsWith("/office/") ?? false);

export default function ErrorPage({ retry }: { retry: () => void }) {
  const online = useOnline();
  const ready = useHydrated();
  if (isOfficePath(usePathname())) {
    return <OfficeErrorView online={online} ready={ready} retry={retry} />;
  }
  return <ErrorBody online={online} ready={ready} retry={retry} />;
}
