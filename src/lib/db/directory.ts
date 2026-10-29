import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { z } from "zod";
import { onlyDemoFirms } from "../demo/scope";
import { appEnv } from "../env";
import { signOffFor } from "../tenancy/sign-off";
import { appPool, assertSafeAppConnection, drizzleFor } from "./pool";

// The app's own look-ups below (the defaults) know the made-up demo firms alone in demo mode
// (src/lib/demo/scope.ts; ADR-025). listFirmIds isn't one: the demo worker's check needs them all.
const demoMode = () => appEnv().DEMO_MODE;
const firmOf = (f: FirmDirectoryEntry) => f.id;

// Host -> firm lookup, before any firm is known. The app role can't read firms without a firm
// set, so this calls app_resolve_firm() (drizzle/0003_firm_directory.sql), which returns only
// public directory fields.

const rowSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  sign_off: z.string().nullable(),
});

export interface FirmDirectoryEntry {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  // "[Firm name] Shift Team" unless the firm set its own (golden rule 8).
  signOff: string;
}

export type ResolveFirmBySlug = (slug: string) => Promise<FirmDirectoryEntry | null>;

export function createDirectory(pool: Pool): ResolveFirmBySlug {
  const db = drizzleFor(pool);
  let ready: Promise<void> | undefined;
  return async (slug) => {
    ready ??= assertSafeAppConnection(pool).catch((err: unknown) => {
      ready = undefined;
      throw err;
    });
    await ready;
    const result = await db.execute(sql`select * from app_resolve_firm(${slug})`);
    if (result.rows.length === 0) return null;
    const row = rowSchema.parse(result.rows[0]);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      timezone: row.timezone,
      signOff: signOffFor(row.name, row.sign_off),
    };
  };
}

let defaultDirectory: ResolveFirmBySlug | undefined;

export function resolveFirmBySlug(slug: string): Promise<FirmDirectoryEntry | null> {
  defaultDirectory ??= onlyDemoFirms(createDirectory(appPool()), firmOf, demoMode);
  return defaultDirectory(slug);
}

// Incoming message -> firm: the firm whose shifts line is exactly this number (the "To" of a
// WhatsApp, text or call), through app_firm_by_line() (drizzle/0021_firm_by_line.sql), with the
// same public directory fields as a host look-up. Anything that isn't an E.164 number is null
// without asking the database. For the Twilio webhooks (Phase 7).
export type ResolveFirmByLine = (number: string) => Promise<FirmDirectoryEntry | null>;

const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/);

export function createLineDirectory(pool: Pool): ResolveFirmByLine {
  const db = drizzleFor(pool);
  let ready: Promise<void> | undefined;
  return async (number) => {
    if (!e164.safeParse(number).success) return null;
    ready ??= assertSafeAppConnection(pool).catch((err: unknown) => {
      ready = undefined;
      throw err;
    });
    await ready;
    const result = await db.execute(sql`select * from app_firm_by_line(${number})`);
    if (result.rows.length === 0) return null;
    const row = rowSchema.parse(result.rows[0]);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      timezone: row.timezone,
      signOff: signOffFor(row.name, row.sign_off),
    };
  };
}

let defaultLineDirectory: ResolveFirmByLine | undefined;

export function resolveFirmByLine(number: string): Promise<FirmDirectoryEntry | null> {
  defaultLineDirectory ??= onlyDemoFirms(createLineDirectory(appPool()), firmOf, demoMode);
  return defaultLineDirectory(number);
}

// A firm's own domain -> firm (Phase 8): the firm whose verified custom domain is exactly this
// name, through app_resolve_firm_by_domain() (drizzle/0025_custom_domains.sql), with the same public
// directory fields. The caller passes a checked, lowercase host name with no port
// (src/lib/tenancy/host.ts); anything longer than a host name can be is null without asking.
export type ResolveFirmByDomain = (domain: string) => Promise<FirmDirectoryEntry | null>;

export function createDomainDirectory(pool: Pool): ResolveFirmByDomain {
  const db = drizzleFor(pool);
  let ready: Promise<void> | undefined;
  return async (domain) => {
    if (domain.length === 0 || domain.length > 253) return null;
    ready ??= assertSafeAppConnection(pool).catch((err: unknown) => {
      ready = undefined;
      throw err;
    });
    await ready;
    const result = await db.execute(sql`select * from app_resolve_firm_by_domain(${domain})`);
    if (result.rows.length === 0) return null;
    const row = rowSchema.parse(result.rows[0]);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      timezone: row.timezone,
      signOff: signOffFor(row.name, row.sign_off),
    };
  };
}

let defaultDomainDirectory: ResolveFirmByDomain | undefined;

export function resolveFirmByDomain(domain: string): Promise<FirmDirectoryEntry | null> {
  defaultDomainDirectory ??= onlyDemoFirms(createDomainDirectory(appPool()), firmOf, demoMode);
  return defaultDomainDirectory(domain);
}

// Every firm's id, for the worker's scheduled jobs, which then visit each firm inside its own
// withFirm transaction. Through app_firm_ids() (drizzle/0006_firm_ids.sql): ids only.
export type ListFirmIds = () => Promise<string[]>;

export function createFirmIdLister(pool: Pool): ListFirmIds {
  const db = drizzleFor(pool);
  let ready: Promise<void> | undefined;
  return async () => {
    ready ??= assertSafeAppConnection(pool).catch((err: unknown) => {
      ready = undefined;
      throw err;
    });
    await ready;
    const result = await db.execute(sql`select app_firm_ids() as id`);
    return result.rows.map((r) => z.uuid().parse(r.id));
  };
}

let defaultLister: ListFirmIds | undefined;

export function listFirmIds(): Promise<string[]> {
  defaultLister ??= createFirmIdLister(appPool());
  return defaultLister();
}

// A planner's API key -> firm (12J.1; ADR-022): the firm and key id of a key that isn't revoked,
// through app_api_key_lookup() (drizzle/0045_planner_api.sql), given the key's sha256. The third
// look-up allowed before a firm is known; the call then runs in withFirm(). Anything but a 32-byte
// hash is null without asking the database.
export interface ApiKeyEntry {
  firmId: string;
  keyId: string;
}

export type ResolveApiKey = (hash: Buffer) => Promise<ApiKeyEntry | null>;

const keyRowSchema = z.object({ firm_id: z.uuid(), key_id: z.uuid() });

export function createKeyDirectory(pool: Pool): ResolveApiKey {
  const db = drizzleFor(pool);
  let ready: Promise<void> | undefined;
  return async (hash) => {
    if (hash.length !== 32) return null;
    ready ??= assertSafeAppConnection(pool).catch((err: unknown) => {
      ready = undefined;
      throw err;
    });
    await ready;
    const result = await db.execute(sql`select * from app_api_key_lookup(${hash})`);
    if (result.rows.length === 0) return null;
    const row = keyRowSchema.parse(result.rows[0]);
    return { firmId: row.firm_id, keyId: row.key_id };
  };
}

let defaultKeyDirectory: ResolveApiKey | undefined;

export function resolveApiKey(hash: Buffer): Promise<ApiKeyEntry | null> {
  defaultKeyDirectory ??= onlyDemoFirms(createKeyDirectory(appPool()), (k) => k.firmId, demoMode);
  return defaultKeyDirectory(hash);
}

// A connector's source -> firm (P5.3): the firm of a connector source that's switched on, through
// app_connector_source_firm() (drizzle/0056_connector_events.sql), for its webhooks, which name the
// source in their address. Only once the webhook's signature has passed (src/lib/connector/
// webhook.ts); the change then runs in withFirm(). Anything but a uuid is null without asking.
export interface ConnectorSourceEntry {
  firmId: string;
}

export type ResolveConnectorSource = (sourceId: string) => Promise<ConnectorSourceEntry | null>;

const sourceRowSchema = z.object({ firm_id: z.uuid() });

export function createConnectorSourceDirectory(pool: Pool): ResolveConnectorSource {
  const db = drizzleFor(pool);
  let ready: Promise<void> | undefined;
  return async (sourceId) => {
    if (!z.uuid().safeParse(sourceId).success) return null;
    ready ??= assertSafeAppConnection(pool).catch((err: unknown) => {
      ready = undefined;
      throw err;
    });
    await ready;
    const result = await db.execute(sql`select * from app_connector_source_firm(${sourceId})`);
    if (result.rows.length === 0) return null;
    return { firmId: sourceRowSchema.parse(result.rows[0]).firm_id };
  };
}

let defaultConnectorSourceDirectory: ResolveConnectorSource | undefined;

export function resolveConnectorSource(sourceId: string): Promise<ConnectorSourceEntry | null> {
  defaultConnectorSourceDirectory ??= onlyDemoFirms(
    createConnectorSourceDirectory(appPool()),
    (s) => s.firmId,
    demoMode,
  );
  return defaultConnectorSourceDirectory(sourceId);
}
