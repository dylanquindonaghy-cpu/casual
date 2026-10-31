CREATE TABLE "sheet_name_problems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"tab" text NOT NULL,
	"row" integer NOT NULL,
	"outside_name" text NOT NULL,
	"shift_id" uuid,
	"seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sheet_name_problems_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "sheet_name_problems_row_key" UNIQUE("firm_id","source_id","kind","tab","row"),
	CONSTRAINT "sheet_name_problems_kind_check" CHECK ("sheet_name_problems"."kind" in ('unreadable', 'skipped_live')),
	CONSTRAINT "sheet_name_problems_tab_check" CHECK ("sheet_name_problems"."tab" in ('staff', 'shifts')),
	CONSTRAINT "sheet_name_problems_row_check" CHECK ("sheet_name_problems"."row" between 2 and 10000000),
	CONSTRAINT "sheet_name_problems_name_format" CHECK (char_length("sheet_name_problems"."outside_name") between 1 and 200
          and "sheet_name_problems"."outside_name" !~ '[[:cntrl:]]'),
	CONSTRAINT "sheet_name_problems_shift_when" CHECK (case when "sheet_name_problems"."kind" = 'skipped_live'
            then "sheet_name_problems"."shift_id" is not null and "sheet_name_problems"."tab" = 'shifts'
            else "sheet_name_problems"."shift_id" is null end)
);
--> statement-breakpoint
ALTER TABLE "sheet_name_problems" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sheet_name_problems" ADD CONSTRAINT "sheet_name_problems_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_name_problems" ADD CONSTRAINT "sheet_name_problems_source_fk" FOREIGN KEY ("firm_id","source_id") REFERENCES "public"."roster_sources"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_name_problems" ADD CONSTRAINT "sheet_name_problems_shift_fk" FOREIGN KEY ("firm_id","shift_id") REFERENCES "public"."shifts"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "sheet_name_problems" AS PERMISSIVE FOR ALL TO public USING ("sheet_name_problems"."firm_id" = (select app_current_firm_id())) WITH CHECK ("sheet_name_problems"."firm_id" = (select app_current_firm_id()));