-- 12B.7, after its review: app_set_firm_setting() (migration 0036) refuses what it used to repair
-- or read loosely. firms.settings and settings.strikes must be JSON objects (they always are: a
-- firm is made with '{}', and only this function and the owner write them); a confirmed time must
-- be an ISO time in UTC ("2026-11-02T09:00:00.000Z"), never a word Postgres reads as a time
-- ("now", "epoch", "infinity"). Same name, keys, owner and grants (CREATE OR REPLACE keeps them).
CREATE OR REPLACE FUNCTION app_set_firm_setting(p_key text, p_value text)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_firm uuid := public.app_current_firm_id();
    v_settings jsonb;
    v_strikes jsonb;
    v_at timestamptz;
  BEGIN
    IF v_firm IS NULL THEN
      RAISE EXCEPTION 'app_set_firm_setting needs a firm';
    END IF;
    IF p_key IS NULL OR p_key NOT IN ('strikes.email', 'strikes.email_verified_at') THEN
      RAISE EXCEPTION 'app_set_firm_setting: % is not a setting the app may change', p_key
        USING ERRCODE = '42501';
    END IF;
    SELECT f.settings INTO v_settings FROM public.firms AS f WHERE f.id = v_firm FOR NO KEY UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'app_set_firm_setting: no such firm';
    END IF;
    IF v_settings IS NULL OR jsonb_typeof(v_settings) <> 'object' THEN
      RAISE EXCEPTION 'app_set_firm_setting: the firm''s settings aren''t an object'
        USING ERRCODE = '22023';
    END IF;
    v_strikes := coalesce(v_settings -> 'strikes', '{}'::jsonb);
    IF jsonb_typeof(v_strikes) <> 'object' THEN
      RAISE EXCEPTION 'app_set_firm_setting: settings.strikes isn''t an object'
        USING ERRCODE = '22023';
    END IF;
    IF p_key = 'strikes.email' THEN
      IF p_value IS NULL THEN
        v_strikes := v_strikes - 'email' - 'email_verified_at';
      ELSE
        IF length(p_value) > 254 OR p_value !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
          RAISE EXCEPTION 'app_set_firm_setting: not an email address' USING ERRCODE = '22023';
        END IF;
        IF (v_strikes ->> 'email') IS DISTINCT FROM p_value THEN
          v_strikes := (v_strikes - 'email_verified_at') || jsonb_build_object('email', p_value);
        END IF;
      END IF;
    ELSE
      IF p_value IS NULL THEN
        v_strikes := v_strikes - 'email_verified_at';
      ELSE
        IF (v_strikes ->> 'email') IS NULL THEN
          RAISE EXCEPTION 'app_set_firm_setting: no address to confirm' USING ERRCODE = '22023';
        END IF;
        IF p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$' THEN
          RAISE EXCEPTION 'app_set_firm_setting: not a time' USING ERRCODE = '22023';
        END IF;
        BEGIN
          v_at := p_value::timestamptz;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'app_set_firm_setting: not a time' USING ERRCODE = '22023';
        END;
        v_strikes := v_strikes || jsonb_build_object(
          'email_verified_at', to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
      END IF;
    END IF;
    UPDATE public.firms AS f
       SET settings = jsonb_set(f.settings, '{strikes}', v_strikes)
     WHERE f.id = v_firm;
  END
  $$;
