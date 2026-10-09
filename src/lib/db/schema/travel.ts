import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, firmIsolation, timestamptz } from "./helpers";
import { firms, sites } from "./tenancy";

// Travel estimates (docs/office-v2.md 5.4; S9, built narrower; 12G.2): how long it takes to reach a
// site from a postcode by one way of travelling, arriving by a time (30 minutes before a session
// starts). Keyed by the postcode, never by the person: everyone starting from the same postcode
// shares it. Worked out by the travel job (src/lib/travel/estimates.ts), never by a page. Minutes
// are null when the site can't be reached within 90 minutes; metres (by car only) the road
// distance. Deleted when they expire (7 days after the last session they were worked out for, by
// the retention purge), and with the site's old ones when its postcode changes.
export const ESTIMATE_MODES = ["car", "public_transport"] as const;
export type EstimateMode = (typeof ESTIMATE_MODES)[number];

export const travelEstimates = pgTable(
  "travel_estimates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    originPostcode: text("origin_postcode").notNull(),
    siteId: uuid("site_id").notNull(),
    mode: text("mode", { enum: ESTIMATE_MODES }).notNull(),
    arriveBy: timestamptz("arrive_by").notNull(),
    minutes: integer("minutes"), // null: not within 90 minutes
    metres: integer("metres"), // by car only
    provider: text("provider", { enum: ["fake", "traveltime"] }).notNull(),
    computedAt: timestamptz("computed_at").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("travel_estimates_firm_id_id_key").on(t.firmId, t.id),
    unique("travel_estimates_one_per_trip").on(
      t.firmId,
      t.originPostcode,
      t.siteId,
      t.mode,
      t.arriveBy,
    ),
    foreignKey({
      name: "travel_estimates_site_fk",
      columns: [t.firmId, t.siteId],
      foreignColumns: [sites.firmId, sites.id],
    }).onDelete("cascade"),
    index("travel_estimates_firm_id_site_idx").on(t.firmId, t.siteId, t.arriveBy),
    index("travel_estimates_firm_id_expires_idx").on(t.firmId, t.expiresAt),
    check(
      "travel_estimates_postcode_check",
      sql`${t.originPostcode} ~ '^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$'`,
    ),
    check("travel_estimates_mode_check", sql`${t.mode} in ('car', 'public_transport')`),
    check(
      "travel_estimates_minutes_check",
      sql`${t.minutes} is null or ${t.minutes} between 0 and 90`,
    ),
    check(
      "travel_estimates_metres_check",
      sql`${t.metres} is null or (${t.metres} >= 0 and ${t.mode} = 'car')`,
    ),
    check("travel_estimates_provider_check", sql`${t.provider} in ('fake', 'traveltime')`),
    check("travel_estimates_expiry_check", sql`${t.expiresAt} > ${t.arriveBy}`),
    firmIsolation(t.firmId),
  ],
).enableRLS();
