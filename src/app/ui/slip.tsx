import type { ReactNode } from "react";
import { disc, slip } from "./classes";
import { ToneIcon, type StatusTone } from "./status-chip";

// A slip (Phase 28, 28.1; docs/ui-design.md "Phase 28"): a notice in a page, such as "No signal", a
// result ("Sent"), a warning or what was cancelled. Its status's pale tint with a 1px edge in that
// status's line colour, 8px round, ink words, led by the office's round icon disc (its Updates and
// the cancellation pop-up). The disc is decorative: the words say the status, so colour is never
// the only signal. `title` is a first line in semibold; `role` makes it a live status or an alert
// where the page needs one (a result after an action); otherwise it's plain words. Hook-free.
export function Slip({
  tone,
  title,
  role,
  className,
  children,
}: {
  tone: StatusTone;
  title?: ReactNode;
  role?: "status" | "alert" | "note";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role={role}
      data-slip={tone}
      className={`${slip.base} ${slip[tone]}${className ? ` ${className}` : ""}`}
    >
      <span aria-hidden="true" className={`${disc.base} ${disc[tone]}`}>
        <ToneIcon tone={tone} size={16} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 self-center">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}
