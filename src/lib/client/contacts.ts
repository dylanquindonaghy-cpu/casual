import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import { normaliseEmail } from "../auth/office-login";
import { sendPortalLinkTask } from "../auth/send-portal-link";
import { endEverySession } from "../auth/sessions";
import { hitLimit, LIMITS, logLimitReached, toMinutes } from "../auth/throttle";
import { CLIENT_CONTACT_NAME_MAX, clientContacts } from "../db/schema";
import { appEnv } from "../env";
import { recordEvent } from "../events/record";
import { sendFirmJob } from "../jobs/firm-job";
import { officeUserMay, parts, type OfficeContext } from "../office/office-context";

// A contract's client logins (Phase 36.3; the mock-up's "A contract's client logins"): who at the
// client may log in and send requests. Admins only (the client_logins area), checked inside each
// transaction as every office change is. Add one (name and work email), switch one off (every
// session they have ends and every link they haven't used stops working, at once) or back on, and
// send one a login link. Each change logged with ids and counts only (never a name or address:
// the log's rule).

const nameSchema = z.string().trim().min(1).max(CLIENT_CONTACT_NAME_MAX);

export interface ClientContactRow {
  id: string;
  name: string;
  email: string;
  isOn: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export type ContactsResult =
  | { status: "ok"; contacts: ClientContactRow[] }
  | { status: "not_found" }
  | { status: "not_allowed" };

// The contract's client logins, A to Z (on ones first).
export async function listClientContacts(
  ctx: OfficeContext,
  contractId: string,
): Promise<ContactsResult> {
  if (!z.uuid().safeParse(contractId).success) return { status: "not_found" };
  return parts(ctx).run(ctx.firm.id, async (tx): Promise<ContactsResult> => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "client_logins")))
      return { status: "not_allowed" };
    const { rows: found } = await tx.execute(
      sql`select 1 from clients where id = ${contractId}::uuid`,
    );
    if (found.length === 0) return { status: "not_found" };
    const contacts = await tx
      .select({
        id: clientContacts.id,
        name: clientContacts.name,
        email: clientContacts.email,
        isOn: clientContacts.isOn,
        lastLoginAt: clientContacts.lastLoginAt,
        createdAt: clientContacts.createdAt,
      })
      .from(clientContacts)
      .where(eq(clientContacts.contractId, contractId))
      .orderBy(sql`${clientContacts.isOn} desc`, asc(sql`lower(${clientContacts.name})`));
    return { status: "ok", contacts };
  });
}

export type AddContactResult =
  | { status: "added"; clientContactId: string }
  | { status: "invalid"; problem: "name" | "email" }
  | { status: "email_taken" } // another client login here has this address
  | { status: "not_found" } // no such contract
  | { status: "not_allowed" };

export async function addClientContact(
  ctx: OfficeContext,
  input: { contractId: string; name: unknown; email: unknown },
): Promise<AddContactResult> {
  if (!z.uuid().safeParse(input.contractId).success) return { status: "not_found" };
  const name = nameSchema.safeParse(input.name);
  if (!name.success) return { status: "invalid", problem: "name" };
  const email = typeof input.email === "string" ? normaliseEmail(input.email) : null;
  if (!email) return { status: "invalid", problem: "email" };
  try {
    return await parts(ctx).run(ctx.firm.id, async (tx): Promise<AddContactResult> => {
      if (!(await officeUserMay(tx, ctx.officeUserId, "client_logins")))
        return { status: "not_allowed" };
      // The contract held, so a removal of it waits (and then takes this login with it).
      const { rows: contract } = await tx.execute(
        sql`select 1 from clients where id = ${input.contractId}::uuid for share`,
      );
      if (contract.length === 0) return { status: "not_found" };
      const [taken] = await tx
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(eq(clientContacts.email, email));
      if (taken) return { status: "email_taken" };
      const [row] = await tx
        .insert(clientContacts)
        .values({
          firmId: sql`app_current_firm_id()`,
          contractId: input.contractId,
          name: name.data,
          email,
          createdBy: ctx.officeUserId,
        })
        .returning({ id: clientContacts.id });
      if (!row) throw new Error("client contact insert returned nothing");
      await recordEvent(tx, {
        actorType: "office",
        actorId: ctx.officeUserId,
        action: "client_contact.added",
        entityType: "client_contact",
        entityId: row.id,
        data: { contractId: input.contractId },
      });
      return { status: "added", clientContactId: row.id };
    });
  } catch (error) {
    // Two admins adding the same address at once: the unique key decides.
    if ((error as { code?: string }).code === "23505") return { status: "email_taken" };
    throw error;
  }
}

export type SwitchContactResult =
  | { status: "switched"; on: boolean; sessions: number; links: number }
  | { status: "unchanged" }
  | { status: "not_found" }
  | { status: "not_allowed" };

// Off: they can't log in, and every session and unused link of theirs ends now (endEverySession,
// in this transaction). On again: they log in afresh (anything left over is ended too).
export async function setClientContactOn(
  ctx: OfficeContext,
  input: { clientContactId: string; on: boolean },
): Promise<SwitchContactResult> {
  if (!z.uuid().safeParse(input.clientContactId).success) return { status: "not_found" };
  const now = (ctx.clock ?? systemClock).now();
  return parts(ctx).run(ctx.firm.id, async (tx): Promise<SwitchContactResult> => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "client_logins")))
      return { status: "not_allowed" };
    const [contact] = await tx
      .select({ isOn: clientContacts.isOn, contractId: clientContacts.contractId })
      .from(clientContacts)
      .where(eq(clientContacts.id, input.clientContactId))
      .for("update");
    if (!contact) return { status: "not_found" };
    if (contact.isOn === input.on) return { status: "unchanged" };
    await tx
      .update(clientContacts)
      .set({ isOn: input.on })
      .where(eq(clientContacts.id, input.clientContactId));
    const ended = await endEverySession(tx, {
      kind: "client",
      subjectId: input.clientContactId,
      now,
    });
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action: input.on ? "client_contact.switched_on" : "client_contact.switched_off",
      entityType: "client_contact",
      entityId: input.clientContactId,
      data: { contractId: contact.contractId, sessions: ended.sessions, links: ended.links },
    });
    return { status: "switched", on: input.on, ...ended };
  });
}

export type SendLinkResult =
  | { status: "sent" }
  | { status: "off" } // switched off: switch them on first
  | { status: "rate_limited"; retryAfterMinutes: number }
  | { status: "not_found" }
  | { status: "not_allowed" };

// "Send link": a login link to their email now, by the same job as one they ask for themselves
// (src/lib/auth/send-portal-link.ts, purpose client_login). At most 3 every 15 minutes per contact.
export async function sendClientLoginLink(
  ctx: OfficeContext & { secret?: string },
  clientContactId: string,
): Promise<SendLinkResult> {
  if (!z.uuid().safeParse(clientContactId).success) return { status: "not_found" };
  const now = (ctx.clock ?? systemClock).now();
  const secret = ctx.secret ?? appEnv().SESSION_SECRET;
  return parts(ctx).run(ctx.firm.id, async (tx): Promise<SendLinkResult> => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "client_logins")))
      return { status: "not_allowed" };
    const [contact] = await tx
      .select({ isOn: clientContacts.isOn })
      .from(clientContacts)
      .where(and(eq(clientContacts.id, clientContactId)));
    if (!contact) return { status: "not_found" };
    if (!contact.isOn) return { status: "off" };
    const limit = LIMITS.clientLinkByOffice;
    const hit = await hitLimit(tx, { limit, value: clientContactId, now, secret });
    if (!hit.allowed) {
      if (hit.hits === limit.max + 1)
        await logLimitReached(tx, limit, "client_contact", clientContactId);
      return { status: "rate_limited", retryAfterMinutes: toMinutes(hit.retryAfterMs) };
    }
    const requestId = randomUUID();
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action: "client_contact.link_requested",
      entityType: "client_contact",
      entityId: clientContactId,
      data: {},
    });
    await sendFirmJob(tx, sendPortalLinkTask, {
      idempotencyKey: requestId,
      purpose: "client_login",
      address: "portal",
      subjectId: clientContactId,
    });
    return { status: "sent" };
  });
}
