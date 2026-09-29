"use client";

import { useSyncExternalStore } from "react";

// False in the server's HTML and until React has taken over the page in the browser, then true.
// A button whose work is done by a click handler stays disabled until then: before it, a click
// does nothing (no request, no message), which on a slow connection looks like a broken button.
const subscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
