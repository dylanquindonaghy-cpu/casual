-- P5.3: a connector's webhooks in. connector_events holds what a source said changed (one row per
-- event id per source; src/lib/db/schema/connector.ts). app_connector_source_firm() finds the firm of
-- a connector source that's switched on, for the webhook, which names the source in its address and
-- runs before a firm is known (like app_firm_by_line(), 0021): only once its signature has passed
-- (src/lib/connector/webhook.ts). Runs as the table owner, which reads every firm's sources
-- through the owner-only source_lookup policy (as api_keys' key_lookup), and returns the firm's id
-- alone. Static SQL only, pinned search_path, qualified names.
CREATE TABLE "connector_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"ref" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"outcome_code" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_events_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "connector_events_event_key" UNIQUE("firm_id","source_id","event_id"),
	CONSTRAINT "connector_events_event_id_format" CHECK ("connector_events"."event_id" ~ '^[A-Za-z0-9]([A-Za-z0-9._:-]{0,98}[A-Za-z0-9])?$'),
	CONSTRAINT "connector_events_ref_format" CHECK ("connector_events"."ref" ~ '^[A-Za-z0-9]([A-Za-z0-9._:-]{0,198}[A-Za-z0-9])?$'),
	CONSTRAINT "connector_events_status_check" CHECK ("connector_events"."status" in ('queued', 'applied', 'refused', 'ignored', 'failed')),
	CONSTRAINT "connector_events_type_check" CHECK ("connector_events"."type" in ('session.changed', 'staff.changed')),
	CONSTRAINT "connector_events_outcome_format" CHECK ("connector_events"."outcome_code" ~ '^[a-z0-9_]{1,50}$'),
	CONSTRAINT "connector_events_outcome_when" CHECK (("connector_events"."status" = 'queued') = ("connector_events"."processed_at" is null and "connector_events"."outcome_code" is null))
);
--> statement-breakpoint
ALTER TABLE "connector_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connector_events" ADD CONSTRAINT "connector_events_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_events" ADD CONSTRAINT "connector_events_source_fk" FOREIGN KEY ("firm_id","source_id") REFERENCES "public"."roster_sources"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connector_events_source_created_idx" ON "connector_events" USING btree ("firm_id","source_id","created_at");--> statement-breakpoint
CREATE POLICY "source_lookup" ON "roster_sources" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "connector_events" AS PERMISSIVE FOR ALL TO public USING ("connector_events"."firm_id" = (select app_current_firm_id())) WITH CHECK ("connector_events"."firm_id" = (select app_current_firm_id()));
--> statement-breakpoint
CREATE FUNCTION app_connector_source_firm(p_source uuid)
  RETURNS TABLE (firm_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT s.firm_id
    FROM public.roster_sources AS s
    WHERE s.id = p_source AND s.kind = 'connector' AND s.enabled
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_connector_source_firm(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_connector_source_firm(uuid) TO shiftdesk_app;
--> statement-breakpoint
-- GDPR erasure (0026), now also forgetting a connector's events about the worker (P5.3's review):
-- their staff ref is cleared from the worker's row, so the staff.changed rows naming it go too.
-- The rest as before: static SQL only, pinned search_path, qualified names.
CREATE OR REPLACE FUNCTION app_erase_worker(p_worker uuid)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_firm uuid := public.app_current_firm_id();
    v_mobile text;
    v_ref text;
    v_count integer;
  BEGIN
    IF v_firm IS NULL THEN
      RAISE EXCEPTION 'app_erase_worker needs a firm';
    END IF;
    SELECT w.mobile_e164, w.external_ref INTO v_mobile, v_ref FROM public.workers AS w
     WHERE w.firm_id = v_firm AND w.id = p_worker AND w.erased_at IS NULL
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no worker to erase';
    END IF;
    UPDATE public.workers AS w
       SET first_name = 'Deleted', last_name = 'worker', mobile_e164 = NULL, email = NULL,
           external_ref = NULL, roles = '{}', status = 'inactive', offer_alerts = false,
           sms_opted_out_at = NULL, erased_at = now()
     WHERE w.firm_id = v_firm AND w.id = p_worker;
    IF v_ref IS NOT NULL THEN
      DELETE FROM public.connector_events AS c
       WHERE c.firm_id = v_firm AND c.type = 'staff.changed' AND c.ref = v_ref;
    END IF;
    WITH theirs AS (
      SELECT m.id FROM public.messages AS m
       WHERE m.firm_id = v_firm
         AND (m.worker_id = p_worker
              OR (m.worker_id IS NULL
                  AND ((m.direction = 'in' AND m.from_e164 = v_mobile)
                       OR (m.direction = 'out' AND m.to_e164 = v_mobile))))
    )
    DELETE FROM public.messages AS m
     WHERE m.firm_id = v_firm
       AND (m.id IN (SELECT t.id FROM theirs AS t) OR m.reply_to IN (SELECT t.id FROM theirs AS t));
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
  END
  $$;
