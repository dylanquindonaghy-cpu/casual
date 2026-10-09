-- Phase 10 task 13 (audit M24): the messages purge follows the firm's own retention settings
-- (firms.settings.retention: message_days, default 90, kept between 30 and 2190; hold_until, a date
-- until which nothing is purged), read here so no caller can shorten them (the app role can't
-- change firms), and keeps a reply newer than the cut-off (unlinked from the old message it
-- answered). The same reading as src/lib/gdpr/retention-settings.ts.
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
    RETURN v_count;
  END
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_purge_old_messages() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_purge_old_messages() TO shiftdesk_app;
