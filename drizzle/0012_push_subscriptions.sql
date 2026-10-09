CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "push_subscriptions_firm_id_endpoint_key" UNIQUE("firm_id","endpoint"),
	CONSTRAINT "push_subscriptions_endpoint_https" CHECK ("push_subscriptions"."endpoint" like 'https://%' and length("push_subscriptions"."endpoint") <= 2048)
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_worker_fk" FOREIGN KEY ("firm_id","worker_id") REFERENCES "public"."workers"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "push_subscriptions" AS PERMISSIVE FOR ALL TO public USING ("push_subscriptions"."firm_id" = (select app_current_firm_id())) WITH CHECK ("push_subscriptions"."firm_id" = (select app_current_firm_id()));