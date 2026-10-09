-- 12B.7 (docs/office-v2.md S10, 3.10): the only way the app may change firms.settings. The app role
-- can't update firms at all (a grant can't be limited to some keys inside one jsonb column, and
-- firms.settings also holds retention and the legal hold, which only the owner may change:
-- migration 0034, src/lib/gdpr/retention-settings.ts, docs/compliance.md). This function runs as
-- its owner, for the current firm only, and accepts two keys: strikes.email (a text address, or
-- NULL to clear it) and strikes.email_verified_at (an ISO time, or NULL). Every other key, and
-- retention.* first among them, is refused. A new address clears its confirmed time; a confirmed
-- time needs an address. Stored nested, like the other settings: settings.strikes.email and
-- settings.strikes.email_verified_at.
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
    v_strikes := v_settings -> 'strikes';
    IF v_strikes IS NULL OR jsonb_typeof(v_strikes) <> 'object' THEN
      v_strikes := '{}'::jsonb;
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
       SET settings = jsonb_set(coalesce(f.settings, '{}'::jsonb), '{strikes}', v_strikes)
     WHERE f.id = v_firm;
  END
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_set_firm_setting(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_set_firm_setting(text, text) TO shiftdesk_app;
