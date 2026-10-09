-- 12C.1, after its review: a strike row is deleted only when it was issued more than
-- strikes.keep_months ago AND it stopped counting more than 6 months ago (the tribunal time limit).
-- A firm whose strikes count a long time (strikes.live_days up to 365) with a short keep_months
-- (down to 7) would otherwise lose the record of a strike while it still counts, or soon after.
-- Otherwise as migration 0038: the firm's own settings, read here; nothing during a hold.
CREATE OR REPLACE FUNCTION app_purge_old_strikes()
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_firm uuid := public.app_current_firm_id();
    v_settings jsonb;
    v_months integer := 12;
    v_hold date;
    v_today date;
    v_count integer;
  BEGIN
    IF v_firm IS NULL THEN
      RAISE EXCEPTION 'app_purge_old_strikes needs a firm';
    END IF;
    SELECT f.settings, (now() AT TIME ZONE f.timezone)::date
      INTO v_settings, v_today
      FROM public.firms AS f WHERE f.id = v_firm;
    -- Nested, so the cast only ever sees digits (AND's order isn't guaranteed).
    IF jsonb_typeof(v_settings -> 'strikes' -> 'keep_months') = 'number'
       AND (v_settings -> 'strikes' ->> 'keep_months') ~ '^[0-9]{1,3}$' THEN
      IF (v_settings -> 'strikes' ->> 'keep_months')::integer BETWEEN 7 AND 72 THEN
        v_months := (v_settings -> 'strikes' ->> 'keep_months')::integer;
      END IF;
    END IF;
    IF jsonb_typeof(v_settings -> 'retention' -> 'hold_until') = 'string'
       AND (v_settings -> 'retention' ->> 'hold_until') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      BEGIN
        v_hold := (v_settings -> 'retention' ->> 'hold_until')::date;
      EXCEPTION WHEN others THEN
        v_hold := NULL; -- not a real day: no hold, as the app reads it
      END;
      IF v_hold IS NOT NULL AND v_today <= v_hold THEN
        RETURN 0;
      END IF;
    END IF;
    DELETE FROM public.strikes AS s
     WHERE s.firm_id = v_firm AND s.issued_at < now() - make_interval(months => v_months)
       AND s.expires_at < now() - interval '6 months';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
  END
  $$;
