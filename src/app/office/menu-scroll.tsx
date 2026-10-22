"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// The box the office menu scrolls in (Phase 22; Dylan: "a tacky scroll wheel on the left side"):
// no scrollbar, and a soft fade at the edge that has more to scroll to (globals.css `fade-edges`).
// Rows are 34px with a mouse, so an admin's whole menu fits a laptop window 640px tall and this
// only scrolls in a shorter one; the mouse wheel, a trackpad, a finger and the Tab key still
// scroll it. It opens with the page you're on in view. Without script it scrolls as it is, with no
// fade.
export type More = "above" | "below" | "both" | undefined;

export function moreToScroll(top: number, height: number, full: number): More {
  const above = top > 2;
  const below = top + height < full - 2;
  return above && below ? "both" : above ? "above" : below ? "below" : undefined;
}

export function MenuScroll({ children, className }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState<More>(undefined);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setMore(moreToScroll(el.scrollTop, el.clientHeight, el.scrollHeight));
    // The page you're on in view as the menu opens (it can sit in an opened group below the fold).
    const on = el.querySelector("[aria-current]");
    if (on) {
      const row = on.getBoundingClientRect();
      const view = el.getBoundingClientRect();
      if (row.bottom > view.bottom - 24) el.scrollTop += row.bottom - view.bottom + 48;
    }
    update();
    el.addEventListener("scroll", update, { passive: true });
    const sizes = new ResizeObserver(update);
    sizes.observe(el);
    for (const child of el.children) sizes.observe(child);
    return () => {
      el.removeEventListener("scroll", update);
      sizes.disconnect();
    };
  }, []);
  return (
    <div
      ref={box}
      data-menu-scroll=""
      data-more={more}
      className={`scrollbar-none fade-edges overflow-y-auto overscroll-contain${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}
