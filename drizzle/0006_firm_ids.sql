-- The list of firm ids, for the worker's scheduled jobs (e.g. the Sheets sync tick), which run
-- before any firm is set and then visit each firm inside its own withFirm transaction. Ids only:
-- names, slugs and settings stay behind RLS. Runs as the table owner (whose directory_read
-- policy allows SELECT on firms). Static SQL, pinned search_path, qualified names.
CREATE FUNCTION app_firm_ids()
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT f.id FROM public.firms AS f ORDER BY f.id
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_firm_ids() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_firm_ids() TO shiftdesk_app;
