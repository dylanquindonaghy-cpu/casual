CREATE TABLE "webhook_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"address_set_at" timestamp with time zone NOT NULL,
	"last_delivered_at" timestamp with time zone,
	"failing_since" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_status_firm_id_key" UNIQUE("firm_id")
);
--> statement-breakpoint
ALTER TABLE "webhook_status" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "worker_ref" text GENERATED ALWAYS AS ((data ->> 'workerId')) STORED;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "shift_ref" text GENERATED ALWAYS AS ((data ->> 'shiftId')) STORED;--> statement-breakpoint
ALTER TABLE "webhook_status" ADD CONSTRAINT "webhook_status_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_firm_id_worker_ref_idx" ON "events" USING btree ("firm_id","worker_ref","id") WHERE "events"."worker_ref" is not null;--> statement-breakpoint
CREATE INDEX "events_firm_id_shift_ref_idx" ON "events" USING btree ("firm_id","shift_ref","id") WHERE "events"."shift_ref" is not null;--> statement-breakpoint
CREATE INDEX "events_firm_id_actor_id_idx" ON "events" USING btree ("firm_id","actor_id","id") WHERE "events"."actor_id" is not null;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "webhook_status" AS PERMISSIVE FOR ALL TO public USING ("webhook_status"."firm_id" = (select app_current_firm_id())) WITH CHECK ("webhook_status"."firm_id" = (select app_current_firm_id()));