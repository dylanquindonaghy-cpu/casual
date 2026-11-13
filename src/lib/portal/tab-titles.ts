import { dayLabel } from "../rules/reasons";
import { localDateOf } from "../time/zoned";
import { roleLabel } from "./format";
import type { ShiftPage } from "./shift-detail";

// A casual's shift page names the shift in the browser tab (Phase 37.6, w1-09; docs/screens.md):
// "Door supervisor, Sat 14 Nov", and "Shift not available" when she can't see it (the page says
// "This shift isn't available."). Only what the page itself shows. Pure.
export const SHIFT_NOT_AVAILABLE_TITLE = "Shift not available";

export function shiftTabTitle(page: ShiftPage, timeZone: string): string {
  if (page.state === "missing") return SHIFT_NOT_AVAILABLE_TITLE;
  const { role, startsAt } = page.shift;
  return `${roleLabel(role)}, ${dayLabel(localDateOf(startsAt, timeZone))}`;
}
