CREATE TABLE "worker_site_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"blocked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_site_blocks_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "worker_site_blocks_firm_id_worker_site_key" UNIQUE("firm_id","worker_id","site_id"),
	CONSTRAINT "worker_site_blocks_reason_check" CHECK ("worker_site_blocks"."reason" in ('client_asked', 'incident', 'other'))
);
--> statement-breakpoint
ALTER TABLE "worker_site_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "office_deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "office_kept_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "worker_site_blocks" ADD CONSTRAINT "worker_site_blocks_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_site_blocks" ADD CONSTRAINT "worker_site_blocks_worker_fk" FOREIGN KEY ("firm_id","worker_id") REFERENCES "public"."workers"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_site_blocks" ADD CONSTRAINT "worker_site_blocks_site_fk" FOREIGN KEY ("firm_id","site_id") REFERENCES "public"."sites"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_site_blocks" ADD CONSTRAINT "worker_site_blocks_blocked_by_fk" FOREIGN KEY ("firm_id","blocked_by") REFERENCES "public"."office_users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "worker_site_blocks" AS PERMISSIVE FOR ALL TO public USING ("worker_site_blocks"."firm_id" = (select app_current_firm_id())) WITH CHECK ("worker_site_blocks"."firm_id" = (select app_current_firm_id()));