import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, firmIsolation } from "./helpers";

export const SECTORS = ["security", "rail", "construction", "cleaning"] as const;

// The slug checks below mirror src/lib/tenancy/slug.ts (reserved subdomains, no punycode);
// tests/integration/tenancy.firm-host.test.ts keeps the two in step.

export const firms = pgTable(
  "firms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    sector: text("sector", { enum: SECTORS }).notNull(),
    customDomain: text("custom_domain").unique(),
    domainVerified: boolean("domain_verified").notNull().default(false),
    brandLogoUrl: text("brand_logo_url"),
    brandPrimaryColor: text("brand_primary_color"),
    timezone: text("timezone").notNull().default("Europe/London"),
    // The firm's own number ("the shifts line"): WhatsApp, text and calls, E.164. One number
    // belongs to one firm. Null until we buy one (Twilio: PLAN.md Parking lot, "Connect Twilio").
    // Set by `npm run firm:line`, never by the app.
    shiftsLineE164: text("shifts_line_e164").unique(),
    // Shape and defaults are validated in code (FirmSettings), keys as in docs/data-model.md.
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    check("firms_slug_format", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{0,18}[a-z0-9]$'`),
    check(
      "firms_slug_not_reserved",
      // '^xn-{2}' rather than a literal double hyphen, which drizzle-kit mis-parses in SQL text.
      sql`${t.slug} not in ('www', 'portal', 'api', 'app', 'admin') and ${t.slug} !~ '^xn-{2}'`,
    ),
    check(
      "firms_sector_check",
      sql`${t.sector} in ('security', 'rail', 'construction', 'cleaning')`,
    ),
    check("firms_brand_color_hex", sql`${t.brandPrimaryColor} ~ '^#[0-9a-fA-F]{6}$'`),
    check("firms_brand_logo_https", sql`${t.brandLogoUrl} like 'https://%'`),
    check("firms_shifts_line_e164", sql`${t.shiftsLineE164} ~ '^[+][1-9][0-9]{6,14}$'`),
    // A firm's own domain (Phase 8): a lowercase host name, no port, no scheme (the owner's
    // `npm run firm:domain` checks the full rules; this keeps anything else out).
    check(
      "firms_custom_domain_host",
      sql`${t.customDomain} ~ '^[a-z0-9][a-z0-9.-]{0,251}[a-z]$' and ${t.customDomain} !~ '[.][.]'`,
    ),
    firmIsolation(t.id),
    // The migrating owner may read the firm directory; app_resolve_firm() runs as the owner.
    // The app role gets no such policy: it only sees its own firm.
    pgPolicy("directory_read", {
      as: "permissive",
      for: "select",
      to: "current_user",
      using: sql`true`,
    }),
  ],
).enableRLS();

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    name: text("name").notNull(),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    town: text("town"),
    postcode: text("postcode"),
    // Kept for Stage 3 (check-in by location); not used before then.
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lng: numeric("lng", { precision: 9, scale: 6 }),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("sites_firm_id_id_key").on(t.firmId, t.id),
    unique("sites_firm_id_name_key").on(t.firmId, t.name),
    firmIsolation(t.firmId),
  ],
).enableRLS();
