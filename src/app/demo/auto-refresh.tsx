"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// The Demo phone checks for new messages by itself (16.1): every few seconds, while the tab is in
// view, it asks the server for the page again (router.refresh keeps the scroll position).
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
