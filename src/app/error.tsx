"use client";

import { ErrorBody } from "./error-body";
import { useOnline } from "./use-online";

// Shown instead of a raw error screen when a page fails. Plain words; the details are in the
// (masked) server log. With no network at all, it says that instead.
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <ErrorBody online={useOnline()} reset={reset} />;
}
