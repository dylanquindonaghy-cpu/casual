ALTER TABLE "messages" DROP CONSTRAINT "messages_channel_check";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_from_e164";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_to_e164";--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "to_e164" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "messages_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_app_worker" CHECK ("messages"."channel" <> 'app' or "messages"."worker_id" is not null);--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_check" CHECK ("messages"."channel" in ('whatsapp', 'sms', 'voice', 'app'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_from_e164" CHECK (("messages"."channel" = 'app' and "messages"."from_e164" is null)
        or ("messages"."channel" <> 'app'
            and (("messages"."from_e164" is not null and "messages"."from_e164" ~ '^[+][1-9][0-9]{6,14}$')
                 or ("messages"."from_e164" is null and "messages"."channel" = 'voice' and "messages"."direction" = 'in'))));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_to_e164" CHECK (("messages"."channel" = 'app' and "messages"."to_e164" is null)
        or ("messages"."channel" <> 'app' and "messages"."to_e164" is not null
            and "messages"."to_e164" ~ '^[+][1-9][0-9]{6,14}$'));--> statement-breakpoint
-- A worker's erasure clears when they last saw the office's replies in the app too (Phase 25.6).
-- Their messages in the app always carry their worker id, so the delete below already takes them.
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
           sms_opted_out_at = NULL, messages_read_at = NULL, erased_at = now()
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
