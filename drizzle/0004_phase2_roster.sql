CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"slot" integer NOT NULL,
	"worker_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"offered_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"notice_hours" numeric(8, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "assignments_status_check" CHECK ("assignments"."status" in ('open', 'offered', 'confirmed', 'cancelled_worker', 'cancelled_firm', 'no_show', 'completed')),
	CONSTRAINT "assignments_slot_positive" CHECK ("assignments"."slot" >= 1),
	CONSTRAINT "assignments_worker_matches_status" CHECK (("assignments"."status" = 'open') = ("assignments"."worker_id" is null)),
	CONSTRAINT "assignments_offered_at_set" CHECK ("assignments"."status" <> 'offered' or "assignments"."offered_at" is not null),
	CONSTRAINT "assignments_confirmed_at_set" CHECK ("assignments"."status" not in ('confirmed', 'no_show', 'completed') or "assignments"."confirmed_at" is not null),
	CONSTRAINT "assignments_cancel_evidence" CHECK ("assignments"."status" not in ('cancelled_worker', 'cancelled_firm')
        or ("assignments"."cancelled_at" is not null and "assignments"."notice_hours" is not null
            and "assignments"."cancel_reason" is not null and length(btrim("assignments"."cancel_reason")) > 0))
);
--> statement-breakpoint
ALTER TABLE "assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "credential_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"sector" text NOT NULL,
	"role" text NOT NULL,
	"required_types" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credential_rules_firm_id_role_key" UNIQUE("firm_id","role"),
	CONSTRAINT "credential_rules_sector_check" CHECK ("credential_rules"."sector" in ('security', 'rail', 'construction', 'cleaning')),
	CONSTRAINT "credential_rules_role_format" CHECK ("credential_rules"."role" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "credential_rules_required_types_format" CHECK (coalesce(array_ndims("credential_rules"."required_types"), 1) = 1
        and array_position("credential_rules"."required_types", null) is null
        and (cardinality("credential_rules"."required_types") = 0
          or (array_to_string("credential_rules"."required_types", ',') ~ '^[A-Z][A-Z0-9_]*(,[A-Z][A-Z0-9_]*)*$'
            and cardinality(string_to_array(array_to_string("credential_rules"."required_types", ','), ','))
              = cardinality("credential_rules"."required_types"))))
);
--> statement-breakpoint
ALTER TABLE "credential_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"wave" integer NOT NULL,
	"channel" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"response" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "offers_firm_id_shift_id_worker_id_wave_key" UNIQUE("firm_id","shift_id","worker_id","wave"),
	CONSTRAINT "offers_wave_positive" CHECK ("offers"."wave" >= 1),
	CONSTRAINT "offers_channel_check" CHECK ("offers"."channel" in ('push', 'whatsapp', 'sms')),
	CONSTRAINT "offers_response_check" CHECK ("offers"."response" in ('accepted', 'declined', 'expired', 'filled_elsewhere')),
	CONSTRAINT "offers_response_has_time" CHECK (("offers"."response" is null) = ("offers"."responded_at" is null))
);
--> statement-breakpoint
ALTER TABLE "offers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"shift_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "requests_type_check" CHECK ("requests"."type" in ('time_change', 'swap', 'availability', 'general')),
	CONSTRAINT "requests_status_check" CHECK ("requests"."status" in ('open', 'approved', 'declined', 'auto_resolved', 'escalated')),
	CONSTRAINT "requests_shift_required" CHECK ("requests"."type" not in ('time_change', 'swap') or "requests"."shift_id" is not null),
	CONSTRAINT "requests_payload_object" CHECK (jsonb_typeof("requests"."payload") = 'object'),
	CONSTRAINT "requests_resolution" CHECK (("requests"."status" in ('open', 'escalated') and "requests"."resolved_at" is null and "requests"."resolved_by" is null)
        or ("requests"."status" = 'auto_resolved' and "requests"."resolved_at" is not null)
        or ("requests"."status" in ('approved', 'declined') and "requests"."resolved_at" is not null and "requests"."resolved_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"site_id" uuid,
	"role" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"headcount" integer DEFAULT 1 NOT NULL,
	"is_urgent" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"source" text DEFAULT 'native' NOT NULL,
	"external_ref" text,
	"instructions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shifts_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "shifts_firm_id_source_external_ref_key" UNIQUE("firm_id","source","external_ref"),
	CONSTRAINT "shifts_role_format" CHECK ("shifts"."role" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "shifts_ends_after_start" CHECK ("shifts"."ends_at" > "shifts"."starts_at"),
	CONSTRAINT "shifts_headcount_range" CHECK ("shifts"."headcount" between 1 and 1000),
	CONSTRAINT "shifts_status_check" CHECK ("shifts"."status" in ('draft', 'open', 'filled', 'cancelled')),
	CONSTRAINT "shifts_source_check" CHECK ("shifts"."source" in ('native', 'sheets', 'csv'))
);
--> statement-breakpoint
ALTER TABLE "shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "otp_codes_one_live_per_session";--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_shift_fk" FOREIGN KEY ("firm_id","shift_id") REFERENCES "public"."shifts"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_worker_fk" FOREIGN KEY ("firm_id","worker_id") REFERENCES "public"."workers"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_rules" ADD CONSTRAINT "credential_rules_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_shift_fk" FOREIGN KEY ("firm_id","shift_id") REFERENCES "public"."shifts"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_worker_fk" FOREIGN KEY ("firm_id","worker_id") REFERENCES "public"."workers"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_worker_fk" FOREIGN KEY ("firm_id","worker_id") REFERENCES "public"."workers"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_shift_fk" FOREIGN KEY ("firm_id","shift_id") REFERENCES "public"."shifts"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_resolved_by_fk" FOREIGN KEY ("firm_id","resolved_by") REFERENCES "public"."office_users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_site_fk" FOREIGN KEY ("firm_id","site_id") REFERENCES "public"."sites"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_one_live_per_slot" ON "assignments" USING btree ("firm_id","shift_id","slot") WHERE status not in ('cancelled_worker', 'cancelled_firm');--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_one_live_per_worker" ON "assignments" USING btree ("firm_id","shift_id","worker_id") WHERE worker_id is not null and status not in ('cancelled_worker', 'cancelled_firm');--> statement-breakpoint
CREATE INDEX "assignments_firm_id_worker_id_idx" ON "assignments" USING btree ("firm_id","worker_id");--> statement-breakpoint
CREATE INDEX "offers_firm_id_worker_id_sent_at_idx" ON "offers" USING btree ("firm_id","worker_id","sent_at");--> statement-breakpoint
CREATE INDEX "requests_firm_id_status_idx" ON "requests" USING btree ("firm_id","status");--> statement-breakpoint
CREATE INDEX "shifts_firm_id_starts_at_idx" ON "shifts" USING btree ("firm_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "otp_codes_one_live_per_session" ON "otp_codes" USING btree ("firm_id","session_id") WHERE consumed_at is null;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "assignments" AS PERMISSIVE FOR ALL TO public USING ("assignments"."firm_id" = (select app_current_firm_id())) WITH CHECK ("assignments"."firm_id" = (select app_current_firm_id()));--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "credential_rules" AS PERMISSIVE FOR ALL TO public USING ("credential_rules"."firm_id" = (select app_current_firm_id())) WITH CHECK ("credential_rules"."firm_id" = (select app_current_firm_id()));--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "offers" AS PERMISSIVE FOR ALL TO public USING ("offers"."firm_id" = (select app_current_firm_id())) WITH CHECK ("offers"."firm_id" = (select app_current_firm_id()));--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "requests" AS PERMISSIVE FOR ALL TO public USING ("requests"."firm_id" = (select app_current_firm_id())) WITH CHECK ("requests"."firm_id" = (select app_current_firm_id()));--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "shifts" AS PERMISSIVE FOR ALL TO public USING ("shifts"."firm_id" = (select app_current_firm_id())) WITH CHECK ("shifts"."firm_id" = (select app_current_firm_id()));