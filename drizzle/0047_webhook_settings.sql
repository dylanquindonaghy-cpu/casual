-- 12J.2 (docs/office-v2.md S11 (b), 5.3.3): app_set_firm_setting() also accepts the planner's
-- webhook. Two more keys:
-- - webhook.url: an https:// address of at most 500 characters, or NULL to remove it (the app
--   checks the rest before calling: a DNS name, port 443, no IP, no user:password, not
--   ShiftDesk's own domain; src/lib/integrations/send.ts);
-- - webhook.rotate: value NULL, and only while an address is set ("New signing secret").
-- Both add 1 to settings.webhook.signing_version, which no call can set or lower: each signing
-- secret is derived from it (src/lib/integrations/secrets.ts), so an old, maybe leaked secret can
-- never come back, and the old one stops at once. Setting the same address again changes nothing
-- (no new secret). Stored nested, like strikes: settings.webhook.url and
-- settings.webhook.signing_version. The strikes keys are exactly as in migration 0037. Same name,
-- owner and grants (CREATE OR REPLACE keeps them).
CREATE OR REPLACE FUNCTION app_set_firm_setting(p_key text, p_value text)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_firm uuid := public.app_current_firm_id();
    v_settings jsonb;
    v_strikes jsonb;
    v_webhook jsonb;
    v_version bigint;
    v_at timestamptz;
  BEGIN
    IF v_firm IS NULL THEN
      RAISE EXCEPTION 'app_set_firm_setting needs a firm';
    END IF;
    IF p_key IS NULL OR p_key NOT IN ('strikes.email', 'strikes.email_verified_at',
                                      'webhook.url', 'webhook.rotate') THEN
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

    IF p_key IN ('webhook.url', 'webhook.rotate') THEN
      v_webhook := coalesce(v_settings -> 'webhook', '{}'::jsonb);
      IF jsonb_typeof(v_webhook) <> 'object' THEN
        RAISE EXCEPTION 'app_set_firm_setting: settings.webhook isn''t an object'
          USING ERRCODE = '22023';
      END IF;
      IF v_webhook ? 'signing_version' THEN
        IF jsonb_typeof(v_webhook -> 'signing_version') <> 'number'
           OR (v_webhook ->> 'signing_version') !~ '^[0-9]{1,15}$' THEN
          RAISE EXCEPTION 'app_set_firm_setting: settings.webhook.signing_version isn''t a count'
            USING ERRCODE = '22023';
        END IF;
        v_version := (v_webhook ->> 'signing_version')::bigint;
      ELSE
        v_version := 0;
      END IF;
      IF p_key = 'webhook.url' THEN
        IF p_value IS NULL THEN
          IF NOT (v_webhook ? 'url') THEN
            RETURN; -- nothing to remove
          END IF;
          v_webhook := v_webhook - 'url';
        ELSE
          IF length(p_value) > 500 OR p_value !~ '^https://[^[:space:]/?#@]+(/[^[:space:]]*)?$' THEN
            RAISE EXCEPTION 'app_set_firm_setting: not an https address' USING ERRCODE = '22023';
          END IF;
          IF (v_webhook ->> 'url') IS NOT DISTINCT FROM p_value THEN
            RETURN; -- the same address: no new secret
          END IF;
          v_webhook := v_webhook || jsonb_build_object('url', p_value);
        END IF;
      ELSE
        IF p_value IS NOT NULL THEN
          RAISE EXCEPTION 'app_set_firm_setting: webhook.rotate takes no value'
            USING ERRCODE = '22023';
        END IF;
        IF NOT (v_webhook ? 'url') THEN
          RAISE EXCEPTION 'app_set_firm_setting: no webhook to rotate' USING ERRCODE = '22023';
        END IF;
      END IF;
      v_webhook := v_webhook || jsonb_build_object('signing_version', v_version + 1);
      UPDATE public.firms AS f
         SET settings = jsonb_set(f.settings, '{webhook}', v_webhook)
       WHERE f.id = v_firm;
      RETURN;
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
