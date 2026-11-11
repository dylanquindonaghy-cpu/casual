import { eq, sql } from "drizzle-orm";
import { qualificationsFor } from "../credentials/qualifications";
import { workers } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { myPayDay } from "../portal/pay-day";
import { myShifts } from "../portal/my-shifts";
import { roleAndEvent, shiftWhen } from "../portal/format";
import { datePartsOfDay } from "../portal/sign-copy";
import { portalUrl } from "../tenancy/portal-url";
import { cutChars } from "../text/cut";
import type { FillInKey } from "./fill-ins";
import type { Facts } from "./render";

// The casual's own facts for an answer's fill-ins (Phase 35; docs/screens.md "## Phase 35",
// "Fill-ins"), read by code from the firm's data through the functions the casual app already uses
// (her pay day, her next shift, her qualifications, the firm's portal address), and only the ones
// the answer needs. A fact she has none of (no shift booked, no qualification with a date) is null:
// the answer then isn't sent (src/lib/answers/render.ts). Reads only, in the caller's transaction.
// Dates in the firm's time zone.

export const INSTRUCTIONS_MAX = 300;

export interface FactsContext {
  firm: { id: string; slug: string; timezone: string };
  baseDomain: string;
  now: Date;
}

// "Friday 20 November"
const longDay = (day: string) => datePartsOfDay(day).long;
// "Mon 9 to Sun 15 Nov"; across two months "Mon 30 Nov to Sun 6 Dec".
function cycleWords(start: string, end: string): string {
  const a = datePartsOfDay(start);
  const b = datePartsOfDay(end);
  return a.month === b.month
    ? `${a.dow} ${a.day} to ${b.dow} ${b.day} ${b.month}`
    : `${a.dow} ${a.day} ${a.month} to ${b.dow} ${b.day} ${b.month}`;
}
// "1 December 2026"
const dateWithYear = (day: string) =>
  `${datePartsOfDay(day).long.split(" ").slice(1).join(" ")} ${day.slice(0, 4)}`;

export async function factsFor(
  tx: FirmTx,
  ctx: FactsContext,
  workerId: string,
  keys: readonly FillInKey[],
): Promise<Facts> {
  const need = new Set(keys);
  const facts: Facts = {};
  // The casual app's readers open their own transaction through `run`: here, this one.
  const inThisTx: WithFirm = (_firmId, fn) => fn(tx);
  const portal = { firm: { id: ctx.firm.id }, run: inThisTx, clock: { now: () => ctx.now } };
  const link = (path: string) => `${portalUrl(ctx.firm.slug, ctx.baseDomain)}${path}`;

  if (need.has("first_name")) {
    const [w] = await tx
      .select({ firstName: workers.firstName })
      .from(workers)
      .where(eq(workers.id, workerId));
    facts.first_name = w?.firstName.trim() || null;
  }
  if (need.has("next_pay_day") || need.has("pay_cycle")) {
    const pay = await myPayDay(portal, workerId);
    if (need.has("next_pay_day")) facts.next_pay_day = longDay(pay.payDay);
    if (need.has("pay_cycle")) facts.pay_cycle = cycleWords(pay.start, pay.end);
  }
  if (need.has("next_shift") || need.has("next_shift_instructions")) {
    const [next] = await myShifts(portal, workerId, "upcoming");
    if (need.has("next_shift")) {
      facts.next_shift = next
        ? `${roleAndEvent(next.role, next.eventName)}, ${shiftWhen(next.startsAt, next.endsAt, ctx.firm.timezone)}${next.site ? ` at ${next.site.name}` : ""}`
        : null;
    }
    if (need.has("next_shift_instructions")) {
      const parts = next
        ? [
            next.uniform?.trim() ? `Uniform: ${next.uniform.trim()}` : null,
            next.meetingPoint?.trim() ? `Meet at: ${next.meetingPoint.trim()}` : null,
            next.instructions?.trim() ? next.instructions.trim() : null,
          ].filter((p): p is string => p !== null)
        : [];
      const joined = parts
        .map((p) => (/[.!?]$/.test(p) ? p : `${p}.`))
        .join(" ")
        .replace(/\s+/g, " ");
      facts.next_shift_instructions = joined ? cutChars(joined, INSTRUCTIONS_MAX) : null;
    }
  }
  if (need.has("licence_expiry")) {
    const quals = await qualificationsFor(tx, [workerId], {
      now: ctx.now,
      timeZone: ctx.firm.timezone,
    });
    const dated = (quals.get(workerId)?.qualifications ?? [])
      .filter((q) => q.expiresOn !== null && q.status !== "missing")
      .sort((a, b) => (a.expiresOn ?? "").localeCompare(b.expiresOn ?? ""));
    const soonest = dated[0];
    facts.licence_expiry =
      soonest && soonest.expiresOn
        ? soonest.status === "expired"
          ? `${soonest.name} ran out on ${dateWithYear(soonest.expiresOn)}`
          : `${soonest.name} runs to ${dateWithYear(soonest.expiresOn)}`
        : null;
  }
  if (need.has("pay_link")) facts.pay_link = link("/pay");
  if (need.has("profile_link")) facts.profile_link = link("/profile");
  if (need.has("shifts_link")) facts.shifts_link = link("/shifts");
  return facts;
}

// The firm's facts for factsFor, read in its own transaction.
export async function firmForFacts(
  tx: FirmTx,
): Promise<{ id: string; slug: string; timezone: string; settings: Record<string, unknown> }> {
  const { rows } = await tx.execute<{
    id: string;
    slug: string;
    timezone: string;
    settings: Record<string, unknown>;
  }>(
    sql`select id::text as id, slug, timezone, settings from firms where id = app_current_firm_id()`,
  );
  const firm = rows[0];
  if (!firm) throw new Error("firm not visible inside its own transaction");
  return firm;
}
