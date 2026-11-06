"use client";

import { useEffect } from "react";

// A link to a folded section's heading (/profile#notify-heading: Home's "Choose how we reach you",
// say) opens that fold (28.11; fold.tsx). Without JavaScript the link still lands on the heading,
// which shows its fold's state, and a tap opens it. Renders nothing.
export function OpenFoldFromLink() {
  useEffect(() => {
    const open = () => {
      let id = "";
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return; // a mangled link: nothing to open
      }
      if (!id) return;
      const target = document.getElementById(id);
      const fold = target?.closest("details") ?? target?.querySelector("details");
      if (fold && !fold.open) {
        fold.open = true;
        target?.scrollIntoView({ block: "start" });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
