CREATE TABLE "session_asks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"status" text DEFAULT 'asked' NOT NULL,
	"asked_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_asks_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "session_asks_one_per_casual" UNIQUE("firm_id","shift_id","worker_id"),
	CONSTRAINT "session_asks_status_check" CHECK ("session_asks"."status" in ('asked', 'booked', 'not_this_time', 'closed')),
	CONSTRAINT "session_asks_answered" CHECK (("session_asks"."status" = 'asked') = ("session_asks"."answered_at" is null))
);
--> statement-breakpoint
ALTER TABLE "session_asks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_events" ADD COLUMN "casuals_ask" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "session_asks" ADD CONSTRAINT "session_asks_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_asks" ADD CONSTRAINT "session_asks_shift_fk" FOREIGN KEY ("firm_id","shift_id") REFERENCES "public"."shifts"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_asks" ADD CONSTRAINT "session_asks_worker_fk" FOREIGN KEY ("firm_id","worker_id") REFERENCES "public"."workers"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_asks_firm_id_worker_id_idx" ON "session_asks" USING btree ("firm_id","worker_id");--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "session_asks" AS PERMISSIVE FOR ALL TO public USING ("session_asks"."firm_id" = (select app_current_firm_id())) WITH CHECK ("session_asks"."firm_id" = (select app_current_firm_id()));