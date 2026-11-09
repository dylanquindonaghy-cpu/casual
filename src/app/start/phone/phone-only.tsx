"use client";

import { useEffect } from "react";

// On a phone (below 640px, the frame's own breakpoint) there's no point in a phone inside the phone:
// the browser goes straight to the casual app, replacing this page so Back returns to the chooser.
export function PhoneOnly() {
  useEffect(() => {
    if (window.matchMedia("(max-width: 639px)").matches) window.location.replace("/");
  }, []);
  return null;
}
