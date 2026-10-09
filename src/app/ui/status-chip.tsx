import type { ReactNode } from "react";
import { chip } from "./classes";

// A status word in a coloured pill with a small icon (docs/ui-design.md "Status tones"). The word
// is the existing word from the copy module; the icon is decorative, so the chip's text is
// exactly its children. Hook-free: safe in server and client components.

export type StatusTone = "urgent" | "attention" | "done" | "quiet";

const ICON_PATHS: Record<StatusTone, ReactNode> = {
  // Warning triangle: act now.
  urgent: (
    <>
      <path d="M12 3.5 2.5 20h19L12 3.5Z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </>
  ),
  // Clock: someone needs to act.
  attention: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  // Check: fine, finished.
  done: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  // Dash: information, closed.
  quiet: <path d="M6 12h12" />,
};

export function StatusChip({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`${chip.base} ${chip[tone]}${className ? ` ${className}` : ""}`}>
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        {ICON_PATHS[tone]}
      </svg>
      {children}
    </span>
  );
}
