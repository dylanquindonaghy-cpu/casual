-- 12G.2 (S9, built narrower): travel estimates, keyed by postcode, site, way of travelling and
-- arrive-by time, never by person. Worked out by the travel job; deleted when they expire (the
-- retention purge) and with a site's old ones when its postcode changes.
CREATE TABLE "travel_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"origin_postcode" text NOT NULL,
	"site_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"arrive_by" timestamp with time zone NOT NULL,
	"minutes" integer,
	"metres" integer,
	"provider" text NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_estimates_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "travel_estimates_one_per_trip" UNIQUE("firm_id","origin_postcode","site_id","mode","arrive_by"),
	CONSTRAINT "travel_estimates_postcode_check" CHECK ("travel_estimates"."origin_postcode" ~ '^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$'),
	CONSTRAINT "travel_estimates_mode_check" CHECK ("travel_estimates"."mode" in ('car', 'public_transport')),
	CONSTRAINT "travel_estimates_minutes_check" CHECK ("travel_estimates"."minutes" is null or "travel_estimates"."minutes" between 0 and 90),
	CONSTRAINT "travel_estimates_metres_check" CHECK ("travel_estimates"."metres" is null or ("travel_estimates"."metres" >= 0 and "travel_estimates"."mode" = 'car')),
	CONSTRAINT "travel_estimates_provider_check" CHECK ("travel_estimates"."provider" in ('fake', 'traveltime')),
	CONSTRAINT "travel_estimates_expiry_check" CHECK ("travel_estimates"."expires_at" > "travel_estimates"."arrive_by")
);
--> statement-breakpoint
ALTER TABLE "travel_estimates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "travel_estimates" ADD CONSTRAINT "travel_estimates_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_estimates" ADD CONSTRAINT "travel_estimates_site_fk" FOREIGN KEY ("firm_id","site_id") REFERENCES "public"."sites"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "travel_estimates_firm_id_site_idx" ON "travel_estimates" USING btree ("firm_id","site_id","arrive_by");--> statement-breakpoint
CREATE INDEX "travel_estimates_firm_id_expires_idx" ON "travel_estimates" USING btree ("firm_id","expires_at");--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "travel_estimates" AS PERMISSIVE FOR ALL TO public USING ("travel_estimates"."firm_id" = (select app_current_firm_id())) WITH CHECK ("travel_estimates"."firm_id" = (select app_current_firm_id()));