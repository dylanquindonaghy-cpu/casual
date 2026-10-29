-- P3.2: a firm's name map ("Connecting the firm's systems" 2): what its own system calls a role, a
-- qualification, a staff type or a cancellation reason, mapped to a ShiftDesk code or to skip
-- (code null). Set only by the owner (npm run firm:names); the app may only read it
-- (src/lib/db/admin/access.ts). outside_name is held as src/lib/roster/names.ts keys it.
CREATE TABLE "name_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"outside_name" text NOT NULL,
	"code" text,
	"pay_rate_pence" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "name_map_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "name_map_name_key" UNIQUE("firm_id","kind","outside_name"),
	CONSTRAINT "name_map_kind_check" CHECK ("name_map"."kind" in ('role', 'qualification', 'staff_type', 'cancellation_reason')),
	CONSTRAINT "name_map_outside_name_format" CHECK (char_length("name_map"."outside_name") between 1 and 200
          and "name_map"."outside_name" = lower("name_map"."outside_name")
          and "name_map"."outside_name" !~ '^ | $|  |[[:cntrl:]]'),
	CONSTRAINT "name_map_code_format" CHECK ("name_map"."code" is null or (case when "name_map"."kind" = 'role' then "name_map"."code" ~ '^[a-z][a-z0-9_]*$'
          else "name_map"."code" ~ '^[A-Za-z][A-Za-z0-9_]{0,49}$' end)),
	CONSTRAINT "name_map_pay_rate_role_only" CHECK ("name_map"."pay_rate_pence" is null
          or ("name_map"."kind" = 'role' and "name_map"."code" is not null and "name_map"."pay_rate_pence" between 0 and 100000))
);
--> statement-breakpoint
ALTER TABLE "name_map" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "name_map" ADD CONSTRAINT "name_map_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "name_map" AS PERMISSIVE FOR ALL TO public USING ("name_map"."firm_id" = (select app_current_firm_id())) WITH CHECK ("name_map"."firm_id" = (select app_current_firm_id()));