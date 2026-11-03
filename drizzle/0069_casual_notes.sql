CREATE TABLE "casual_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"office_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "casual_notes_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "casual_notes_body_length" CHECK (char_length("casual_notes"."body") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "casual_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "casual_notes" ADD CONSTRAINT "casual_notes_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casual_notes" ADD CONSTRAINT "casual_notes_worker_fk" FOREIGN KEY ("firm_id","worker_id") REFERENCES "public"."workers"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casual_notes" ADD CONSTRAINT "casual_notes_office_user_fk" FOREIGN KEY ("firm_id","office_user_id") REFERENCES "public"."office_users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "casual_notes_firm_id_worker_id_idx" ON "casual_notes" USING btree ("firm_id","worker_id","created_at");--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "casual_notes" AS PERMISSIVE FOR ALL TO public USING ("casual_notes"."firm_id" = (select app_current_firm_id())) WITH CHECK ("casual_notes"."firm_id" = (select app_current_firm_id()));