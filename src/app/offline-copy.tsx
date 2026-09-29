"use client";

import { useEffect } from "react";
import { keepOfflineCopy, stopOfflineCopy } from "@/lib/portal/offline";

// Keeps My shifts for when there's no signal (public/sw.js), each time it's shown or refreshed
// (renderedAt changes), or removes the copy when the offline copy is switched off.
export function OfflineCopy({ enabled, renderedAt }: { enabled: boolean; renderedAt: number }) {
  useEffect(() => {
    if (enabled) keepOfflineCopy();
    else void stopOfflineCopy();
  }, [enabled, renderedAt]);
  return null;
}
