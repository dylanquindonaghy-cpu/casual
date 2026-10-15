CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"label" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"hint" text NOT NULL,
	"created_by" uuid NOT NULL,
	"revoked_by" uuid,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "api_keys_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "api_keys_label_length" CHECK (char_length("api_keys"."label") between 1 and 60 and "api_keys"."label" = btrim("api_keys"."label")),
	CONSTRAINT "api_keys_hint_format" CHECK ("api_keys"."hint" ~ '^[A-Za-z0-9_-]{4}$'),
	CONSTRAINT "api_keys_token_hash_length" CHECK (octet_length("api_keys"."token_hash") = 32),
	CONSTRAINT "api_keys_revoked_together" CHECK (("api_keys"."revoked_at" is null) = ("api_keys"."revoked_by" is null))
);
--> statement-breakpoint
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assignments" DROP CONSTRAINT "assignments_cancel_via_check";--> statement-breakpoint
ALTER TABLE "shift_events" DROP CONSTRAINT "shift_events_source_check";--> statement-breakpoint
ALTER TABLE "shifts" DROP CONSTRAINT "shifts_source_check";--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_fk" FOREIGN KEY ("firm_id","created_by") REFERENCES "public"."office_users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_revoked_by_fk" FOREIGN KEY ("firm_id","revoked_by") REFERENCES "public"."office_users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_events" ADD CONSTRAINT "shift_events_firm_id_source_planner_ref_key" UNIQUE("firm_id","source","planner_ref");--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_cancel_via_check" CHECK ("assignments"."cancel_via" is null or "assignments"."cancel_via" in ('app', 'office', 'sheet', 'import', 'api'));--> statement-breakpoint
ALTER TABLE "shift_events" ADD CONSTRAINT "shift_events_source_check" CHECK ("shift_events"."source" in ('native', 'sheets', 'csv', 'api'));--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_source_check" CHECK ("shifts"."source" in ('native', 'sheets', 'csv', 'api'));--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "api_keys" AS PERMISSIVE FOR ALL TO public USING ("api_keys"."firm_id" = (select app_current_firm_id())) WITH CHECK ("api_keys"."firm_id" = (select app_current_firm_id()));--> statement-breakpoint
CREATE POLICY "key_lookup" ON "api_keys" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
-- The planner API's key look-up (S11, 12J.1; ADR-022): the third look-up allowed before a firm is
-- known, beside app_resolve_firm() (host) and app_firm_by_line() (shifts line). It returns only the
-- firm id and key id of a key that isn't revoked; the call then runs inside withFirm(). Owner-run,
-- with search_path pinned, and executable only by the app role.
CREATE FUNCTION app_api_key_lookup(p_hash bytea)
  RETURNS TABLE (firm_id uuid, key_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT k.firm_id, k.id
    FROM public.api_keys AS k
    WHERE k.token_hash = p_hash AND k.revoked_at IS NULL
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_api_key_lookup(bytea) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_api_key_lookup(bytea) TO shiftdesk_app;
