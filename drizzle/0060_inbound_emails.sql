CREATE TABLE "inbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"provider_message_id" text NOT NULL,
	"worker_id" uuid,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"subject" text,
	"body" text,
	"attachments" integer DEFAULT 0 NOT NULL,
	"handled_as" text,
	"intent" text,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_emails_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "inbound_emails_firm_id_provider_message_id_key" UNIQUE("firm_id","provider_message_id"),
	CONSTRAINT "inbound_emails_message_id_format" CHECK ("inbound_emails"."provider_message_id" ~ '^[!-~]{1,250}$'),
	CONSTRAINT "inbound_emails_from_format" CHECK ("inbound_emails"."from_address" ~ '^[a-z0-9.!#$%&*+/=?^_`{|}~-]{1,64}@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' and char_length("inbound_emails"."from_address") <= 254),
	CONSTRAINT "inbound_emails_to_format" CHECK ("inbound_emails"."to_address" ~ '^[a-z0-9.!#$%&*+/=?^_`{|}~-]{1,64}@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' and char_length("inbound_emails"."to_address") <= 254),
	CONSTRAINT "inbound_emails_words_known_only" CHECK ("inbound_emails"."worker_id" is not null or ("inbound_emails"."subject" is null and "inbound_emails"."body" is null)),
	CONSTRAINT "inbound_emails_subject_length" CHECK (char_length("inbound_emails"."subject") <= 300),
	CONSTRAINT "inbound_emails_body_length" CHECK (char_length("inbound_emails"."body") <= 4000),
	CONSTRAINT "inbound_emails_attachments_range" CHECK ("inbound_emails"."attachments" between 0 and 1000),
	CONSTRAINT "inbound_emails_handled_as_check" CHECK ("inbound_emails"."handled_as" in ('keyword', 'ai', 'office', 'unknown', 'opt_out')),
	CONSTRAINT "inbound_emails_intent_check" CHECK ("inbound_emails"."intent" in ('shifts', 'cancel', 'pay', 'office')),
	CONSTRAINT "inbound_emails_handled_when" CHECK (("inbound_emails"."handled_at" is null) = ("inbound_emails"."handled_as" is null))
);
--> statement-breakpoint
ALTER TABLE "inbound_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "inbox_address" text;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_worker_fk" FOREIGN KEY ("firm_id","worker_id") REFERENCES "public"."workers"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbound_emails_firm_id_created_at_idx" ON "inbound_emails" USING btree ("firm_id","created_at");--> statement-breakpoint
CREATE INDEX "inbound_emails_firm_id_worker_id_idx" ON "inbound_emails" USING btree ("firm_id","worker_id");--> statement-breakpoint
CREATE INDEX "inbound_emails_firm_id_from_address_idx" ON "inbound_emails" USING btree ("firm_id","from_address");--> statement-breakpoint
ALTER TABLE "firms" ADD CONSTRAINT "firms_inbox_address_unique" UNIQUE("inbox_address");--> statement-breakpoint
ALTER TABLE "firms" ADD CONSTRAINT "firms_inbox_address_format" CHECK ("firms"."inbox_address" ~ '^[a-z0-9.!#$%&*+/=?^_`{|}~-]{1,64}@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' and char_length("firms"."inbox_address") <= 254);--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "inbound_emails" AS PERMISSIVE FOR ALL TO public USING ("inbound_emails"."firm_id" = (select app_current_firm_id())) WITH CHECK ("inbound_emails"."firm_id" = (select app_current_firm_id()));--> statement-breakpoint
-- Incoming email -> firm (P7.1, the staffing inbox): as app_firm_by_line() (0021) for a number, the
-- one firm whose inbox is exactly that address (lower case), with the public directory fields only.
-- Run as the table owner, before a firm is known. Static SQL only, pinned search_path, qualified
-- names.
CREATE FUNCTION app_firm_by_inbox(p_address text)
  RETURNS TABLE (id uuid, slug text, name text, timezone text, sign_off text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT f.id, f.slug, f.name, f.timezone, f.settings ->> 'sign_off'
    FROM public.firms AS f
    WHERE f.inbox_address = p_address
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_firm_by_inbox(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_firm_by_inbox(text) TO shiftdesk_app;
--> statement-breakpoint
-- A worker's erasure takes their emails too (P7.1).
CREATE OR REPLACE FUNCTION app_erase_worker(p_worker uuid)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_firm uuid := public.app_current_firm_id();
    v_mobile text;
    v_ref text;
    v_email text;
    v_count integer;
  BEGIN
    IF v_firm IS NULL THEN
      RAISE EXCEPTION 'app_erase_worker needs a firm';
    END IF;
    SELECT w.mobile_e164, w.external_ref, lower(w.email) INTO v_mobile, v_ref, v_email
      FROM public.workers AS w
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
    -- Their emails to the staffing inbox (P7.1): set to them, and from their address before it
    -- was known. Not counted: the count is their shifts-line messages, as before.
    DELETE FROM public.inbound_emails AS e
     WHERE e.firm_id = v_firm
       AND (e.worker_id = p_worker OR (e.worker_id IS NULL AND e.from_address = v_email));
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
--> statement-breakpoint
-- The retention purge takes old emails too (P7.1).
CREATE OR REPLACE FUNCTION app_purge_old_messages()
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_firm uuid := public.app_current_firm_id();
    v_retention jsonb;
    v_days integer := 90;
    v_hold date;
    v_today date;
    v_cutoff timestamptz;
    v_count integer;
  BEGIN
    IF v_firm IS NULL THEN
      RAISE EXCEPTION 'app_purge_old_messages needs a firm';
    END IF;
    SELECT f.settings -> 'retention', (now() AT TIME ZONE f.timezone)::date
      INTO v_retention, v_today
      FROM public.firms AS f WHERE f.id = v_firm;
    -- Nested, so the cast only ever sees digits (AND's order isn't guaranteed).
    IF jsonb_typeof(v_retention -> 'message_days') = 'number'
       AND (v_retention ->> 'message_days') ~ '^[0-9]{1,4}$' THEN
      IF (v_retention ->> 'message_days')::integer BETWEEN 30 AND 2190 THEN
        v_days := (v_retention ->> 'message_days')::integer;
      END IF;
    END IF;
    IF jsonb_typeof(v_retention -> 'hold_until') = 'string'
       AND (v_retention ->> 'hold_until') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      BEGIN
        v_hold := (v_retention ->> 'hold_until')::date;
      EXCEPTION WHEN others THEN
        v_hold := NULL; -- not a real day: no hold, as the app reads it
      END;
      IF v_hold IS NOT NULL AND v_today <= v_hold THEN
        RETURN 0;
      END IF;
    END IF;
    v_cutoff := now() - make_interval(days => v_days);
    -- A reply newer than the cut-off stays: it no longer points at the old message that goes.
    UPDATE public.messages AS r
       SET reply_to = NULL
     WHERE r.firm_id = v_firm AND r.created_at >= v_cutoff
       AND r.reply_to IN (SELECT m.id FROM public.messages AS m
                           WHERE m.firm_id = v_firm AND m.created_at < v_cutoff);
    DELETE FROM public.messages AS m
     WHERE m.firm_id = v_firm AND m.created_at < v_cutoff;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    -- Emails to the staffing inbox (P7.1) go at the same age; the count stays the messages'.
    DELETE FROM public.inbound_emails AS e
     WHERE e.firm_id = v_firm AND e.created_at < v_cutoff;
    RETURN v_count;
  END
  $$;
