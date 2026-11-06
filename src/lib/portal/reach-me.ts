import { sql } from "drizzle-orm";
import { withFirm } from "../db/scoped";
import { reachOf } from "../offers/reach";
import { hasTextSender } from "./login-way";
import type { PortalContext } from "./my-shifts";

// Home's two "can we reach you" rows in "Do this" (Phase 28.7; docs/screens.md "The casual app,
// Phase 28", 28.7), online only, each to Profile's "How we reach you":
// - "unreachable": nothing can reach her about shifts. The office's own rule, reachOf()
//   (src/lib/offers/reach.ts: no phone of hers with notifications on, no text because she replied
//   STOP or there's no text sender, and no email address held), the one that puts her under "Not
//   offered, and why" as "unreachable" (src/lib/office/offer-page.ts). It agrees with the offer
//   waves' own rule (src/lib/offers/candidates.ts `reached`), as
//   tests/unit/offers.reach-agrees.test.ts proves for every case.
// - "alerts_off": she turned "Tell me about open shifts" off (workers.offer_alerts), the office's
//   "offers_off" (src/lib/office/not-offered.ts).
// Reads only, her own row inside her firm; it decides nothing and changes nothing: who is offered
// a shift is the waves' business, untouched.

export type ReachPrompt = "unreachable" | "alerts_off";

export interface ReachFacts {
  phones: number; // her phones with notifications on (push_subscriptions)
  channel: "sms" | "email"; // her choice (workers.notify_channel)
  smsAllowed: boolean; // false: she replied STOP (workers.sms_opted_out_at)
  hasEmail: boolean; // the firm holds an address for her
  offerAlerts: boolean; // "Tell me about open shifts" (workers.offer_alerts)
}

// The rows to show, in Home's order. Pure.
export function reachPrompts(facts: ReachFacts, textSender: boolean): ReachPrompt[] {
  const out: ReachPrompt[] = [];
  if (reachOf(facts, textSender).how === "none") out.push("unreachable");
  if (!facts.offerAlerts) out.push("alerts_off");
  return out;
}

// Her facts, from her own row and her phones, inside her firm's transaction. Null when the row
// isn't hers to read (another firm's id reads as nothing).
export async function myReachFacts(
  ctx: PortalContext,
  workerId: string,
): Promise<ReachFacts | null> {
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    const { rows } = await tx.execute<{
      phones: number;
      channel: "sms" | "email";
      sms_allowed: boolean;
      has_email: boolean;
      offer_alerts: boolean;
    }>(sql`
      select (select count(*)::int from push_subscriptions p
               where p.firm_id = w.firm_id and p.worker_id = w.id) as phones,
             w.notify_channel as channel, w.sms_opted_out_at is null as sms_allowed,
             w.email is not null as has_email, w.offer_alerts
        from workers w
       where w.id = ${workerId}
    `);
    const row = rows[0];
    if (!row) return null;
    return {
      phones: Number(row.phones),
      channel: row.channel,
      smsAllowed: row.sms_allowed,
      hasEmail: row.has_email,
      offerAlerts: row.offer_alerts,
    };
  });
}

// Home's loader: the rows for her, with the web app's own text sender (hasTextSender, as the
// office's offer list uses).
export async function myReachPrompts(
  ctx: PortalContext,
  workerId: string,
  textSender: boolean = hasTextSender(),
): Promise<ReachPrompt[]> {
  const facts = await myReachFacts(ctx, workerId);
  return facts ? reachPrompts(facts, textSender) : [];
}
