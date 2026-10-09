CREATE TABLE "metrics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"metric" text NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	"recorded_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metrics_daily_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "metrics_daily_one_key" UNIQUE("firm_id","kind","day","metric"),
	CONSTRAINT "metrics_daily_kind_check" CHECK ("metrics_daily"."kind" in ('baseline', 'tally', 'daily')),
	CONSTRAINT "metrics_daily_metric_check" CHECK ("metrics_daily"."metric" ~ '^[a-z][a-z_]{0,59}$'),
	CONSTRAINT "metrics_daily_value_check" CHECK ("metrics_daily"."value" >= 0),
	CONSTRAINT "metrics_daily_recorded_by" CHECK (("metrics_daily"."kind" = 'daily') = ("metrics_daily"."recorded_by" is null))
);
--> statement-breakpoint
ALTER TABLE "metrics_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "metrics_daily" ADD CONSTRAINT "metrics_daily_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_daily" ADD CONSTRAINT "metrics_daily_recorded_by_fk" FOREIGN KEY ("firm_id","recorded_by") REFERENCES "public"."office_users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "metrics_daily" AS PERMISSIVE FOR ALL TO public USING ("metrics_daily"."firm_id" = (select app_current_firm_id())) WITH CHECK ("metrics_daily"."firm_id" = (select app_current_firm_id()));