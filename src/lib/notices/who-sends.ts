import { z } from "zod";
import type { BookVia } from "../db/schema";

// Who sends what (P2.3; PLAN.md "Connecting the firm's systems" 9 and 17). ShiftDesk tells a casual
// about the bookings made in ShiftDesk. A firm whose own system (its rota sheet; its CRM through the
// API, P5) already reminds the casuals it books switches `firm_system_sends` on (`npm run
// firm:settings`): ShiftDesk then sends no 24-hour or 2-hour reminder for a booking that system
// made (`assignments.booked_via` sheet or api), so nobody hears twice. Its offers, and the office's
// change and cancellation notices, still go (decision 9). A booking confirmation only ever goes for
// the office's own booking in ShiftDesk (src/lib/roster/book.ts), never for the sheet's or the
// API's, whatever this says.

const firmSystemSendsSchema = z.boolean();

// The firm's setting: anything but `true` is off (ShiftDesk reminds every booking, as before P2).
export function firmSystemSends(settings: Record<string, unknown>): boolean {
  const parsed = firmSystemSendsSchema.safeParse(settings.firm_system_sends);
  return parsed.success ? parsed.data : false;
}

// The bookings the firm's own system makes, and so tells its casuals about when the setting is on.
export const FIRM_SYSTEM_BOOKINGS = ["sheet", "api"] as const satisfies readonly BookVia[];
