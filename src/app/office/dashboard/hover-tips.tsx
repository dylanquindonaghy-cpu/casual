"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// The places chart's bars' tips (Phase 24, 24.3): each shows under the pointer over its day
// (pointer-fine:group-hover/bar), stays while the pointer moves onto it (a bridge over the gap), and
// Escape puts it away until the pointer moves to another day (WCAG 1.4.13: hoverable, persistent,
// dismissible). The numbers are the chart's table too, for a screen reader and the keyboard. A
// tip hides while `data-away` is on this box (`in-data-[away]:hidden!`).
export function HoverTips({ className, children }: { className: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  // The day whose tip Escape put away (null: none).
  const [away, setAway] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const day = box.current?.querySelector<HTMLElement>("[data-day]:hover")?.dataset.day;
      if (day) setAway(day);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div
      ref={box}
      aria-hidden="true"
      data-away={away === null ? undefined : ""}
      onPointerOver={(e) => {
        const day = (e.target as Element).closest<HTMLElement>("[data-day]")?.dataset.day;
        if (away !== null && day !== away) setAway(null);
      }}
      onPointerLeave={() => setAway(null)}
      className={className}
    >
      {children}
    </div>
  );
}
