import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { uuidArray } from "../db/arrays";
import type { FirmTx } from "../db/scoped";
import { officeUsers } from "../db/schema";
import { recordEvent } from "../events/record";
import { DASHBOARD_CARDS, readCards, type DashboardCard } from "./dashboard-cards";
import { officeUserMay, parts, type OfficeContext } from "./office-context";

// Contracts (Phase 26.3; decision 1 of the office review, the spec page's cus-1 and cus-2): a
// firm's clients, each owning some of its sites, set up by an admin on Settings; and each office
// user's own choice of the contracts they look after and the dashboard cards they see (cus-3,
// cus-4), saved to them under Customise. Plain code decides everything here, inside the firm's
// transaction (RLS), and every change is logged with ids and counts only (never a name: the log's
// rule). A site belongs to one contract at most: giving it to one takes it from any other.

export const CLIENT_NAME_MAX = 120;
const clientName = z.string().trim().min(1).max(CLIENT_NAME_MAX);
const uuids = z.array(z.uuid()).max(500);

export interface ContractRow {
  clientId: string;
  name: string;
  siteIds: string[];
}
export interface SiteChoice {
  siteId: string;
  name: string;
  clientId: string | null;
}

// Settings' list: every contract with its sites, and every site (the choices), A to Z.
export async function loadContracts(
  tx: FirmTx,
): Promise<{ contracts: ContractRow[]; sites: SiteChoice[] }> {
  const { rows: cs } = await tx.execute<{ id: string; name: string }>(
    sql`select id::text as id, name from clients order by lower(name), id`,
  );
  const { rows: ss } = await tx.execute<{ id: string; name: string; client_id: string | null }>(
    sql`select id::text as id, name, client_id::text as client_id
          from sites order by lower(name), id`,
  );
  return {
    contracts: cs.map((c) => ({
      clientId: c.id,
      name: c.name,
      siteIds: ss.filter((s) => s.client_id === c.id).map((s) => s.id),
    })),
    sites: ss.map((s) => ({ siteId: s.id, name: s.name, clientId: s.client_id })),
  };
}

export type ContractResult =
  | { status: "saved"; clientId: string }
  | { status: "removed" }
  | { status: "invalid" }
  | { status: "name_taken" }
  | { status: "not_found" }
  | { status: "not_allowed" };

class Unknown extends Error {}

// Adds a contract (clientId null) or saves one: its name, and the venues ticked or unticked since
// the form was loaded (`before`: the venues it had then). Only those change: a venue ticked is taken
// from any other contract it's in now, one unticked is left with none if it's still this one's.
// So a form loaded before someone moved a venue elsewhere can't take it back unseen. Logged with
// how many venues it has now, how many were added and removed, and each one taken from another
// contract (ids only).
export async function saveContract(
  ctx: OfficeContext,
  input: { clientId: string | null; name: unknown; siteIds: unknown; before?: unknown },
): Promise<ContractResult> {
  if (input.clientId !== null && !z.uuid().safeParse(input.clientId).success)
    return { status: "not_found" };
  const name = clientName.safeParse(input.name);
  const sites = uuids.safeParse(input.siteIds);
  const was = uuids.safeParse(input.before ?? []);
  if (!name.success || !sites.success || !was.success) return { status: "invalid" };
  const picked = new Set(sites.data);
  const before = new Set(input.clientId ? was.data : []);
  const added = [...picked].filter((id) => !before.has(id));
  const dropped = [...before].filter((id) => !picked.has(id));
  const { run } = parts(ctx);
  try {
    return await run(ctx.firm.id, async (tx): Promise<ContractResult> => {
      if (!(await officeUserMay(tx, ctx.officeUserId, "settings")))
        return { status: "not_allowed" };
      // The contract's row first, so a save and a removal of it never cross.
      if (input.clientId) {
        const { rows } = await tx.execute<{ id: string }>(
          sql`select id::text as id from clients where id = ${input.clientId}::uuid for update`,
        );
        if (!rows[0]) return { status: "not_found" };
      }
      const { rows: taken } = await tx.execute<{ id: string }>(
        sql`select id::text as id from clients where lower(name) = lower(${name.data})`,
      );
      if (taken.some((t) => t.id !== input.clientId)) return { status: "name_taken" };
      if (added.length > 0) {
        const { rows } = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from sites where id = any(${uuidArray(added)})`,
        );
        if ((rows[0]?.n ?? 0) !== added.length) return { status: "not_found" };
      }
      let clientId = input.clientId;
      if (clientId) {
        await tx.execute(sql`update clients set name = ${name.data} where id = ${clientId}::uuid`);
      } else {
        const { rows } = await tx.execute<{ id: string }>(
          sql`insert into clients (firm_id, name) values (app_current_firm_id(), ${name.data})
              returning id::text as id`,
        );
        clientId = rows[0]?.id ?? null;
        if (!clientId) throw new Unknown();
      }
      // Each venue ticked: taken from another contract (noted) or from none.
      const { rows: from } = await tx.execute<{ site_id: string; client_id: string }>(
        sql`select id::text as site_id, client_id::text as client_id from sites
             where id = any(${uuidArray(added)}) and client_id is not null
               and client_id <> ${clientId}::uuid
             order by id`,
      );
      if (added.length > 0)
        await tx.execute(
          sql`update sites set client_id = ${clientId}::uuid where id = any(${uuidArray(added)})`,
        );
      if (dropped.length > 0)
        await tx.execute(
          sql`update sites set client_id = null
               where id = any(${uuidArray(dropped)}) and client_id = ${clientId}::uuid`,
        );
      const { rows: now } = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from sites where client_id = ${clientId}::uuid`,
      );
      await recordEvent(tx, {
        actorType: "office",
        actorId: ctx.officeUserId,
        action: input.clientId ? "client.saved" : "client.added",
        entityType: "client",
        entityId: clientId,
        data: {
          sites: now[0]?.n ?? 0,
          added: added.length,
          removed: dropped.length,
          ...(from.length > 0
            ? { taken: from.map((r) => ({ siteId: r.site_id, from: r.client_id })) }
            : {}),
        },
      });
      return { status: "saved", clientId };
    });
  } catch (error) {
    // Two admins adding the same name (any case) at once: the unique index decides.
    if ((error as { code?: string }).code === "23505") return { status: "name_taken" };
    throw error;
  }
}

// Removes a contract: its sites are left with none first, and everyone's choice of it goes with it,
// as do its client logins and their requests (Phase 36).
export async function removeContract(
  ctx: OfficeContext,
  clientId: string,
): Promise<ContractResult> {
  if (!z.uuid().safeParse(clientId).success) return { status: "not_found" };
  return parts(ctx).run(ctx.firm.id, async (tx): Promise<ContractResult> => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "settings"))) return { status: "not_allowed" };
    // The contract's row first, so a removal and a save of it never cross.
    const { rows: found } = await tx.execute<{ id: string }>(
      sql`select id::text as id from clients where id = ${clientId}::uuid for update`,
    );
    if (!found[0]) return { status: "not_found" };
    const { rows: sites } = await tx.execute<{ n: number }>(
      sql`with cleared as (update sites set client_id = null where client_id = ${clientId}::uuid
                           returning 1)
          select count(*)::int as n from cleared`,
    );
    // Its client logins and their requests go with it (Phase 36: the cascade; their sessions and
    // links too), counted here for the log.
    const { rows: logins } = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from client_contacts where contract_id = ${clientId}::uuid`,
    );
    const { rows } = await tx.execute<{ id: string }>(
      sql`delete from clients where id = ${clientId}::uuid returning id::text as id`,
    );
    if (!rows[0]) return { status: "not_found" };
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action: "client.removed",
      entityType: "client",
      entityId: clientId,
      data: {
        sites: sites[0]?.n ?? 0,
        ...(logins[0]?.n ? { clientLogins: logins[0].n } : {}),
      },
    });
    return { status: "removed" };
  });
}

// --- Each person's own dashboard ----------------------------------------------------------------

export interface ContractChoice {
  clientId: string;
  name: string;
  sites: number;
  sessions: number; // sessions to come at its sites (not cancelled)
}

export interface MyDashboard {
  cards: DashboardCard[];
  clientIds: string[]; // the contracts they look after (none: everything)
  sites: string[] | null; // those contracts' sites (null: none chosen, so every venue)
  choices: ContractChoice[]; // every contract, for Customise
}

export async function loadMyDashboard(
  tx: FirmTx,
  officeUserId: string,
  now: Date,
): Promise<MyDashboard> {
  const [me] = await tx
    .select({ cards: officeUsers.dashboardCards })
    .from(officeUsers)
    .where(eq(officeUsers.id, officeUserId));
  const { rows: mine } = await tx.execute<{ id: string }>(
    sql`select client_id::text as id from office_user_clients
         where office_user_id = ${officeUserId}::uuid order by created_at, id`,
  );
  const { rows: choices } = await tx.execute<{
    id: string;
    name: string;
    sites: number;
    sessions: number;
  }>(sql`
    select c.id::text as id, c.name,
           (select count(*)::int from sites v
             where v.firm_id = c.firm_id and v.client_id = c.id) as sites,
           (select count(*)::int from shifts s
              join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
              join sites v on v.firm_id = s.firm_id and v.id = coalesce(s.site_id, e.site_id)
             where v.client_id = c.id and s.status in ('open', 'filled')
               and s.starts_at > ${now}) as sessions
      from clients c
     order by lower(c.name), c.id
  `);
  const clientIds = mine.map((r) => r.id);
  let sites: string[] | null = null;
  if (clientIds.length > 0) {
    const { rows } = await tx.execute<{ id: string }>(
      sql`select id::text as id from sites where client_id = any(${uuidArray(clientIds)})
           order by id`,
    );
    sites = rows.map((r) => r.id);
  }
  return {
    cards: readCards(me?.cards ?? undefined),
    clientIds,
    sites,
    choices: choices.map((c) => ({
      clientId: c.id,
      name: c.name,
      sites: c.sites,
      sessions: c.sessions,
    })),
  };
}

export type SaveDashboardResult =
  { status: "saved" } | { status: "invalid" } | { status: "not_allowed" };

// Customise's "Save my dashboard": the contracts they look after and the cards they see, saved to
// them (replacing what was there), logged with counts and the cards' names.
export async function saveMyDashboard(
  ctx: OfficeContext,
  input: { clientIds: unknown; cards: unknown },
): Promise<SaveDashboardResult> {
  const ids = uuids.safeParse(input.clientIds);
  const picked = z
    .array(z.enum(DASHBOARD_CARDS))
    .max(DASHBOARD_CARDS.length * 2)
    .safeParse(input.cards);
  if (!ids.success || !picked.success) return { status: "invalid" };
  const clientIds = [...new Set(ids.data)];
  const cards = readCards(picked.data);
  return parts(ctx).run(ctx.firm.id, async (tx): Promise<SaveDashboardResult> => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "today"))) return { status: "not_allowed" };
    if (clientIds.length > 0) {
      const { rows } = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from clients where id = any(${uuidArray(clientIds)})`,
      );
      if ((rows[0]?.n ?? 0) !== clientIds.length) return { status: "invalid" };
    }
    await tx
      .update(officeUsers)
      .set({ dashboardCards: cards })
      .where(eq(officeUsers.id, ctx.officeUserId));
    await tx.execute(
      sql`delete from office_user_clients where office_user_id = ${ctx.officeUserId}::uuid`,
    );
    if (clientIds.length > 0)
      await tx.execute(
        sql`insert into office_user_clients (firm_id, office_user_id, client_id)
            select app_current_firm_id(), ${ctx.officeUserId}::uuid, c
              from unnest(${uuidArray(clientIds)}) as c`,
      );
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action: "office_user.dashboard_saved",
      entityType: "office_user",
      entityId: ctx.officeUserId,
      data: { contracts: clientIds.length, cards },
    });
    return { status: "saved" };
  });
}

// Customise's own page (before the dashboard's page is ready, or opened directly): the person's
// dashboard, for an admin or resourcer, or null.
export async function officeMyDashboard(
  ctx: OfficeContext,
  now: Date = new Date(),
): Promise<MyDashboard | null> {
  return parts(ctx).run(ctx.firm.id, async (tx) =>
    (await officeUserMay(tx, ctx.officeUserId, "today"))
      ? loadMyDashboard(tx, ctx.officeUserId, now)
      : null,
  );
}

// Settings' Contracts section: every contract and site, for an admin, or null.
export async function officeContracts(
  ctx: OfficeContext,
): Promise<{ contracts: ContractRow[]; sites: SiteChoice[] } | null> {
  return parts(ctx).run(ctx.firm.id, async (tx) =>
    (await officeUserMay(tx, ctx.officeUserId, "settings")) ? loadContracts(tx) : null,
  );
}
