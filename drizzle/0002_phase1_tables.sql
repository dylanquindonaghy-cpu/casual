CREATE TABLE "auth_throttle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_throttle_bucket_window_key" UNIQUE("firm_id","bucket","window_start")
);
--> statement-breakpoint
ALTER TABLE "auth_throttle" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "magic_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"worker_id" uuid,
	"office_user_id" uuid,
	"token_hash" "bytea" NOT NULL,
	"request_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "magic_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "magic_links_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "magic_links_kind_check" CHECK ("magic_links"."kind" in ('worker', 'office')),
	CONSTRAINT "magic_links_subject_check" CHECK (("magic_links"."kind" = 'worker' and "magic_links"."worker_id" is not null and "magic_links"."office_user_id" is null)
     or ("magic_links"."kind" = 'office' and "magic_links"."office_user_id" is not null and "magic_links"."worker_id" is null))
);
--> statement-breakpoint
ALTER TABLE "magic_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_codes_attempts_range" CHECK ("otp_codes"."attempts" between 0 and 5)
);
--> statement-breakpoint
ALTER TABLE "otp_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"worker_id" uuid,
	"office_user_id" uuid,
	"token_hash" "bytea" NOT NULL,
	"prev_token_hash" "bytea",
	"prev_valid_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"stepped_up_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sessions_prev_token_hash_unique" UNIQUE("prev_token_hash"),
	CONSTRAINT "sessions_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "sessions_kind_check" CHECK ("sessions"."kind" in ('worker', 'office')),
	CONSTRAINT "sessions_subject_check" CHECK (("sessions"."kind" = 'worker' and "sessions"."worker_id" is not null and "sessions"."office_user_id" is null)
     or ("sessions"."kind" = 'office' and "sessions"."office_user_id" is not null and "sessions"."worker_id" is null))
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"firm_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_actor_type_check" CHECK ("events"."actor_type" in ('worker', 'office', 'system', 'ai')),
	CONSTRAINT "events_action_format" CHECK ("events"."action" ~ '^[a-z_]+([.][a-z_]+)+$')
);
--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"type" text NOT NULL,
	"number" text,
	"expires_on" date,
	"status" text DEFAULT 'valid' NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_type_format" CHECK ("credentials"."type" ~ '^[A-Z][A-Z0-9_]*$'),
	CONSTRAINT "credentials_status_check" CHECK ("credentials"."status" in ('valid', 'expired', 'applied', 'suspended'))
);
--> statement-breakpoint
ALTER TABLE "credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "office_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_users_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "office_users_firm_id_email_key" UNIQUE("firm_id","email"),
	CONSTRAINT "office_users_email_lower" CHECK ("office_users"."email" = lower("office_users"."email") and "office_users"."email" ~ '^[^@ ]+@[^@ ]+$'),
	CONSTRAINT "office_users_role_check" CHECK ("office_users"."role" in ('admin', 'resourcer', 'payroll')),
	CONSTRAINT "office_users_status_check" CHECK ("office_users"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "office_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"mobile_e164" text NOT NULL,
	"email" text,
	"status" text DEFAULT 'active' NOT NULL,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workers_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "workers_firm_id_mobile_key" UNIQUE("firm_id","mobile_e164"),
	CONSTRAINT "workers_mobile_e164_check" CHECK ("workers"."mobile_e164" ~ '^[+][1-9][0-9]{6,14}$'),
	CONSTRAINT "workers_status_check" CHECK ("workers"."status" in ('active', 'inactive', 'blocked'))
);
--> statement-breakpoint
ALTER TABLE "workers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "firms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sector" text NOT NULL,
	"custom_domain" text,
	"domain_verified" boolean DEFAULT false NOT NULL,
	"brand_logo_url" text,
	"brand_primary_color" text,
	"timezone" text DEFAULT 'Europe/London' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "firms_slug_unique" UNIQUE("slug"),
	CONSTRAINT "firms_custom_domain_unique" UNIQUE("custom_domain"),
	CONSTRAINT "firms_slug_format" CHECK ("firms"."slug" ~ '^[a-z0-9][a-z0-9-]{0,18}[a-z0-9]$'),
	CONSTRAINT "firms_slug_not_reserved" CHECK ("firms"."slug" not in ('www', 'portal', 'api', 'app', 'admin') and "firms"."slug" !~ '^xn-{2}'),
	CONSTRAINT "firms_sector_check" CHECK ("firms"."sector" in ('security', 'rail', 'construction', 'cleaning')),
	CONSTRAINT "firms_brand_color_hex" CHECK ("firms"."brand_primary_color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "firms_brand_logo_https" CHECK ("firms"."brand_logo_url" like 'https://%')
);
--> statement-breakpoint
ALTER TABLE "firms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address_line1" text,
	"address_line2" text,
	"town" text,
	"postcode" text,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "sites_firm_id_name_key" UNIQUE("firm_id","name")
);
--> statement-breakpoint
ALTER TABLE "sites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_throttle" ADD CONSTRAINT "auth_throttle_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_worker_fk" FOREIGN KEY ("firm_id","worker_id") REFERENCES "public"."workers"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_office_user_fk" FOREIGN KEY ("firm_id","office_user_id") REFERENCES "public"."office_users"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_session_fk" FOREIGN KEY ("firm_id","session_id") REFERENCES "public"."sessions"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_worker_fk" FOREIGN KEY ("firm_id","worker_id") REFERENCES "public"."workers"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_office_user_fk" FOREIGN KEY ("firm_id","office_user_id") REFERENCES "public"."office_users"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_worker_fk" FOREIGN KEY ("firm_id","worker_id") REFERENCES "public"."workers"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_verified_by_fk" FOREIGN KEY ("firm_id","verified_by") REFERENCES "public"."office_users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_users" ADD CONSTRAINT "office_users_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "otp_codes_one_live_per_session" ON "otp_codes" USING btree ("session_id") WHERE consumed_at is null;--> statement-breakpoint
CREATE INDEX "events_firm_id_created_at_idx" ON "events" USING btree ("firm_id","created_at");--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "auth_throttle" AS PERMISSIVE FOR ALL TO public USING ("auth_throttle"."firm_id" = (select app_current_firm_id())) WITH CHECK ("auth_throttle"."firm_id" = (select app_current_firm_id()));--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "magic_links" AS PERMISSIVE FOR ALL TO public USING ("magic_links"."firm_id" = (select app_current_firm_id())) WITH CHECK ("magic_links"."firm_id" = (select app_current_firm_id()));--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "otp_codes" AS PERMISSIVE FOR ALL TO public USING ("otp_codes"."firm_id" = (select app_current_firm_id())) WITH CHECK ("otp_codes"."firm_id" = (select app_current_firm_id()));--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "sessions" AS PERMISSIVE FOR ALL TO public USING ("sessions"."firm_id" = (select app_current_firm_id())) WITH CHECK ("sessions"."firm_id" = (select app_current_firm_id()));--> statement-breakpoint
CREATE POLICY "firm_isolation_select" ON "events" AS PERMISSIVE FOR SELECT TO public USING ("events"."firm_id" = (select app_current_firm_id()));--> statement-breakpoint
CREATE POLICY "firm_isolation_insert" ON "events" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("events"."firm_id" = (select app_current_firm_id()));--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "credentials" AS PERMISSIVE FOR ALL TO public USING ("credentials"."firm_id" = (select app_current_firm_id())) WITH CHECK ("credentials"."firm_id" = (select app_current_firm_id()));--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "office_users" AS PERMISSIVE FOR ALL TO public USING ("office_users"."firm_id" = (select app_current_firm_id())) WITH CHECK ("office_users"."firm_id" = (select app_current_firm_id()));--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "workers" AS PERMISSIVE FOR ALL TO public USING ("workers"."firm_id" = (select app_current_firm_id())) WITH CHECK ("workers"."firm_id" = (select app_current_firm_id()));--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "firms" AS PERMISSIVE FOR ALL TO public USING ("firms"."id" = (select app_current_firm_id())) WITH CHECK ("firms"."id" = (select app_current_firm_id()));--> statement-breakpoint
CREATE POLICY "directory_read" ON "firms" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "sites" AS PERMISSIVE FOR ALL TO public USING ("sites"."firm_id" = (select app_current_firm_id())) WITH CHECK ("sites"."firm_id" = (select app_current_firm_id()));