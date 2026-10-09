-- 12G.1 (S8): a casual's travel area, one row per casual: the start postcode and its central point
-- (never a house number, GPS or movement), how they travel and their time limit. A table of its own
-- so the workers_erased check is unchanged; deleted on "They've left" and on erasure by the app.
CREATE TABLE "worker_travel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"start_postcode" text NOT NULL,
	"lat" numeric(9, 6) NOT NULL,
	"lng" numeric(9, 6) NOT NULL,
	"modes" text NOT NULL,
	"max_minutes" integer NOT NULL,
	"privacy_notice_version" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_travel_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "worker_travel_one_per_worker" UNIQUE("firm_id","worker_id"),
	CONSTRAINT "worker_travel_postcode_check" CHECK ("worker_travel"."start_postcode" ~ '^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$'),
	CONSTRAINT "worker_travel_point_check" CHECK ("worker_travel"."lat" between -90 and 90 and "worker_travel"."lng" between -180 and 180),
	CONSTRAINT "worker_travel_modes_check" CHECK ("worker_travel"."modes" in ('car', 'public_transport', 'both')),
	CONSTRAINT "worker_travel_minutes_check" CHECK ("worker_travel"."max_minutes" in (30, 45, 60, 90)),
	CONSTRAINT "worker_travel_notice_check" CHECK (length("worker_travel"."privacy_notice_version") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "worker_travel" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "worker_travel" ADD CONSTRAINT "worker_travel_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_travel" ADD CONSTRAINT "worker_travel_worker_fk" FOREIGN KEY ("firm_id","worker_id") REFERENCES "public"."workers"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "worker_travel" AS PERMISSIVE FOR ALL TO public USING ("worker_travel"."firm_id" = (select app_current_firm_id())) WITH CHECK ("worker_travel"."firm_id" = (select app_current_firm_id()));