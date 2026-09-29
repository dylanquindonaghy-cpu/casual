CREATE TABLE "pay_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"shift_id" uuid,
	"work_date" date NOT NULL,
	"issue_type" text NOT NULL,
	"details" text,
	"group_key" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_queries_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "pay_queries_issue_type_check" CHECK ("pay_queries"."issue_type" in ('missing_hours', 'wrong_rate', 'late_pay', 'other')),
	CONSTRAINT "pay_queries_status_check" CHECK ("pay_queries"."status" in ('open', 'in_digest', 'resolved')),
	CONSTRAINT "pay_queries_details_length" CHECK ("pay_queries"."details" is null or char_length("pay_queries"."details") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "pay_queries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pay_queries" ADD CONSTRAINT "pay_queries_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_queries" ADD CONSTRAINT "pay_queries_worker_fk" FOREIGN KEY ("firm_id","worker_id") REFERENCES "public"."workers"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_queries" ADD CONSTRAINT "pay_queries_shift_fk" FOREIGN KEY ("firm_id","shift_id") REFERENCES "public"."shifts"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_queries_firm_id_status_idx" ON "pay_queries" USING btree ("firm_id","status");--> statement-breakpoint
CREATE INDEX "pay_queries_firm_id_worker_id_idx" ON "pay_queries" USING btree ("firm_id","worker_id");--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "pay_queries" AS PERMISSIVE FOR ALL TO public USING ("pay_queries"."firm_id" = (select app_current_firm_id())) WITH CHECK ("pay_queries"."firm_id" = (select app_current_firm_id()));