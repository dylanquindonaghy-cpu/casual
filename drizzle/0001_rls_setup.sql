-- Phase 1: tenancy primitives. Hand-written: drizzle-kit never emits functions, FORCE or GRANTs.
-- The roles shiftdesk_app and shiftdesk_jobs are created before migrations run (ensureRoles).

-- The firm for the current transaction, set by withFirm() with set_config(..., true).
-- NULL when unset, so every policy fails closed. The nullif is required: a pooled connection
-- that has run a firm transaction returns '' (not NULL) for the setting afterwards.
CREATE FUNCTION app_current_firm_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.current_firm_id', true), '')::uuid $$;
--> statement-breakpoint

-- No temp tables for anyone: a temp table can shadow a real table inside a SECURITY DEFINER
-- function (see app_resolve_firm).
DO $$ BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
END $$;
--> statement-breakpoint

-- pg-boss lives in its own schema. shiftdesk_jobs (the worker) creates and owns its tables.
-- The web role only gets what enqueueing needs, granted by installJobs() after pg-boss installs.
CREATE SCHEMA pgboss;
--> statement-breakpoint
GRANT USAGE, CREATE ON SCHEMA pgboss TO shiftdesk_jobs;
--> statement-breakpoint
GRANT USAGE ON SCHEMA pgboss TO shiftdesk_app;
