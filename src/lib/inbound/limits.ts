import { z } from "zod";
import { HOUR } from "../auth/clock";
import { hitLimit, type Limit } from "../auth/throttle";
import type { FirmTx } from "../db/scoped";

// What the shifts line may send by itself (PLAN.md "Connecting the firm's systems" 11 and 12; P4.7).
//
// - Automatic replies are off unless the firm's owner switches them on (`auto_replies`, through
//   `npm run firm:settings`). Off, a WhatsApp, a text or a voicemail that comes in is stored, sorted
//   and logged as before, and every casual's message becomes a question in Need a person, but
//   nothing goes back by WhatsApp or text: no reply, no "we don't recognise this number", no STOP
//   or START confirmation (a STOP itself still turns texts off). `message.received` then says
//   `replyHeld`. Casuals reach the office in the app instead (PLAN.md P8, the in-app chat).
// - The office's alerts about unknown numbers: at most 5 per firm a clock hour (each one email to
//   every admin and resourcer). Past that the message still waits in Need a person, and
//   `message.received` says `alertHeld` and the hour (`alertHour`); the rest that hour go in one
//   email at its end (Phase 25.3: src/lib/inbound/alerts-combined.ts).

const autoRepliesSchema = z.boolean();

// The firm's setting, as the shifts line reads it: anything but `true` is off.
export function autoRepliesOn(settings: Record<string, unknown>): boolean {
  const parsed = autoRepliesSchema.safeParse(settings.auto_replies);
  return parsed.success ? parsed.data : false;
}

export const UNKNOWN_ALERTS: Limit = { name: "alert:unknown_number", max: 5, windowMs: HOUR };

// One counter per firm (auth_throttle is firm-scoped), so its bucket names nobody: the hash that
// hides a number or an address elsewhere only needs a fixed key here.
const ONE_BUCKET_PER_FIRM = "unknown-number-alerts";

// Counts one unknown-number alert in this firm's hour, in the caller's transaction (the claim, so
// it counts once however often the job runs). False: over the limit, so no email.
export async function takeUnknownAlert(tx: FirmTx, now: Date): Promise<boolean> {
  const hit = await hitLimit(tx, {
    limit: UNKNOWN_ALERTS,
    value: "firm",
    now,
    secret: ONE_BUCKET_PER_FIRM,
  });
  return hit.allowed;
}

// The clock hour an alert is counted in (UNKNOWN_ALERTS' window): its start.
export function alertHourOf(now: Date): Date {
  return new Date(Math.floor(now.getTime() / UNKNOWN_ALERTS.windowMs) * UNKNOWN_ALERTS.windowMs);
}

const COMBINED_ALERT: Limit = { name: "alert:unknown_combined", max: 1, windowMs: HOUR };

// Claims the hour's one combined email (once per firm and hour, however often its job runs), in the
// caller's transaction. False: it was claimed before.
export async function takeCombinedAlert(tx: FirmTx, hourStart: Date): Promise<boolean> {
  const hit = await hitLimit(tx, {
    limit: COMBINED_ALERT,
    value: "firm",
    now: hourStart,
    secret: ONE_BUCKET_PER_FIRM,
  });
  return hit.allowed;
}
