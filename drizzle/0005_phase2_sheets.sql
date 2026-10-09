CREATE TABLE "roster_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"spreadsheet_id" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_attempted_at" timestamp with time zone,
	"last_error_code" text,
	"sync_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roster_sources_kind_check" CHECK ("roster_sources"."kind" in ('sheets')),
	CONSTRAINT "roster_sources_spreadsheet_id_format" CHECK ("roster_sources"."spreadsheet_id" ~ '^[A-Za-z0-9_-]{20,100}$'),
	CONSTRAINT "roster_sources_mapping_object" CHECK (jsonb_typeof("roster_sources"."mapping") = 'object'),
	CONSTRAINT "roster_sources_error_code_format" CHECK ("roster_sources"."last_error_code" ~ '^[a-z_]{1,50}$')
);
--> statement-breakpoint
ALTER TABLE "roster_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "synced_holders" text[];--> statement-breakpoint
ALTER TABLE "roster_sources" ADD CONSTRAINT "roster_sources_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roster_sources_one_enabled_per_firm" ON "roster_sources" USING btree ("firm_id") WHERE enabled;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_firm_id_external_ref_key" UNIQUE("firm_id","external_ref");--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_external_ref_format" CHECK ("workers"."external_ref" = btrim("workers"."external_ref") and length("workers"."external_ref") between 1 and 200);--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "roster_sources" AS PERMISSIVE FOR ALL TO public USING ("roster_sources"."firm_id" = (select app_current_firm_id())) WITH CHECK ("roster_sources"."firm_id" = (select app_current_firm_id()));