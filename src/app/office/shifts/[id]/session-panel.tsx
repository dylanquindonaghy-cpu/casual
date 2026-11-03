"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { CLOSE_PANEL } from "@/lib/office/session-page-copy";
import { Icon } from "../../../ui/icons";

// A session's slide-in panel (Phase 26.6, ses-5): one of its forms (assign someone, edit, details,
// move or cancel), opened from its "…" menu as a link (`?panel=edit`), so it works before the page
// is ready and the browser's Back closes it. From the right on a laptop, the whole screen on a
// phone, over a scrim that closes it. Its heading takes the focus when it opens; Escape and Close
// go back to the page.
export function SessionPanel({
  title,
  closeHref,
  children,
}: {
  title: string;
  closeHref: string;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const close = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <Link
        href={closeHref}
        aria-hidden="true"
        tabIndex={-1}
        scroll={false}
        className="fixed inset-0 z-40 animate-fade bg-scrim/40"
      />
      <section
        aria-labelledby="panel-title"
        data-session-panel=""
        className="@container fixed inset-0 z-50 flex flex-col overflow-hidden glass-float text-ink lg:top-3 lg:right-3 lg:bottom-3 lg:left-auto lg:w-[32rem] lg:max-w-[calc(100vw-1.5rem)] lg:rounded-card"
      >
        <div className="flex items-start gap-3 px-6 pt-6">
          <h2
            id="panel-title"
            ref={heading}
            tabIndex={-1}
            className="min-w-0 flex-1 text-2xl font-semibold tracking-heading focus:outline-none"
          >
            {title}
          </h2>
          <Link
            ref={close}
            href={closeHref}
            scroll={false}
            aria-label={CLOSE_PANEL}
            className="press-glass glass-button inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-button-hover active:bg-button-press"
          >
            <Icon name="close" />
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-4 pb-6">
          {children}
        </div>
      </section>
    </>
  );
}
