"use client";

import { useEffect } from "react";

// Replaces the session token once a day while the portal is in use (pages can't set cookies,
// so they call a server action to do it).
export function SessionKeeper({
  rotationDue,
  refresh,
}: {
  rotationDue: boolean;
  refresh: () => Promise<void>;
}) {
  useEffect(() => {
    if (rotationDue) void refresh();
  }, [rotationDue, refresh]);
  return null;
}
