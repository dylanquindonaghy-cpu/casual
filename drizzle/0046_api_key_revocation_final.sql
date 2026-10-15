-- 12J.1 review: a revoked API key stays revoked. The app may set revoked_at and revoked_by once
-- (COLUMN_UPDATES); this stops a second write changing or clearing them, so no bug or stray update
-- can bring a revoked key back to life. Not callable by any role (no EXECUTE grant): Postgres runs
-- a trigger's function without checking EXECUTE.
CREATE FUNCTION app_api_key_revocation_final() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL
     AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
          OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by) THEN
    RAISE EXCEPTION 'an API key''s revocation is final'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'api_keys_revocation_final';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_api_key_revocation_final() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER api_keys_revocation_final
  BEFORE UPDATE OF revoked_at, revoked_by ON api_keys
  FOR EACH ROW EXECUTE FUNCTION app_api_key_revocation_final();
