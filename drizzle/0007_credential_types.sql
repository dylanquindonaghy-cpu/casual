CREATE TABLE "credential_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sector" text NOT NULL,
	"applied_allowed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credential_types_firm_id_code_key" UNIQUE("firm_id","code"),
	CONSTRAINT "credential_types_code_format" CHECK ("credential_types"."code" ~ '^[A-Z][A-Z0-9_]*$'),
	CONSTRAINT "credential_types_name_length" CHECK ("credential_types"."name" = btrim("credential_types"."name") and length("credential_types"."name") between 1 and 100),
	CONSTRAINT "credential_types_sector_check" CHECK ("credential_types"."sector" in ('security', 'rail', 'construction', 'cleaning', 'any'))
);
--> statement-breakpoint
ALTER TABLE "credential_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credential_types" ADD CONSTRAINT "credential_types_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "credential_types" AS PERMISSIVE FOR ALL TO public USING ("credential_types"."firm_id" = (select app_current_firm_id())) WITH CHECK ("credential_types"."firm_id" = (select app_current_firm_id()));