-- Host -> firm lookup. Before a request knows its firm there is no app.current_firm_id, so the
-- app role cannot read firms at all. This function runs as the table owner (whose
-- directory_read policy allows SELECT on firms) and returns only public directory fields.
-- Static SQL only, no dynamic EXECUTE. search_path is pinned and every name is qualified, so a
-- caller's objects can't be substituted.
-- Phase 1 resolves subdomain slugs only; custom domains arrive in Phase 8.
CREATE FUNCTION app_resolve_firm(p_slug text)
  RETURNS TABLE (id uuid, slug text, name text, timezone text, sign_off text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT f.id, f.slug, f.name, f.timezone, f.settings ->> 'sign_off'
    FROM public.firms AS f
    WHERE f.slug = p_slug
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_resolve_firm(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_resolve_firm(text) TO shiftdesk_app;
