import { eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { FirmTx } from "../db/scoped";
import { officeUsers } from "../db/schema";
import { recordEvent } from "../events/record";
import { officeUserMay, parts, type OfficeContext } from "./office-context";
import {
  DEFAULT_TELL_ME,
  TELL_ME_KINDS,
  tellMeOf,
  withTellMe,
  type TellMeKind,
  type TellMeResult,
} from "./tell-me-copy";

// "Tell me about" (Phase 26.4; upd-4, upd-5, decision 5): each office user's own switches, saved to
// them (office_users.tell_me; null: the defaults) and logged; and, for the senders, who asked to be
// told about a kind of thing at a venue: active admins and resourcers with it switched on whose
// contracts take in the venue (every venue for someone with no contracts), as Updates narrows.

// The defaults as a Postgres array, for `coalesce(tell_me, …)`.
const defaultsSql = sql.raw(`array[${DEFAULT_TELL_ME.map((k) => `'${k}'`).join(", ")}]::text[]`);

// "This office user `ou` asked to be told about `kind`."
export const wantsSql = (kind: TellMeKind): SQL =>
  sql`coalesce(ou.tell_me, ${defaultsSql}) @> array[${kind}]::text[]`;

// "… and looks after `siteId`, or no contract at all" (a session with no venue: only the latter).
export const coversSiteSql = (siteId: string | null): SQL => sql`(
  not exists (select 1 from office_user_clients oc
               where oc.firm_id = ou.firm_id and oc.office_user_id = ou.id)
  or exists (select 1 from office_user_clients oc
               join sites v on v.firm_id = oc.firm_id and v.client_id = oc.client_id
              where oc.firm_id = ou.firm_id and oc.office_user_id = ou.id
                and v.id = ${siteId}::uuid))`;

export type Recipient = { id: string; email: string };

// Who to tell about `kind` at a session's venue (`siteId`: its own site, else its event's; `null`
// with `anyVenue`: the summary, which each person gets narrowed to their own contracts).
// `withBrowser`: only people with a browser that turned notifications on (a push has nowhere else
// to go). In id order, so two senders lock people's rows in the same order.
export async function recipientsFor(
  tx: FirmTx,
  kind: TellMeKind,
  where: { siteId: string | null; anyVenue?: boolean; withBrowser?: boolean },
): Promise<Recipient[]> {
  const venue = where.anyVenue ? sql`true` : coversSiteSql(where.siteId);
  const browser = where.withBrowser
    ? sql`exists (select 1 from office_push_subscriptions p
                   where p.firm_id = ou.firm_id and p.office_user_id = ou.id)`
    : sql`true`;
  const { rows } = await tx.execute<Recipient>(sql`
    select ou.id::text as id, ou.email
      from office_users ou
     where ou.status = 'active' and ou.role in ('admin', 'resourcer')
       and ${wantsSql(kind)} and ${venue} and ${browser}
     order by ou.id
  `);
  return rows;
}

// The person's switches (the defaults until they change one).
export async function loadTellMe(tx: FirmTx, officeUserId: string): Promise<TellMeKind[]> {
  const [me] = await tx
    .select({ tellMe: officeUsers.tellMe })
    .from(officeUsers)
    .where(eq(officeUsers.id, officeUserId));
  return tellMeOf(me?.tellMe ?? null);
}

const Input = z.object({ kind: z.enum(TELL_ME_KINDS), on: z.boolean() });

// One switch flipped: saved to the person (their row locked, so two quick flips don't lose one)
// and logged with what they're now told about.
export async function saveTellMe(
  ctx: OfficeContext,
  input: { kind: unknown; on: unknown },
): Promise<TellMeResult> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const { kind, on } = parsed.data;
  return parts(ctx).run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "today"))) return { status: "not_allowed" };
    const [me] = await tx
      .select({ tellMe: officeUsers.tellMe })
      .from(officeUsers)
      .where(eq(officeUsers.id, ctx.officeUserId))
      .for("update");
    if (!me) return { status: "not_allowed" };
    const before = tellMeOf(me.tellMe);
    const after = withTellMe(me.tellMe, kind, on);
    // Already so (a second tab, a double tap): nothing to write or log.
    if (before.join() === after.join()) return { status: "saved", kind, on };
    await tx.update(officeUsers).set({ tellMe: after }).where(eq(officeUsers.id, ctx.officeUserId));
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action: "office_user.tell_me_saved",
      entityType: "office_user",
      entityId: ctx.officeUserId,
      data: { kind, on, tellMe: after },
    });
    return { status: "saved", kind, on };
  });
}
