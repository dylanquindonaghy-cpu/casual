CREATE TABLE "office_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"office_user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_push_subscriptions_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "office_push_subscriptions_firm_id_endpoint_key" UNIQUE("firm_id","endpoint"),
	CONSTRAINT "office_push_subscriptions_endpoint_https" CHECK ("office_push_subscriptions"."endpoint" like 'https://%' and length("office_push_subscriptions"."endpoint") <= 2048)
);
--> statement-breakpoint
ALTER TABLE "office_push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "office_users" ADD COLUMN "tell_me" text[];--> statement-breakpoint
ALTER TABLE "office_push_subscriptions" ADD CONSTRAINT "office_push_subscriptions_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_push_subscriptions" ADD CONSTRAINT "office_push_subscriptions_office_user_fk" FOREIGN KEY ("firm_id","office_user_id") REFERENCES "public"."office_users"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "office_push_subscriptions_firm_id_office_user_id_idx" ON "office_push_subscriptions" USING btree ("firm_id","office_user_id");--> statement-breakpoint
ALTER TABLE "office_users" ADD CONSTRAINT "office_users_tell_me_check" CHECK ("office_users"."tell_me" is null or "office_users"."tell_me" <@ array['popup', 'cancel_push', 'open_push', 'uploads', 'summary']::text[]);--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "office_push_subscriptions" AS PERMISSIVE FOR ALL TO public USING ("office_push_subscriptions"."firm_id" = (select app_current_firm_id())) WITH CHECK ("office_push_subscriptions"."firm_id" = (select app_current_firm_id()));