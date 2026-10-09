ALTER TABLE "firms" ADD CONSTRAINT "firms_custom_domain_host" CHECK ("firms"."custom_domain" ~ '^[a-z0-9][a-z0-9.-]{0,251}[a-z]$' and "firms"."custom_domain" !~ '[.][.]');--> statement-breakpoint
-- A firm's own domain -> firm (Phase 8). A request for shifts.firmname.co.uk arrives before
-- anything knows the firm, and the app role can't read firms without one set. Like
-- app_resolve_firm() (0003) for a subdomain, this runs as the table owner and returns only public
-- directory fields, for the one firm whose custom domain is exactly that name and verified (a
-- domain not yet pointed at us, or typed wrong, is nobody's). Static SQL only, pinned search_path,
-- qualified names.
CREATE FUNCTION app_resolve_firm_by_domain(p_domain text)
  RETURNS TABLE (id uuid, slug text, name text, timezone text, sign_off text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT f.id, f.slug, f.name, f.timezone, f.settings ->> 'sign_off'
    FROM public.firms AS f
    WHERE f.custom_domain = p_domain AND f.domain_verified
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_resolve_firm_by_domain(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_resolve_firm_by_domain(text) TO shiftdesk_app;
