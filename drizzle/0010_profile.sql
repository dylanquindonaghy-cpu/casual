CREATE TABLE "worker_unavailable_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_unavailable_days_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "worker_unavailable_days_firm_id_worker_day_key" UNIQUE("firm_id","worker_id","day")
);
--> statement-breakpoint
ALTER TABLE "worker_unavailable_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "notify_channel" text DEFAULT 'whatsapp' NOT NULL;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "offer_alerts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "worker_unavailable_days" ADD CONSTRAINT "worker_unavailable_days_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_unavailable_days" ADD CONSTRAINT "worker_unavailable_days_worker_fk" FOREIGN KEY ("firm_id","worker_id") REFERENCES "public"."workers"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_notify_channel_check" CHECK ("workers"."notify_channel" in ('whatsapp', 'sms'));--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "worker_unavailable_days" AS PERMISSIVE FOR ALL TO public USING ("worker_unavailable_days"."firm_id" = (select app_current_firm_id())) WITH CHECK ("worker_unavailable_days"."firm_id" = (select app_current_firm_id()));