import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { DAY, MINUTE, systemClock, type Clock } from "../auth/clock";
import {
  hitLimit,
  LIMITS,
  logLimitReached,
  peekLimit,
  toMinutes,
  type Limit,
} from "../auth/throttle";
import { events, firms } from "../db/schema";
import { withFirm, type FirmTx, type WithFirm } from "../db/scoped";
import { appEnv, workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { errorCode, firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { getTransport, type MessagingTransport } from "../messaging";
import { strikesEmailConfirmEmail } from "../messaging/templates";
import { portalUrl } from "../tenancy/portal-url";
import { signOffFor } from "../tenancy/sign-off";
import { officeUserMay, type OfficeContext } from "./office-context";

// The strikes team's email (docs/office-v2.md 3.10, S10; 12B.7). An admin saves it on Settings;
// the app changes firms.settings only through app_set_firm_setting() (migration 0036), which
// accepts strikes.email and strikes.email_verified_at and nothing else, and clears the confirmed
// time when the address changes. Saving queues the strikes-email-link job (ids only), which emails
// the address a link, signed with HMAC (keyed from SESSION_SECRET for this use only), valid for 7
// days. The signature covers the firm id, the address, the expiry and which save of the address it
// was sent for (the id of the latest `firm.settings_changed` naming strikes.email): a link sent for
// an old address can't confirm a new one, nor the same address saved again later, and a changed or
// late link is refused. Opening it and selecting "Confirm this address" sets the confirmed time.
// Evidence (12C) only ever goes to a confirmed address: confirmedStrikesEmail().
//
// Every change is logged `firm.settings_changed` with the keys only (never the address: the log
// refuses email addresses, docs/office-v2.md 6.1). Saving and confirming take the firm's
// strikes-email lock first, so a confirmation can't land on an address saved at the same moment.
// Each link is an email to an outside address, so a firm sends at most 3 every 15 minutes and 10 a
// day (like login emails, audit L49); a link that fails to confirm counts against the IP's failed
// links, like a login link (src/lib/auth/throttle.ts).

export const STRIKES_EMAIL_LINK_DAYS = 7;
export const STRIKES_EMAIL_LINK_QUEUE = "strikes-email-link";
export const STRIKES_EMAIL_MAX = 254;

type Settings = Record<string, unknown>;

export interface StrikesEmail {
  address: string | null;
  confirmedAt: Date | null;
}

// The address and its confirmed time as stored (settings.strikes), each only when it makes sense.
export function strikesEmailOf(settings: Settings): StrikesEmail {
  const strikes = settings.strikes;
  if (typeof strikes !== "object" || strikes === null) return { address: null, confirmedAt: null };
  const { email, email_verified_at: at } = strikes as Record<string, unknown>;
  const address = typeof email === "string" && email.length > 0 ? email : null;
  const confirmedAt =
    address && typeof at === "string" && !Number.isNaN(Date.parse(at)) ? new Date(at) : null;
  return { address, confirmedAt };
}

// Where strike evidence may go: the address, only once it's confirmed.
export function confirmedStrikesEmail(settings: Settings): string | null {
  const { address, confirmedAt } = strikesEmailOf(settings);
  return address && confirmedAt ? address : null;
}

// --- The signed link ----------------------------------------------------------------------------

// Which save of the address a link is for: what it signs besides the address.
export interface LinkFor {
  firmId: string;
  address: string;
  saved: number; // the id of the latest firm.settings_changed naming strikes.email (0: none)
}

const key = (secret: string) =>
  createHmac("sha256", secret).update("strikes-email-link:v1").digest();
const mac = (secret: string, link: LinkFor, expires: number) =>
  createHmac("sha256", key(secret))
    .update(
      `${link.firmId.toLowerCase()}\0${link.address.trim().toLowerCase()}\0${link.saved}\0${expires}`,
    )
    .digest("base64url");

// "{firm id and expiry}.{signature}", both base64url: the firm's id (16 bytes) and the expiry in
// seconds (5 bytes) packed into 28 characters, so the link holds no run of digits a log check
// would take for a phone number. The address and its save aren't in the link: they're checked
// against the firm's as they are when the link is used.
export function signStrikesEmailLink(secret: string, link: LinkFor & { expiresAt: Date }): string {
  const expires = Math.floor(link.expiresAt.getTime() / 1000);
  const packed = Buffer.alloc(21);
  Buffer.from(link.firmId.replace(/-/g, ""), "hex").copy(packed, 0);
  packed.writeUIntBE(expires, 16, 5);
  return `${packed.toString("base64url")}.${mac(secret, link, expires)}`;
}

export interface ParsedLink {
  expires: number; // seconds
  given: string; // the signature
}

// The link's shape, for this firm, before anything is read: null for anything else.
export function parseStrikesEmailLink(token: string, firmId: string): ParsedLink | null {
  const parts = /^([A-Za-z0-9_-]{28})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!parts) return null;
  const [, packedText = "", given = ""] = parts;
  const packed = Buffer.from(packedText, "base64url");
  if (packed.length !== 21) return null;
  if (packed.subarray(0, 16).toString("hex") !== firmId.replace(/-/g, "").toLowerCase()) {
    return null;
  }
  return { expires: packed.readUIntBE(16, 5), given };
}

export type LinkCheck = "ok" | "invalid" | "expired";

// "invalid": not a link, another firm's, changed, or for another address or an earlier save of it.
// The signature is checked before the expiry, so a forged link learns nothing.
export function checkStrikesEmailLink(
  secret: string,
  token: string,
  current: { firmId: string; address: string | null; saved: number; now: Date },
): LinkCheck {
  const parsed = parseStrikesEmailLink(token, current.firmId);
  if (!parsed || !current.address) return "invalid";
  const expected = Buffer.from(
    mac(
      secret,
      { firmId: current.firmId, address: current.address, saved: current.saved },
      parsed.expires,
    ),
  );
  const actual = Buffer.from(parsed.given);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return "invalid";
  return parsed.expires * 1000 > current.now.getTime() ? "ok" : "expired";
}

// --- Saving and confirming ----------------------------------------------------------------------

const lockStrikesEmail = (tx: FirmTx) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('strikes-email:' || app_current_firm_id()::text, 0))`,
  );

async function settingsOf(tx: FirmTx): Promise<Settings> {
  const [firm] = await tx
    .select({ settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  return firm?.settings ?? {};
}

// The latest save of the address (or its removal): what a link signs, so a link sent before it
// doesn't count. The confirmation's own change (strikes.email_verified_at alone) isn't one.
async function addressSaved(tx: FirmTx): Promise<number> {
  const { rows } = await tx.execute<{ id: number | string | null }>(sql`
    select max(e.id) as id from events e
     where e.action = 'firm.settings_changed' and e.data -> 'keys' ? 'strikes.email'
  `);
  return Number(rows[0]?.id ?? 0);
}

const setFirmSetting = (
  tx: FirmTx,
  key: "strikes.email" | "strikes.email_verified_at",
  value: string | null,
) => tx.execute(sql`select app_set_firm_setting(${key}, ${value})`);

export const strikesEmailSchema = z.strictObject({
  // Empty: no strikes team address (evidence goes nowhere).
  address: z.union([z.literal(""), z.email().max(STRIKES_EMAIL_MAX)]),
});

export type SaveStrikesEmailResult =
  | { status: "saved" } // a link is on its way to the new address
  | { status: "sent_again" } // the same address, not confirmed yet: another link
  | { status: "unchanged" } // the same address, already confirmed
  | { status: "cleared" }
  | { status: "invalid" }
  | { status: "too_many"; retryAfterMinutes: number } // links sent: nothing changed
  | { status: "not_allowed" }; // not an active admin

// Per firm (the throttle table is firm-scoped; the value is the firm's id).
export const STRIKES_LINK_LIMITS = [
  { name: "strikes_link:firm", max: 3, windowMs: 15 * MINUTE },
  { name: "strikes_link:firm_day", max: 10, windowMs: DAY },
] as const satisfies readonly Limit[];

const linkJob = {
  queue: STRIKES_EMAIL_LINK_QUEUE,
  schema: firmJobEnvelope.extend({
    idempotencyKey: z.string().regex(/^strikes-email-link:[0-9a-f-]{36}$/),
  }),
};
export type StrikesEmailLinkPayload = z.infer<typeof linkJob.schema>;

export async function saveStrikesEmail(
  ctx: OfficeContext & { secret?: string },
  raw: z.input<typeof strikesEmailSchema>,
): Promise<SaveStrikesEmailResult> {
  const parsed = strikesEmailSchema.safeParse({ address: raw.address?.trim() });
  if (!parsed.success) return { status: "invalid" };
  const address = parsed.data.address;
  const now = (ctx.clock ?? systemClock).now();
  return (ctx.run ?? withFirm)(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "settings"))) return { status: "not_allowed" };
    await lockStrikesEmail(tx);
    const before = strikesEmailOf(await settingsOf(tx));
    const by = { actorType: "office" as const, actorId: ctx.officeUserId };
    if (address === "") {
      if (!before.address) return { status: "unchanged" };
      await setFirmSetting(tx, "strikes.email", null);
      await recordEvent(tx, {
        ...by,
        action: "firm.settings_changed",
        entityType: "firm",
        entityId: ctx.firm.id,
        data: {
          by: "firm",
          keys: before.confirmedAt
            ? ["strikes.email", "strikes.email_verified_at"]
            : ["strikes.email"],
        },
      });
      return { status: "cleared" };
    }
    const same = before.address?.toLowerCase() === address.toLowerCase();
    if (same && before.confirmedAt) return { status: "unchanged" };
    // A link goes either way from here: counted first, and over the limit nothing changes. The
    // count stays (this transaction commits); the first refusal in a window is logged.
    const secret = ctx.secret ?? appEnv().SESSION_SECRET;
    for (const limit of STRIKES_LINK_LIMITS) {
      const hit = await hitLimit(tx, { limit, value: ctx.firm.id, now, secret });
      if (hit.allowed) continue;
      if (hit.hits === limit.max + 1) await logLimitReached(tx, limit, "firm");
      return { status: "too_many", retryAfterMinutes: toMinutes(hit.retryAfterMs) };
    }
    if (!same) {
      await setFirmSetting(tx, "strikes.email", address);
      await recordEvent(tx, {
        ...by,
        action: "firm.settings_changed",
        entityType: "firm",
        entityId: ctx.firm.id,
        data: {
          by: "firm",
          keys: before.confirmedAt
            ? ["strikes.email", "strikes.email_verified_at"]
            : ["strikes.email"],
        },
      });
    }
    await sendFirmJob(tx, linkJob, { idempotencyKey: `strikes-email-link:${randomUUID()}` });
    return { status: same ? "sent_again" : "saved" };
  });
}

export type ConfirmStrikesEmailResult =
  | { status: "confirmed" }
  | { status: "already" }
  | { status: "invalid" } // changed, another firm's or address's, or not a link
  | { status: "expired" }
  | { status: "rate_limited"; retryAfterMinutes: number }; // too many failed links from the IP

// The link's "Confirm this address", from anyone who has it (the strikes team needn't be office
// users): the firm comes from the request's host, never from the link. Something that isn't this
// firm's link is refused before the database; a link whose signature or expiry fails counts
// against the IP's failed links (20 every 15 minutes, shared with login links), and once they're
// used up no link is checked from that IP until the window ends.
export async function confirmStrikesEmail(
  ctx: { firm: { id: string }; ip: string; run?: WithFirm; clock?: Clock; secret?: string },
  token: string,
): Promise<ConfirmStrikesEmailResult> {
  if (!parseStrikesEmailLink(token, ctx.firm.id)) return { status: "invalid" };
  const now = (ctx.clock ?? systemClock).now();
  const secret = ctx.secret ?? appEnv().SESSION_SECRET;
  const limit = LIMITS.linkFailuresPerIp;
  return (ctx.run ?? withFirm)(ctx.firm.id, async (tx) => {
    const before = await peekLimit(tx, { limit, value: ctx.ip, now, secret });
    if (!before.allowed) {
      return { status: "rate_limited", retryAfterMinutes: toMinutes(before.retryAfterMs) };
    }
    await lockStrikesEmail(tx);
    const current = strikesEmailOf(await settingsOf(tx));
    const check = checkStrikesEmailLink(secret, token, {
      firmId: ctx.firm.id,
      address: current.address,
      saved: await addressSaved(tx),
      now,
    });
    if (check !== "ok") {
      const hit = await hitLimit(tx, { limit, value: ctx.ip, now, secret });
      if (hit.hits === limit.max) await logLimitReached(tx, limit, "firm");
      return { status: check };
    }
    if (current.confirmedAt) return { status: "already" };
    await setFirmSetting(tx, "strikes.email_verified_at", now.toISOString());
    await recordEvent(tx, {
      actorType: "system",
      action: "firm.settings_changed",
      entityType: "firm",
      entityId: ctx.firm.id,
      data: { by: "link", keys: ["strikes.email_verified_at"] },
    });
    return { status: "confirmed" };
  });
}

// --- The job: email the link --------------------------------------------------------------------

export interface StrikesEmailLinkDeps {
  transport: MessagingTransport;
  baseDomain: string;
  clock: Clock;
  secret: string;
}

export type StrikesEmailLinkResult =
  | { status: "sent" }
  | { status: "failed" }
  | { status: "already" } // this job's link was sent (or tried) before
  | { status: "not_needed" }; // no address now, or it's confirmed

// At most once (claim → send → record, like the notices): (1) a short transaction claims it
// (`firm.strikes_email_link`, under a lock on the job's key) with the address as it is now; (2)
// the email goes with no transaction open; (3) a short transaction logs
// `firm.strikes_email_link_sent` or `_failed`. A job stopped part-way sends nothing again (the
// email may have gone): the admin can select "Send the link again".
export async function runStrikesEmailLink(
  payload: StrikesEmailLinkPayload,
  run: WithFirm,
  deps: StrikesEmailLinkDeps,
): Promise<StrikesEmailLinkResult> {
  const now = deps.clock.now();
  const claim = await run(payload.firmId, async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${payload.idempotencyKey} || ':' || app_current_firm_id()::text, 0))`,
    );
    const [done] = await tx
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.action, "firm.strikes_email_link"),
          sql`${events.data} ->> 'request' = ${payload.idempotencyKey}`,
        ),
      )
      .limit(1);
    if (done) return { status: "already" as const };
    const [firm] = await tx
      .select({ name: firms.name, slug: firms.slug, settings: firms.settings })
      .from(firms)
      .where(eq(firms.id, payload.firmId));
    if (!firm) return { status: "not_needed" as const };
    const { address, confirmedAt } = strikesEmailOf(firm.settings);
    if (!address || confirmedAt) return { status: "not_needed" as const };
    const expiresAt = new Date(now.getTime() + STRIKES_EMAIL_LINK_DAYS * DAY);
    const token = signStrikesEmailLink(deps.secret, {
      firmId: payload.firmId,
      address,
      saved: await addressSaved(tx),
      expiresAt,
    });
    await recordEvent(tx, {
      actorType: "system",
      action: "firm.strikes_email_link",
      entityType: "firm",
      entityId: payload.firmId,
      data: { request: payload.idempotencyKey, expiresAt: expiresAt.toISOString() },
    });
    const voice = { name: firm.name, signOff: signOffFor(firm.name, firm.settings.sign_off) };
    return {
      status: "send" as const,
      to: address,
      email: strikesEmailConfirmEmail(
        voice,
        `${portalUrl(firm.slug, deps.baseDomain)}/confirm-email#${token}`,
      ),
    };
  });
  if (claim.status !== "send") return { status: claim.status };
  let code: string | null = null;
  try {
    await deps.transport.send({ channel: "email", to: claim.to, ...claim.email });
  } catch (err) {
    code = errorCode(err);
  }
  await run(payload.firmId, (tx) =>
    recordEvent(tx, {
      actorType: "system",
      action: code === null ? "firm.strikes_email_link_sent" : "firm.strikes_email_link_failed",
      entityType: "firm",
      entityId: payload.firmId,
      data:
        code === null
          ? { request: payload.idempotencyKey }
          : { request: payload.idempotencyKey, code },
    }),
  );
  return { status: code === null ? "sent" : "failed" };
}

export function createStrikesEmailLinkTask(
  deps: () => StrikesEmailLinkDeps,
): FirmTask<StrikesEmailLinkPayload> {
  return {
    queue: STRIKES_EMAIL_LINK_QUEUE,
    schema: linkJob.schema,
    task: (payload, run) => runStrikesEmailLink(payload, run, deps()),
  };
}

const workerDeps = (): StrikesEmailLinkDeps => {
  const env = workerEnv();
  return {
    transport: getTransport(env),
    baseDomain: env.APP_BASE_DOMAIN,
    clock: systemClock,
    secret: env.SESSION_SECRET,
  };
};
export const strikesEmailLinkTask = createStrikesEmailLinkTask(workerDeps);
