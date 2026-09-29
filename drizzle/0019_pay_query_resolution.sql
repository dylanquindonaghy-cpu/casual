ALTER TABLE "pay_queries" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "pay_queries" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pay_queries" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "pay_queries" ADD CONSTRAINT "pay_queries_resolved_by_fk" FOREIGN KEY ("firm_id","resolved_by") REFERENCES "public"."office_users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_queries" ADD CONSTRAINT "pay_queries_resolution" CHECK ("pay_queries"."status" = 'resolved'
        or ("pay_queries"."resolved_at" is null and "pay_queries"."resolved_by" is null and "pay_queries"."resolution_note" is null));--> statement-breakpoint
ALTER TABLE "pay_queries" ADD CONSTRAINT "pay_queries_resolution_note_length" CHECK ("pay_queries"."resolution_note" is null or char_length("pay_queries"."resolution_note") between 1 and 500);