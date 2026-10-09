CREATE TABLE "pay_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"rate_pence" integer NOT NULL,
	"gross_pence" integer,
	"pay_date" date,
	"source" text DEFAULT 'import' NOT NULL,
	"updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_records_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "pay_records_firm_id_line_key" UNIQUE("firm_id","worker_id","period_start","period_end","rate_pence"),
	CONSTRAINT "pay_records_period_order" CHECK ("pay_records"."period_end" >= "pay_records"."period_start"),
	CONSTRAINT "pay_records_hours_range" CHECK ("pay_records"."hours" >= 0 and "pay_records"."hours" <= 1000),
	CONSTRAINT "pay_records_rate_nonnegative" CHECK ("pay_records"."rate_pence" >= 0),
	CONSTRAINT "pay_records_gross_nonnegative" CHECK ("pay_records"."gross_pence" >= 0),
	CONSTRAINT "pay_records_source_check" CHECK ("pay_records"."source" in ('import'))
);
--> statement-breakpoint
ALTER TABLE "pay_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pay_records" ADD CONSTRAINT "pay_records_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_records" ADD CONSTRAINT "pay_records_worker_fk" FOREIGN KEY ("firm_id","worker_id") REFERENCES "public"."workers"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_records_firm_id_worker_id_period_end_idx" ON "pay_records" USING btree ("firm_id","worker_id","period_end");--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "pay_records" AS PERMISSIVE FOR ALL TO public USING ("pay_records"."firm_id" = (select app_current_firm_id())) WITH CHECK ("pay_records"."firm_id" = (select app_current_firm_id()));